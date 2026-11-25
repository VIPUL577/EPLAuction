// The auction engine: every admin command runs through `mutate`, which
//   1. loads the current state (and only the records it needs),
//   2. validates on the server (single source of truth),
//   3. commits atomically with an optimistic-concurrency check on state.version,
//   4. records the audit trail, and
//   5. broadcasts the new state to every connected viewer ONLY after persistence succeeded.
import { randomInt } from 'node:crypto';
import { defaultConfig, defaultTeams, initialState } from './defaults.js';
import {
  affordError,
  basePriceOf,
  canBid,
  categoryBase,
  derivePhase,
  eligibilityError,
  nextAutoAssignment,
  nextBid,
} from './rules.js';
import { fetchSheetPlayers, pushToSheet, type SheetRowUpdate } from './sheet.js';
import {
  ConflictError,
  HttpError,
  type AuctionState,
  type AutoAssignment,
  type Config,
  type Owner,
  type Player,
  type PublicConfig,
  type PublicState,
  type SaleMode,
  type Snapshot,
  type Team,
  type User,
} from './types.js';
import type { Broadcaster, CommitInput, Store } from '../store/types.js';

export interface CommandInput {
  requestId?: string;
  version?: number;
  [key: string]: unknown;
}

export interface CommandResult {
  ok: true;
  state: PublicState;
  duplicate?: boolean;
  warnings?: string[];
  info?: unknown;
}

interface Draft {
  state: AuctionState;
  config?: Config;
  teams?: Team[];
  players?: Player[];
  deleteTeamIds?: string[];
  deletePlayerIds?: string[];
  rosterChanged?: boolean;
  audit: { action: string; details: unknown };
  bidLog?: { playerId: string; kind: 'BID' | 'UNDO'; teamId?: string; amount: number };
  /** Runs after a successful commit (e.g. Google Sheet write-back). Returns warnings. */
  after?: () => Promise<string[]>;
  info?: unknown;
}

const now = () => new Date().toISOString();
const bad = (msg: string) => new HttpError(400, msg);
const HEX = /^#[0-9a-fA-F]{6}$/;

export function publicState(s: AuctionState): PublicState {
  const { recentKeys: _ignored, ...rest } = s;
  return rest;
}

export function publicConfig(c: Config): PublicConfig {
  const { sheetUrl: _a, sheetWebhookUrl: _b, sheetWebhookSecret: _c, ...rest } = c;
  return rest;
}

/** Mutable working copy of teams + players used for sales and forced assignments. */
class World {
  teams: Map<string, Team>;
  players: Map<string, Player>;
  changedTeams = new Set<string>();
  changedPlayers = new Set<string>();
  constructor(
    public config: Config,
    teams: Team[],
    players: Player[],
  ) {
    this.teams = new Map(teams.map((t) => [t.id, t]));
    this.players = new Map(players.map((p) => [p.id, p]));
  }
  team(id: string) {
    const t = this.teams.get(id);
    if (!t) throw bad(`Unknown team ${id}`);
    return t;
  }
  player(id: string) {
    const p = this.players.get(id);
    if (!p) throw bad(`Unknown player ${id}`);
    return p;
  }
  assign(p: Player, t: Team, price: number, mode: SaleMode, asCaptain: boolean) {
    p.status = 'SOLD';
    p.teamId = t.id;
    p.price = price;
    p.saleMode = mode;
    p.soldAt = now();
    t.purse -= price;
    t.filled = { ...t.filled, [p.categoryId]: p.id };
    if (asCaptain) t.captainId = p.id;
    this.changedTeams.add(t.id);
    this.changedPlayers.add(p.id);
  }
  /** Applies forced assignments (last captain 3x, last player in category 2x) until none remain. */
  settle(phase: AuctionState['phase']): { phase: AuctionState['phase']; autos: AutoAssignment[] } {
    const autos: AutoAssignment[] = [];
    for (let guard = 0; guard < 200; guard++) {
      phase = derivePhase(phase, this.config, [...this.teams.values()], [...this.players.values()]);
      const a = nextAutoAssignment(phase, this.config, [...this.teams.values()], [...this.players.values()]);
      if (!a) break;
      this.assign(this.player(a.playerId), this.team(a.teamId), a.price, a.mode, a.mode === 'LAST_CAPTAIN');
      autos.push(a);
    }
    return { phase, autos };
  }
  changes(): Pick<Draft, 'teams' | 'players'> {
    return {
      teams: [...this.changedTeams].map((id) => this.teams.get(id)!),
      players: [...this.changedPlayers].map((id) => this.players.get(id)!),
    };
  }
  sheetRows(ids: string[]): SheetRowUpdate[] {
    return ids.map((id) => {
      const p = this.player(id);
      return { slNo: p.slNo, team: p.teamId ? this.team(p.teamId).name : '', price: p.price ?? '' };
    });
  }
}

export class Engine {
  constructor(
    private store: Store,
    private broadcaster: Broadcaster,
  ) {}

  // ---------------------------------------------------------------- reads

  async ensureSeeded() {
    const meta = await this.store.getMeta();
    if (meta) return meta;
    const state = initialState();
    const config = defaultConfig();
    try {
      await this.store.commit({ expectedVersion: -1, state, config, teams: defaultTeams() });
    } catch (e) {
      if (!(e instanceof ConflictError)) throw e;
    }
    return (await this.store.getMeta())!;
  }

  async snapshot(): Promise<Snapshot> {
    const { config, state } = await this.ensureSeeded();
    const [teams, players] = await Promise.all([this.store.listTeams(), this.store.listPlayers()]);
    return { config: publicConfig(config), state: publicState(state), teams, players };
  }

  async fullConfig(): Promise<Config> {
    return (await this.ensureSeeded()).config;
  }

  audit(limit: number) {
    return this.store.listAudit(Math.min(Math.max(limit, 1), 500));
  }

  bidLog(playerId: string) {
    return this.store.listBidLog(playerId);
  }

  // ---------------------------------------------------------------- core mutate helper

  private async mutate(
    user: User,
    input: CommandInput,
    fn: (ctx: { config: Config; state: AuctionState }) => Promise<Draft>,
  ): Promise<CommandResult> {
    const { config, state } = await this.ensureSeeded();
    if (input.requestId && state.recentKeys.includes(input.requestId)) {
      return { ok: true, duplicate: true, state: publicState(state) }; // idempotent retry
    }
    if (typeof input.version === 'number' && input.version !== state.version) {
      throw new HttpError(409, 'Another admin changed the auction first. Screen refreshed, please retry.', {
        state: publicState(state),
      });
    }
    const draft = await fn({ config: structuredClone(config), state: structuredClone(state) });
    const next: AuctionState = {
      ...draft.state,
      version: state.version + 1,
      rosterVersion: draft.rosterChanged ? state.rosterVersion + 1 : state.rosterVersion,
      recentKeys: input.requestId ? [...state.recentKeys, input.requestId].slice(-30) : state.recentKeys,
      updatedAt: now(),
      updatedBy: user.username,
    };
    const commit: CommitInput = {
      expectedVersion: state.version,
      state: next,
      config: draft.config,
      teams: draft.teams?.length ? draft.teams : undefined,
      players: draft.players?.length ? draft.players : undefined,
      deleteTeamIds: draft.deleteTeamIds,
      deletePlayerIds: draft.deletePlayerIds,
    };
    try {
      await this.store.commit(commit);
    } catch (e) {
      if (e instanceof ConflictError) {
        const latest = await this.store.getMeta();
        throw new HttpError(409, 'Another admin changed the auction at the same moment. Please retry.', {
          state: latest ? publicState(latest.state) : undefined,
        });
      }
      throw e;
    }

    const at = next.updatedAt;
    const sideEffects: Promise<unknown>[] = [
      this.store.addAudit({ at, by: user.username, role: user.role, action: draft.audit.action, details: draft.audit.details, version: next.version }),
      this.broadcaster.broadcast({ type: 'state', state: publicState(next) }),
    ];
    if (draft.bidLog) sideEffects.push(this.store.addBidLog({ ...draft.bidLog, at, by: user.username }));
    const settled = await Promise.allSettled(sideEffects);
    for (const s of settled) if (s.status === 'rejected') console.error('side effect failed', s.reason);
    const warnings = draft.after ? await draft.after() : [];
    return { ok: true, state: publicState(next), warnings: warnings.length ? warnings : undefined, info: draft.info };
  }

  private requireMaster(user: User) {
    if (user.role !== 'master') throw new HttpError(403, 'Only the master admin can do this');
  }

  private requireSetup(state: AuctionState, what: string) {
    if (state.phase !== 'SETUP') throw bad(`${what} can only be changed before the auction starts (or after a reset)`);
  }

  private requireLive(state: AuctionState) {
    if (!state.lot || state.lot.status !== 'LIVE') throw bad('No player is currently up for bidding');
    return state.lot;
  }

  private sheetAfter(config: Config, rows: SheetRowUpdate[]) {
    return async () => {
      const w = await pushToSheet(config, rows);
      return w ? [w] : [];
    };
  }

  // ---------------------------------------------------------------- live auction (all admins)

  draw(user: User, input: CommandInput) {
    return this.mutate(user, input, async ({ config, state }) => {
      if (state.phase !== 'CAPTAINS' && state.phase !== 'PLAYERS') throw bad(`Cannot draw a player in phase ${state.phase}`);
      if (state.lot?.status === 'LIVE') throw bad('Finish the current player first (Sold / Unsold)');
      const players = await this.store.listPlayers();
      const open = players.filter(
        (p) => !p.teamId && (p.status === 'AVAILABLE' || p.status === 'UNSOLD') && (state.phase !== 'CAPTAINS' || p.isCaptain),
      );
      // Fresh players first; players that went unsold come back once the fresh pool is empty.
      const fresh = open.filter((p) => p.status === 'AVAILABLE');
      const pool = fresh.length ? fresh : open;
      if (!pool.length) throw bad('No players left to draw');
      const pick = pool[randomInt(pool.length)];
      state.lot = { playerId: pick.id, status: 'LIVE', bids: [], startedAt: now() };
      state.lastAuto = [];
      return {
        state,
        audit: { action: 'DRAW', details: { playerId: pick.id, name: pick.name, phase: state.phase, poolSize: pool.length } },
      };
    });
  }

  /** Raises the current price. Bids are not team-specific; the buying team is chosen at "Sold". */
  bid(user: User, input: CommandInput) {
    return this.mutate(user, input, async ({ config, state }) => {
      const lot = this.requireLive(state);
      const [teams, player] = await Promise.all([this.store.listTeams(), this.store.getPlayer(lot.playerId)]);
      if (!player || player.status === 'SOLD' || player.teamId) throw bad('This player is already sold');
      const top = lot.bids.at(-1);
      const base = basePriceOf(player, config);
      const current = top ? top.amount : null;
      let amount: number;
      if (input.amount === undefined || input.amount === null || input.amount === '') {
        amount = nextBid(current, base, config.ladder);
      } else {
        amount = Number(input.amount);
        if (!Number.isInteger(amount) || amount <= 0) throw bad('Bid must be a whole number of lakhs');
        if (current === null && amount < base) throw bad(`Bid cannot be below the base price (${base} L)`);
        if (current !== null && amount <= current) throw bad(`Bid must be higher than the current bid (${current} L)`);
      }
      if (!teams.some((t) => canBid(t, player, amount, state.phase, config))) {
        throw bad(`No team can bid ${amount} L for this player (category filled or wallet rule)`);
      }
      lot.bids.push({ amount, by: user.username, at: now() });
      return {
        state,
        audit: { action: 'BID', details: { playerId: player.id, amount } },
        bidLog: { playerId: player.id, kind: 'BID', amount },
      };
    });
  }

  undoBid(user: User, input: CommandInput) {
    return this.mutate(user, input, async ({ state }) => {
      const lot = this.requireLive(state);
      const last = lot.bids.pop();
      if (!last) throw bad('There is no bid to undo');
      return {
        state,
        audit: { action: 'UNDO_BID', details: { playerId: lot.playerId, removed: last } },
        bidLog: { playerId: lot.playerId, kind: 'UNDO', amount: last.amount },
      };
    });
  }

  sell(user: User, input: CommandInput) {
    return this.mutate(user, input, async ({ config, state }) => {
      const lot = this.requireLive(state);
      const [teams, players] = await Promise.all([this.store.listTeams(), this.store.listPlayers()]);
      const world = new World(config, teams, players);
      const player = world.player(lot.playerId);
      if (player.status === 'SOLD' || player.teamId) throw bad('This player is already sold');
      const top = lot.bids.at(-1);
      const teamId = String(input.teamId ?? '');
      if (!teamId) throw bad('Tick the team the player is sold to');
      const team = world.team(teamId);
      let price = top ? top.amount : basePriceOf(player, config);
      let mode: SaleMode = 'AUCTION';
      if (input.price !== undefined && input.price !== null && input.price !== '') {
        this.requireMaster(user);
        price = Number(input.price);
        if (!Number.isInteger(price) || price < 0) throw bad('Invalid price');
        mode = 'MANUAL';
      }
      const elig = eligibilityError(team, player, state.phase);
      if (elig) throw bad(elig);
      if (mode === 'AUCTION') {
        const afford = affordError(team, player, price, config);
        if (afford) throw bad(afford);
      } else if (price > team.purse) throw bad(`${team.name} only has ${team.purse} L left`);

      world.assign(player, team, price, mode, state.phase === 'CAPTAINS' && player.isCaptain);
      Object.assign(lot, { status: 'SOLD', closedAt: now(), teamId: team.id, price });
      const { phase, autos } = world.settle(state.phase);
      state.phase = phase;
      state.lastAuto = autos;
      return {
        state,
        ...world.changes(),
        rosterChanged: true,
        audit: { action: 'SOLD', details: { playerId: player.id, name: player.name, teamId: team.id, price, mode, autos } },
        after: this.sheetAfter(config, world.sheetRows([player.id, ...autos.map((a) => a.playerId)])),
      };
    });
  }

  unsold(user: User, input: CommandInput) {
    return this.mutate(user, input, async ({ config, state }) => {
      const lot = this.requireLive(state);
      const [teams, players] = await Promise.all([this.store.listTeams(), this.store.listPlayers()]);
      const world = new World(config, teams, players);
      const player = world.player(lot.playerId);
      player.status = 'UNSOLD';
      world.changedPlayers.add(player.id);
      Object.assign(lot, { status: 'UNSOLD', closedAt: now() });
      const { phase, autos } = world.settle(state.phase);
      state.phase = phase;
      state.lastAuto = autos;
      return {
        state,
        ...world.changes(),
        rosterChanged: true,
        audit: { action: 'UNSOLD', details: { playerId: player.id, name: player.name, autos } },
        after: this.sheetAfter(config, world.sheetRows(autos.map((a) => a.playerId))),
      };
    });
  }

  /** "Refresh from the database": pulls name/photo (and, before the start, category/base) from the sheet. */
  syncFromSheet(user: User, input: CommandInput) {
    return this.mutate(user, input, async ({ config, state }) => {
      const { players: rows, errors } = await fetchSheetPlayers(config);
      const existing = new Map((await this.store.listPlayers()).map((p) => [p.id, p]));
      const changed: Player[] = [];
      let added = 0;
      for (const r of rows) {
        const p = existing.get(r.id);
        if (!p) {
          changed.push(r);
          added++;
          continue;
        }
        const upd = { ...p, name: r.name, photo: r.photo };
        if (state.phase === 'SETUP' || (p.status !== 'SOLD' && !p.teamId && state.lot?.playerId !== p.id)) {
          if (state.phase === 'SETUP') upd.categoryId = r.categoryId;
          upd.basePrice = r.basePrice;
        }
        if (JSON.stringify(upd) !== JSON.stringify(p)) changed.push(upd);
      }
      return {
        state,
        players: changed,
        rosterChanged: true,
        audit: { action: 'SYNC_SHEET', details: { updated: changed.length - added, added, errors } },
        info: { updated: changed.length - added, added, errors },
      };
    });
  }

  pushAllToSheet(user: User, input: CommandInput) {
    return this.mutate(user, input, async ({ config, state }) => {
      if (!config.sheetWebhookUrl) throw bad('No Google Apps Script URL configured in Setup');
      const [teams, players] = await Promise.all([this.store.listTeams(), this.store.listPlayers()]);
      const world = new World(config, teams, players);
      const rows = world.sheetRows(players.map((p) => p.id));
      return {
        state,
        audit: { action: 'PUSH_SHEET', details: { rows: rows.length } },
        after: this.sheetAfter(config, rows),
      };
    });
  }

  // ---------------------------------------------------------------- master-only

  async saveConfig(user: User, input: CommandInput) {
    this.requireMaster(user);
    return this.mutate(user, input, async ({ config, state }) => {
      const c = (input.config ?? {}) as Partial<Config>;
      const next: Config = { ...config };
      if (c.tournamentName !== undefined) next.tournamentName = String(c.tournamentName).slice(0, 80);
      if (c.sheetUrl !== undefined) next.sheetUrl = String(c.sheetUrl).trim();
      if (c.sheetWebhookUrl !== undefined) {
        const u = String(c.sheetWebhookUrl).trim();
        if (u && !/^https:\/\/script\.google\.com\//.test(u)) throw bad('Apps Script URL must start with https://script.google.com/');
        next.sheetWebhookUrl = u;
      }
      if (c.sheetWebhookSecret !== undefined) next.sheetWebhookSecret = String(c.sheetWebhookSecret);
      const pos = (v: unknown, name: string) => {
        const n = Number(v);
        if (!Number.isFinite(n) || n <= 0) throw bad(`${name} must be a positive number`);
        return n;
      };
      if (c.ladder) {
        next.ladder = {
          threshold: pos(c.ladder.threshold, 'Ladder threshold'),
          stepLow: pos(c.ladder.stepLow, 'Lower bid step'),
          stepHigh: pos(c.ladder.stepHigh, 'Higher bid step'),
        };
      }
      if (c.multipliers) {
        next.multipliers = {
          walletReserve: pos(c.multipliers.walletReserve, 'Wallet reserve multiplier'),
          ownerPlayer: pos(c.multipliers.ownerPlayer, 'Owner-player multiplier'),
          lastCaptain: pos(c.multipliers.lastCaptain, 'Last captain multiplier'),
          lastInCategory: pos(c.multipliers.lastInCategory, 'Last-in-category multiplier'),
        };
      }
      if (c.categories) {
        this.requireSetup(state, 'Categories');
        const ids = new Set<string>();
        next.categories = c.categories.map((cat) => {
          const id = String(cat.id || '').trim().toUpperCase();
          if (!/^[A-Z0-9_-]{1,12}$/.test(id) || ids.has(id)) throw bad(`Invalid or duplicate category id "${cat.id}"`);
          ids.add(id);
          const name = String(cat.name || '').trim();
          if (!name) throw bad('Category name is required');
          return { id, name, basePrice: pos(cat.basePrice, `Base price of ${name}`) };
        });
      }
      return { state, config: next, rosterChanged: true, audit: { action: 'CONFIG', details: { ...c, sheetWebhookSecret: c.sheetWebhookSecret ? '***' : undefined } } };
    });
  }

  async saveTeams(user: User, input: CommandInput) {
    this.requireMaster(user);
    return this.mutate(user, input, async ({ state }) => {
      const incoming = (input.teams ?? []) as Partial<Team>[];
      const existing = await this.store.listTeams();
      const byId = new Map(existing.map((t) => [t.id, t]));
      const setup = state.phase === 'SETUP';
      const out: Team[] = [];
      let counter = existing.reduce((m, t) => Math.max(m, parseInt(t.id.slice(1), 10) || 0), 0);
      for (const t of incoming) {
        const name = String(t.name ?? '').trim();
        const color = String(t.color ?? '').trim();
        if (!name) throw bad('Team name is required');
        if (!HEX.test(color)) throw bad(`Colour for ${name} must look like #12B886`);
        const prev = t.id ? byId.get(t.id) : undefined;
        if (!prev) {
          if (!setup) throw bad('Teams can only be added before the auction starts');
          counter++;
        }
        const team: Team = prev ? { ...prev, name, color } : { id: `T${counter}`, name, color, budget: 0, purse: 0, owners: [], filled: {} };
        if (setup) {
          const budget = Number(t.budget ?? team.budget);
          if (!Number.isFinite(budget) || budget <= 0) throw bad(`Budget for ${name} must be positive`);
          team.budget = budget;
          team.purse = budget;
          team.owners = ((t.owners ?? []) as Owner[]).slice(0, 2).map((o) => ({
            name: String(o?.name ?? '').trim().slice(0, 60),
            playerId: o?.playerId ? String(o.playerId) : undefined,
            isCaptain: !!o?.isCaptain && !!o?.playerId,
          }));
          while (team.owners.length < 2) team.owners.push({ name: '' });
        }
        out.push(team);
      }
      const keep = new Set(out.map((t) => t.id));
      const deleteTeamIds = existing.filter((t) => !keep.has(t.id)).map((t) => t.id);
      if (deleteTeamIds.length && !setup) throw bad('Teams can only be deleted before the auction starts');
      return { state, teams: out, deleteTeamIds, rosterChanged: true, audit: { action: 'TEAMS', details: { teams: out.map((t) => ({ id: t.id, name: t.name, owners: t.owners })), deleted: deleteTeamIds } } };
    });
  }

  async importFromSheet(user: User, input: CommandInput) {
    this.requireMaster(user);
    return this.mutate(user, input, async ({ config, state }) => {
      this.requireSetup(state, 'The player list');
      if (typeof input.sheetUrl === 'string' && input.sheetUrl.trim()) config.sheetUrl = input.sheetUrl.trim();
      const { players, errors } = await fetchSheetPlayers(config);
      if (!players.length) throw bad(`No players found in the sheet. ${errors.slice(0, 5).join('; ')}`);
      const old = await this.store.listPlayers();
      const oldById = new Map(old.map((p) => [p.id, p]));
      for (const p of players) {
        const prev = oldById.get(p.id);
        if (prev) Object.assign(p, { isCaptain: prev.isCaptain, status: prev.status === 'UNAVAILABLE' ? 'UNAVAILABLE' : 'AVAILABLE', age: prev.age, battingStyle: prev.battingStyle, bowlingStyle: prev.bowlingStyle });
      }
      const keep = new Set(players.map((p) => p.id));
      const deletePlayerIds = old.filter((p) => !keep.has(p.id)).map((p) => p.id);
      // Remove owner links to players that no longer exist.
      const teams = (await this.store.listTeams()).filter((t) => t.owners.some((o) => o.playerId && !keep.has(o.playerId)));
      for (const t of teams) t.owners = t.owners.map((o) => (o.playerId && !keep.has(o.playerId) ? { name: o.name } : o));
      return {
        state,
        config,
        players,
        teams,
        deletePlayerIds,
        rosterChanged: true,
        audit: { action: 'IMPORT_SHEET', details: { count: players.length, removed: deletePlayerIds.length, errors } },
        info: { count: players.length, errors },
      };
    });
  }

  async upsertPlayer(user: User, input: CommandInput) {
    this.requireMaster(user);
    return this.mutate(user, input, async ({ config, state }) => {
      const p = (input.player ?? {}) as Partial<Player>;
      const players = await this.store.listPlayers();
      const prev = p.id ? players.find((x) => x.id === p.id) : undefined;
      const setup = state.phase === 'SETUP';
      const name = String(p.name ?? prev?.name ?? '').trim();
      if (!name) throw bad('Player name is required');
      let player: Player;
      if (prev) {
        player = { ...prev, name, photo: String(p.photo ?? prev.photo ?? '').trim() };
      } else {
        const slNo = Number(p.slNo) || players.reduce((m, x) => Math.max(m, x.slNo), 0) + 1;
        if (players.some((x) => x.slNo === slNo)) throw bad(`Sl No ${slNo} is already used`);
        const categoryId = String(p.categoryId ?? '');
        player = { id: `P${slNo}`, slNo, name, photo: String(p.photo ?? '').trim(), categoryId, basePrice: 0, status: 'AVAILABLE', isCaptain: false };
      }
      const optionalText = (v: unknown) => (v === undefined ? undefined : String(v).trim().slice(0, 40) || undefined);
      if (p.age !== undefined) player.age = Number(p.age) > 0 ? Math.round(Number(p.age)) : undefined;
      if (p.battingStyle !== undefined) player.battingStyle = optionalText(p.battingStyle);
      if (p.bowlingStyle !== undefined) player.bowlingStyle = optionalText(p.bowlingStyle);
      const sold = player.status === 'SOLD' || !!player.teamId;
      const onBlock = state.lot?.status === 'LIVE' && state.lot.playerId === player.id;
      if (p.categoryId !== undefined && p.categoryId !== player.categoryId) {
        if (!setup && prev) throw bad('Category can only be changed before the auction starts');
        player.categoryId = String(p.categoryId);
      }
      if (!config.categories.some((c) => c.id === player.categoryId)) throw bad('Choose a valid category');
      if (p.basePrice !== undefined && !sold && !onBlock) {
        const bp = Number(p.basePrice);
        if (!Number.isFinite(bp) || bp < 0) throw bad('Invalid base price');
        player.basePrice = bp;
      }
      if (!player.basePrice) player.basePrice = categoryBase(config, player.categoryId);
      if (p.status !== undefined && p.status !== player.status) {
        if (sold) throw bad('Revert the sale first');
        if (onBlock) throw bad('This player is on the block right now');
        if (p.status !== 'AVAILABLE' && p.status !== 'UNAVAILABLE') throw bad('Status can be AVAILABLE or UNAVAILABLE');
        player.status = p.status;
      }
      return { state, players: [player], rosterChanged: true, audit: { action: prev ? 'PLAYER_EDIT' : 'PLAYER_ADD', details: { before: prev, after: player } } };
    });
  }

  async deletePlayer(user: User, input: CommandInput) {
    this.requireMaster(user);
    return this.mutate(user, input, async ({ state }) => {
      this.requireSetup(state, 'Deleting players');
      const id = String(input.playerId ?? '');
      const p = await this.store.getPlayer(id);
      if (!p) throw bad('Player not found');
      const teams = (await this.store.listTeams()).filter((t) => t.owners.some((o) => o.playerId === id));
      for (const t of teams) t.owners = t.owners.map((o) => (o.playerId === id ? { name: o.name } : o));
      return { state, teams, deletePlayerIds: [id], rosterChanged: true, audit: { action: 'PLAYER_DELETE', details: p } };
    });
  }

  async setCaptains(user: User, input: CommandInput) {
    this.requireMaster(user);
    return this.mutate(user, input, async ({ state }) => {
      this.requireSetup(state, 'Captains');
      const ids = new Set(((input.playerIds ?? []) as unknown[]).map(String));
      const [players, teams] = await Promise.all([this.store.listPlayers(), this.store.listTeams()]);
      if (ids.size > teams.length) throw bad(`Pick at most ${teams.length} captains (one per team)`);
      for (const id of ids) {
        const p = players.find((x) => x.id === id);
        if (!p) throw bad(`Unknown player ${id}`);
        if (p.status === 'UNAVAILABLE') throw bad(`${p.name} is marked unavailable`);
      }
      const changed = players.filter((p) => p.isCaptain !== ids.has(p.id)).map((p) => ({ ...p, isCaptain: ids.has(p.id) }));
      return { state, players: changed, rosterChanged: true, audit: { action: 'CAPTAINS', details: { playerIds: [...ids] } } };
    });
  }

  async start(user: User, input: CommandInput) {
    this.requireMaster(user);
    return this.mutate(user, input, async ({ config, state }) => {
      this.requireSetup(state, 'Auction start');
      const [teams, players] = await Promise.all([this.store.listTeams(), this.store.listPlayers()]);
      if (teams.length < 2) throw bad('Add at least 2 teams');
      const active = players.filter((p) => p.status !== 'UNAVAILABLE');
      if (!active.length) throw bad('Import players first');
      const world = new World(config, teams, players);
      for (const t of world.teams.values()) Object.assign(t, { purse: t.budget, filled: {}, captainId: undefined });

      // Owner-captains are captains too.
      for (const t of world.teams.values()) {
        const capOwners = t.owners.filter((o) => o.isCaptain && o.playerId);
        if (capOwners.length > 1) throw bad(`${t.name}: only one owner can be the captain`);
        for (const o of capOwners) {
          const p = world.player(o.playerId!);
          if (!p.isCaptain) {
            p.isCaptain = true;
            world.changedPlayers.add(p.id);
          }
        }
      }
      const captains = [...world.players.values()].filter((p) => p.isCaptain && p.status !== 'UNAVAILABLE');
      if (captains.length !== teams.length) throw bad(`Select exactly ${teams.length} captains (currently ${captains.length})`);

      const warnings: string[] = [];
      for (const c of config.categories) {
        const n = active.filter((p) => p.categoryId === c.id).length;
        if (n !== teams.length) warnings.push(`${c.name} has ${n} players for ${teams.length} teams`);
      }

      // Owner-players go straight to their own team at ownerPlayer x category base.
      const preAssigned: string[] = [];
      for (const t of world.teams.values()) {
        for (const o of t.owners) {
          if (!o.playerId) continue;
          const p = world.player(o.playerId);
          if (p.teamId) throw bad(`${p.name} is linked to more than one owner`);
          if (p.status === 'UNAVAILABLE') throw bad(`Owner-player ${p.name} is marked unavailable`);
          if (t.filled[p.categoryId]) throw bad(`${t.name} has two owner-players in the same category`);
          if (p.isCaptain && !o.isCaptain) throw bad(`${p.name} is a captain and an owner of ${t.name}: tick "captain" on the owner`);
          world.assign(p, t, categoryBase(config, p.categoryId) * config.multipliers.ownerPlayer, 'OWNER', !!o.isCaptain);
          preAssigned.push(p.id);
        }
      }
      for (const p of world.players.values()) {
        if (!p.teamId && p.status === 'UNSOLD') {
          p.status = 'AVAILABLE';
          world.changedPlayers.add(p.id);
        }
      }
      const { phase, autos } = world.settle('CAPTAINS');
      state.phase = phase;
      state.lot = null;
      state.lastAuto = autos;
      return {
        state,
        ...world.changes(),
        rosterChanged: true,
        audit: { action: 'START', details: { preAssigned, autos, warnings } },
        after: async () => [...warnings, ...(await this.sheetAfter(config, world.sheetRows([...preAssigned, ...autos.map((a) => a.playerId)]))())],
      };
    });
  }

  async revertSale(user: User, input: CommandInput) {
    this.requireMaster(user);
    return this.mutate(user, input, async ({ config, state }) => {
      const id = String(input.playerId ?? '');
      const [teams, players] = await Promise.all([this.store.listTeams(), this.store.listPlayers()]);
      const world = new World(config, teams, players);
      const p = world.player(id);
      if (!p.teamId) throw bad(`${p.name} is not sold`);
      const t = world.team(p.teamId);
      const before = { teamId: p.teamId, price: p.price, mode: p.saleMode };
      t.purse += p.price ?? 0;
      const filled = { ...t.filled };
      if (filled[p.categoryId] === p.id) delete filled[p.categoryId];
      t.filled = filled;
      if (t.captainId === p.id) t.captainId = undefined;
      if (before.mode === 'OWNER') {
        t.owners = t.owners.map((o) => (o.playerId === p.id ? { name: o.name } : o));
      }
      Object.assign(p, { status: 'AVAILABLE', teamId: undefined, price: undefined, saleMode: undefined, soldAt: undefined });
      world.changedPlayers.add(p.id);
      world.changedTeams.add(t.id);
      if (state.lot?.playerId === p.id && state.lot.status !== 'LIVE') state.lot = null;
      if (state.phase !== 'SETUP') state.phase = derivePhase(state.phase === 'COMPLETE' ? 'PLAYERS' : state.phase, config, [...world.teams.values()], [...world.players.values()]);
      return {
        state,
        ...world.changes(),
        rosterChanged: true,
        audit: { action: 'REVERT_SALE', details: { playerId: p.id, name: p.name, ...before } },
        after: this.sheetAfter(config, [{ slNo: p.slNo, team: '', price: '' }]),
      };
    });
  }

  async reset(user: User, input: CommandInput) {
    this.requireMaster(user);
    return this.mutate(user, input, async ({ config, state }) => {
      if (input.confirm !== 'RESET') throw bad('Type RESET to confirm');
      const [teams, players] = await Promise.all([this.store.listTeams(), this.store.listPlayers()]);
      for (const t of teams) Object.assign(t, { purse: t.budget, filled: {}, captainId: undefined });
      for (const p of players) {
        Object.assign(p, { teamId: undefined, price: undefined, saleMode: undefined, soldAt: undefined });
        if (p.status !== 'UNAVAILABLE') p.status = 'AVAILABLE';
      }
      Object.assign(state, { phase: 'SETUP', lot: null, lastAuto: [] });
      return {
        state,
        teams,
        players,
        rosterChanged: true,
        audit: { action: 'RESET', details: {} },
        after: this.sheetAfter(config, players.map((p) => ({ slNo: p.slNo, team: '', price: '' }))),
      };
    });
  }
}

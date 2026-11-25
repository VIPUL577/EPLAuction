import type { Ladder, Player, PublicConfig, Snapshot, Team } from './types';

/** 90 -> "₹90 L", 240 -> "₹2.4 Cr", 1800 -> "₹18 Cr" */
export function money(lakhs: number | undefined | null): string {
  if (lakhs === undefined || lakhs === null) return '-';
  if (Math.abs(lakhs) >= 100) {
    return `₹${(lakhs / 100).toFixed(2).replace(/\.?0+$/, '')} Cr`;
  }
  return `₹${lakhs} L`;
}

export function nextBid(current: number | null, base: number, ladder: Ladder): number {
  if (current === null) return base;
  return current + (current < ladder.threshold ? ladder.stepLow : ladder.stepHigh);
}

export function categoryName(config: PublicConfig, id: string) {
  return config.categories.find((c) => c.id === id)?.name ?? id;
}

export function basePriceOf(p: Player, config: PublicConfig) {
  const cat = config.categories.find((c) => c.id === p.categoryId)?.basePrice ?? 0;
  if (p.isCaptain) return cat;
  return p.basePrice > 0 ? p.basePrice : cat;
}

export function reserveRequired(team: Team, config: PublicConfig, excludingCategoryId?: string) {
  let sum = 0;
  for (const c of config.categories) if (c.id !== excludingCategoryId && !team.filled[c.id]) sum += c.basePrice;
  return sum * config.multipliers.walletReserve;
}

export function maxBidFor(team: Team, config: PublicConfig, categoryId: string) {
  return team.purse - reserveRequired(team, config, categoryId);
}

export function openSlots(team: Team, config: PublicConfig) {
  return config.categories.filter((c) => !team.filled[c.id]).length;
}

export function playerMap(snap: Snapshot) {
  return new Map(snap.players.map((p) => [p.id, p]));
}

export function teamMap(snap: Snapshot) {
  return new Map(snap.teams.map((t) => [t.id, t]));
}

export const SALE_LABEL: Record<string, string> = {
  AUCTION: 'Auction',
  OWNER: 'Owner-player',
  LAST_CAPTAIN: 'Last captain (auto)',
  LAST_IN_CATEGORY: 'Last in category (auto)',
  MANUAL: 'Manual (master)',
};

export function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('');
}

/** Why a team cannot bid `amount` for this player right now (null = it can). Shared by admin and public views. */
export function bidBlock(team: Team, player: Player, snap: Snapshot, amount: number): string | null {
  if (team.filled[player.categoryId]) return 'Category filled';
  if (snap.state.phase === 'CAPTAINS' && player.isCaptain && team.captainId) return 'Has captain';
  if (amount > maxBidFor(team, snap.config, player.categoryId)) return `Can't afford ${money(amount)}`;
  return null;
}

/** The live lot, its player, the current bid and the next ladder step (null when nobody is up for bidding). */
export function liveLot(snap: Snapshot) {
  const lot = snap.state.lot;
  if (!lot || lot.status !== 'LIVE') return null;
  const player = snap.players.find((p) => p.id === lot.playerId);
  if (!player) return null;
  const top = lot.bids[lot.bids.length - 1];
  const current = top ? top.amount : null;
  const upcoming = nextBid(current, basePriceOf(player, snap.config), snap.config.ladder);
  return { lot, player, current, upcoming };
}

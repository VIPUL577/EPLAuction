// Pure auction rules. No I/O here so they are easy to unit test.
import type { AutoAssignment, Config, Ladder, Phase, Player, Team } from './types.js';

export function categoryBase(config: Config, categoryId: string): number {
  const c = config.categories.find((x) => x.id === categoryId);
  if (!c) throw new Error(`Unknown category ${categoryId}`);
  return c.basePrice;
}

/** Captains always use their category's base price; other players use their own (sheet) base price. */
export function basePriceOf(player: Player, config: Config): number {
  if (player.isCaptain) return categoryBase(config, player.categoryId);
  return player.basePrice > 0 ? player.basePrice : categoryBase(config, player.categoryId);
}

/**
 * Bid ladder: +stepLow while the current bid is below threshold, +stepHigh from threshold upward.
 * Non-multiples continue from the base (85, 95 ... 195, 205, 225).
 */
export function nextBid(current: number | null, base: number, ladder: Ladder): number {
  if (current === null) return base;
  return current + (current < ladder.threshold ? ladder.stepLow : ladder.stepHigh);
}

/** Money a team must keep after a purchase: multiplier x base of every category it has not filled yet. */
export function reserveRequired(team: Team, config: Config, excludingCategoryId?: string): number {
  let sum = 0;
  for (const c of config.categories) {
    if (c.id === excludingCategoryId) continue;
    if (!team.filled[c.id]) sum += c.basePrice;
  }
  return sum * config.multipliers.walletReserve;
}

/** Highest amount the team may pay for a player of this category without breaking the wallet rule. */
export function maxBidFor(team: Team, config: Config, categoryId: string): number {
  return team.purse - reserveRequired(team, config, categoryId);
}

export function eligibilityError(team: Team, player: Player, phase: Phase): string | null {
  if (team.filled[player.categoryId]) return `${team.name} already has a player in this category`;
  if (phase === 'CAPTAINS' && player.isCaptain && team.captainId) return `${team.name} already has a captain`;
  return null;
}

export function affordError(team: Team, player: Player, amount: number, config: Config): string | null {
  if (amount > team.purse) return `${team.name} only has ${team.purse} L left`;
  const max = maxBidFor(team, config, player.categoryId);
  if (amount > max) {
    return `${team.name} can bid at most ${max} L (must keep ${reserveRequired(team, config, player.categoryId)} L for remaining slots)`;
  }
  return null;
}

/** True when the team may still bid `amount` for this player (slot open and wallet rule holds). */
export function canBid(team: Team, player: Player, amount: number, phase: Phase, config: Config): boolean {
  return !eligibilityError(team, player, phase) && !affordError(team, player, amount, config);
}

const isOpen = (p: Player) => !p.teamId && p.status !== 'UNAVAILABLE' && p.status !== 'SOLD';
const needs = (t: Team, categoryId: string) => !t.filled[categoryId];

export function derivePhase(current: Phase, config: Config, teams: Team[], players: Player[]): Phase {
  if (current === 'SETUP') return 'SETUP';
  const captainsLeft = players.some((p) => p.isCaptain && isOpen(p));
  if (captainsLeft && teams.some((t) => !t.captainId)) return 'CAPTAINS';
  const anyNeed = teams.some((t) => config.categories.some((c) => needs(t, c.id)));
  if (anyNeed && players.some(isOpen)) return 'PLAYERS';
  return 'COMPLETE';
}

/** Returns the next forced assignment (last captain / last player in a category), or null. */
export function nextAutoAssignment(
  phase: Phase,
  config: Config,
  teams: Team[],
  players: Player[],
): AutoAssignment | null {
  if (phase === 'CAPTAINS') {
    const caps = players.filter((p) => p.isCaptain && isOpen(p));
    const teamsWithout = teams.filter((t) => !t.captainId);
    if (caps.length === 1 && teamsWithout.length === 1) {
      const p = caps[0];
      return {
        playerId: p.id,
        teamId: teamsWithout[0].id,
        price: categoryBase(config, p.categoryId) * config.multipliers.lastCaptain,
        mode: 'LAST_CAPTAIN',
      };
    }
    return null;
  }
  if (phase === 'PLAYERS') {
    for (const c of config.categories) {
      const remaining = players.filter((p) => p.categoryId === c.id && isOpen(p));
      const needing = teams.filter((t) => needs(t, c.id));
      if (remaining.length === 1 && needing.length === 1) {
        return {
          playerId: remaining[0].id,
          teamId: needing[0].id,
          price: c.basePrice * config.multipliers.lastInCategory,
          mode: 'LAST_IN_CATEGORY',
        };
      }
    }
  }
  return null;
}

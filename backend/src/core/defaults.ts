import type { AuctionState, Config, Player, Team } from './types.js';

export function defaultConfig(): Config {
  return {
    tournamentName: 'EPL 2026 Auction',
    ladder: { threshold: 200, stepLow: 10, stepHigh: 20 },
    multipliers: { walletReserve: 2, ownerPlayer: 3, lastCaptain: 3, lastInCategory: 2 },
    categories: [
      { id: 'AR1', name: 'All-rounder 1', basePrice: 90 },
      { id: 'AR2', name: 'All-rounder 2', basePrice: 80 },
      { id: 'BAT1', name: 'Batsman 1', basePrice: 70 },
      { id: 'BAT2', name: 'Batsman 2', basePrice: 40 },
      { id: 'BAT3', name: 'Batsman 3', basePrice: 30 },
      { id: 'BOWL1', name: 'Bowler 1', basePrice: 60 },
      { id: 'BOWL2', name: 'Bowler 2', basePrice: 50 },
      { id: 'BOWL3', name: 'Bowler 3', basePrice: 30 },
      { id: 'IMP1', name: 'Impact player 1', basePrice: 20 },
      { id: 'IMP2', name: 'Impact player 2', basePrice: 20 },
      { id: 'IMP3', name: 'Impact player 3', basePrice: 20 },
    ],
    sheetUrl: '',
    sheetWebhookUrl: '',
    sheetWebhookSecret: '',
  };
}

const TEAMS: Array<[string, string]> = [
  ['Shakuni Strategists', '#8E5CF5'],
  ['Krishna Crusaders', '#2D8CFF'],
  ['Yudhisthira Yodhas', '#F2B705'],
  ['Bhima Bashers', '#E5484D'],
  ['Pandava Warriors', '#FF7A1A'],
  ['Abhimanyu Avengers', '#12B886'],
  ['Arjuna Archers', '#20C4E8'],
  ['Karna Chargers', '#E34BA9'],
];

export function defaultTeams(budget = 1800): Team[] {
  return TEAMS.map(([name, color], i) => ({
    id: `T${i + 1}`,
    name,
    color,
    budget,
    purse: budget,
    owners: [{ name: '' }, { name: '' }],
    filled: {},
  }));
}

export function initialState(): AuctionState {
  return {
    version: 0,
    rosterVersion: 0,
    phase: 'SETUP',
    lot: null,
    lastAuto: [],
    recentKeys: [],
    updatedAt: new Date().toISOString(),
    updatedBy: 'system',
  };
}

/** 88 demo players (8 per category) for local development and dry runs. */
export function demoPlayers(config: Config = defaultConfig()): Player[] {
  const players: Player[] = [];
  let sl = 1;
  for (const cat of config.categories) {
    for (let i = 1; i <= 8; i++) {
      players.push({
        id: `P${sl}`,
        slNo: sl,
        name: `${cat.name} Player ${i}`,
        photo: '',
        categoryId: cat.id,
        basePrice: cat.basePrice,
        status: 'AVAILABLE',
        isCaptain: false,
      });
      sl++;
    }
  }
  return players;
}

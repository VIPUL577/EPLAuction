// All money values are in LAKHS (1 Cr = 100 L).

export type Role = 'master' | 'admin';
export interface User {
  username: string;
  role: Role;
}

export type Phase = 'SETUP' | 'CAPTAINS' | 'PLAYERS' | 'COMPLETE';
export type PlayerStatus = 'AVAILABLE' | 'UNSOLD' | 'SOLD' | 'UNAVAILABLE';
export type SaleMode = 'AUCTION' | 'OWNER' | 'LAST_CAPTAIN' | 'LAST_IN_CATEGORY' | 'MANUAL';

export interface Category {
  id: string;
  name: string;
  basePrice: number;
}

export interface Ladder {
  threshold: number; // below this the low step applies
  stepLow: number;
  stepHigh: number;
}

export interface Multipliers {
  walletReserve: number; // 2x base of every unfilled category must remain
  ownerPlayer: number; // 3x
  lastCaptain: number; // 3x
  lastInCategory: number; // 2x
}

export interface Config {
  tournamentName: string;
  ladder: Ladder;
  multipliers: Multipliers;
  categories: Category[];
  /** Google Sheet link (shared "anyone with the link can view") with the player database. */
  sheetUrl: string;
  /** Google Apps Script Web App URL that writes the final team back into the sheet. */
  sheetWebhookUrl: string;
  sheetWebhookSecret: string;
}

export type PublicConfig = Omit<Config, 'sheetUrl' | 'sheetWebhookUrl' | 'sheetWebhookSecret'>;

export interface Owner {
  name: string;
  playerId?: string;
  isCaptain?: boolean;
}

export interface Team {
  id: string;
  name: string;
  color: string;
  budget: number;
  purse: number;
  owners: Owner[];
  /** categoryId -> playerId that fills that slot */
  filled: Record<string, string>;
  captainId?: string;
}

export interface Player {
  id: string;
  slNo: number;
  name: string;
  photo: string;
  categoryId: string;
  basePrice: number;
  status: PlayerStatus;
  isCaptain: boolean;
  teamId?: string;
  price?: number;
  saleMode?: SaleMode;
  soldAt?: string;
  age?: number;
  battingStyle?: string;
  bowlingStyle?: string;
}

/** Bids are not tied to a team: the admin only raises the price. The buyer is picked at "Sold". */
export interface Bid {
  teamId?: string;
  amount: number;
  by: string;
  at: string;
}

export interface Lot {
  playerId: string;
  status: 'LIVE' | 'SOLD' | 'UNSOLD';
  bids: Bid[];
  startedAt: string;
  closedAt?: string;
  teamId?: string;
  price?: number;
}

export interface AutoAssignment {
  playerId: string;
  teamId: string;
  price: number;
  mode: SaleMode;
}

export interface AuctionState {
  version: number;
  /** Bumped whenever players/teams/config change, so viewers know to refetch the roster. */
  rosterVersion: number;
  phase: Phase;
  lot: Lot | null;
  lastAuto: AutoAssignment[];
  recentKeys: string[];
  updatedAt: string;
  updatedBy: string;
}

export type PublicState = Omit<AuctionState, 'recentKeys'>;

export interface Snapshot {
  config: PublicConfig;
  state: PublicState;
  teams: Team[];
  players: Player[];
}

export interface AuditEntry {
  at: string;
  by: string;
  role: Role | 'system';
  action: string;
  details: unknown;
  version: number;
}

export interface BidLogEntry {
  playerId: string;
  at: string;
  by: string;
  kind: 'BID' | 'UNDO';
  teamId?: string;
  amount: number;
}

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public extra?: Record<string, unknown>,
  ) {
    super(message);
  }
}

export class ConflictError extends Error {
  constructor() {
    super('Version conflict');
  }
}

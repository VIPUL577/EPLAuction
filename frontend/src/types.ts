// Mirrors backend/src/core/types.ts (public shapes). Money is in lakhs.
export type Role = 'master' | 'admin';
export type Phase = 'SETUP' | 'CAPTAINS' | 'PLAYERS' | 'COMPLETE';
export type PlayerStatus = 'AVAILABLE' | 'UNSOLD' | 'SOLD' | 'UNAVAILABLE';
export type SaleMode = 'AUCTION' | 'OWNER' | 'LAST_CAPTAIN' | 'LAST_IN_CATEGORY' | 'MANUAL';

export interface Category { id: string; name: string; basePrice: number }
export interface Ladder { threshold: number; stepLow: number; stepHigh: number }
export interface Multipliers { walletReserve: number; ownerPlayer: number; lastCaptain: number; lastInCategory: number }

export interface PublicConfig {
  tournamentName: string;
  ladder: Ladder;
  multipliers: Multipliers;
  categories: Category[];
}
export interface Config extends PublicConfig {
  sheetUrl: string;
  sheetWebhookUrl: string;
  sheetWebhookSecret: string;
}

export interface Owner { name: string; playerId?: string; isCaptain?: boolean }
export interface Team {
  id: string; name: string; color: string; budget: number; purse: number;
  owners: Owner[]; filled: Record<string, string>; captainId?: string;
}
export interface Player {
  id: string; slNo: number; name: string; photo: string; categoryId: string; basePrice: number;
  status: PlayerStatus; isCaptain: boolean; teamId?: string; price?: number; saleMode?: SaleMode; soldAt?: string;
  age?: number; battingStyle?: string; bowlingStyle?: string;
}
export interface Bid { teamId?: string; amount: number; by: string; at: string }
export interface Lot {
  playerId: string; status: 'LIVE' | 'SOLD' | 'UNSOLD'; bids: Bid[];
  startedAt: string; closedAt?: string; teamId?: string; price?: number;
}
export interface AutoAssignment { playerId: string; teamId: string; price: number; mode: SaleMode }
export interface AuctionState {
  version: number; rosterVersion: number; phase: Phase; lot: Lot | null;
  lastAuto: AutoAssignment[]; updatedAt: string; updatedBy: string;
}
export interface Snapshot { config: PublicConfig; state: AuctionState; teams: Team[]; players: Player[] }
export interface AuditEntry { at: string; by: string; role: string; action: string; details: unknown; version: number }
export interface User { username: string; role: Role }

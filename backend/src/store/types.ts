import type { AuctionState, AuditEntry, BidLogEntry, Config, Player, Team } from '../core/types.js';

export interface CommitInput {
  /** The STATE item must currently have this version (-1 = must not exist yet). */
  expectedVersion: number;
  state: AuctionState;
  config?: Config;
  teams?: Team[];
  players?: Player[];
  deleteTeamIds?: string[];
  deletePlayerIds?: string[];
}

export interface Store {
  getMeta(): Promise<{ config: Config; state: AuctionState } | null>;
  getTeam(id: string): Promise<Team | undefined>;
  listTeams(): Promise<Team[]>;
  getPlayer(id: string): Promise<Player | undefined>;
  listPlayers(): Promise<Player[]>;
  /** Atomic, optimistic-concurrency write. Throws ConflictError if the version moved. */
  commit(input: CommitInput): Promise<void>;
  addAudit(entry: AuditEntry): Promise<void>;
  addBidLog(entry: BidLogEntry): Promise<void>;
  listAudit(limit: number): Promise<AuditEntry[]>;
  listBidLog(playerId: string): Promise<BidLogEntry[]>;
  addConnection(id: string): Promise<void>;
  removeConnection(id: string): Promise<void>;
  listConnections(): Promise<string[]>;
}

export interface Broadcaster {
  broadcast(message: unknown): Promise<void>;
}

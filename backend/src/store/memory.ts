// In-memory store used by the local dev server and the tests. Same semantics as DynamoStore.
import { ConflictError, type AuctionState, type AuditEntry, type BidLogEntry, type Config, type Player, type Team } from '../core/types.js';
import type { CommitInput, Store } from './types.js';

const clone = <T>(v: T): T => structuredClone(v);

export class MemoryStore implements Store {
  private config?: Config;
  private state?: AuctionState;
  private teams = new Map<string, Team>();
  private players = new Map<string, Player>();
  private audit: AuditEntry[] = [];
  private bids: BidLogEntry[] = [];
  private conns = new Set<string>();

  async getMeta() {
    if (!this.config || !this.state) return null;
    return { config: clone(this.config), state: clone(this.state) };
  }
  async getTeam(id: string) {
    const t = this.teams.get(id);
    return t && clone(t);
  }
  async listTeams() {
    return [...this.teams.values()].map(clone).sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
  }
  async getPlayer(id: string) {
    const p = this.players.get(id);
    return p && clone(p);
  }
  async listPlayers() {
    return [...this.players.values()].map(clone).sort((a, b) => a.slNo - b.slNo);
  }
  async commit(c: CommitInput) {
    const current = this.state ? this.state.version : -1;
    if (current !== c.expectedVersion) throw new ConflictError();
    this.state = clone(c.state);
    if (c.config) this.config = clone(c.config);
    for (const t of c.teams ?? []) this.teams.set(t.id, clone(t));
    for (const p of c.players ?? []) this.players.set(p.id, clone(p));
    for (const id of c.deleteTeamIds ?? []) this.teams.delete(id);
    for (const id of c.deletePlayerIds ?? []) this.players.delete(id);
  }
  async addAudit(e: AuditEntry) {
    this.audit.push(clone(e));
  }
  async addBidLog(e: BidLogEntry) {
    this.bids.push(clone(e));
  }
  async listAudit(limit: number) {
    return this.audit.slice(-limit).reverse();
  }
  async listBidLog(playerId: string) {
    return this.bids.filter((b) => b.playerId === playerId);
  }
  async addConnection(id: string) {
    this.conns.add(id);
  }
  async removeConnection(id: string) {
    this.conns.delete(id);
  }
  async listConnections() {
    return [...this.conns];
  }
}

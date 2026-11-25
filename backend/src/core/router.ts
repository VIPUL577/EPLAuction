// Transport-agnostic HTTP router shared by the Lambda handler and the local dev server.
import { Engine, type CommandInput, type CommandResult } from './engine.js';
import { HttpError, type User } from './types.js';

export interface ApiRequest {
  method: string;
  path: string;
  query: Record<string, string | undefined>;
  body: unknown;
  user?: User;
}

export interface ApiResponse {
  status: number;
  body: unknown;
  cacheControl: string;
}

type Command = (user: User, input: CommandInput) => Promise<CommandResult>;

export function createRouter(engine: Engine) {
  const commands: Record<string, Command> = {
    draw: (u, i) => engine.draw(u, i),
    bid: (u, i) => engine.bid(u, i),
    undo: (u, i) => engine.undoBid(u, i),
    sell: (u, i) => engine.sell(u, i),
    unsold: (u, i) => engine.unsold(u, i),
    sync: (u, i) => engine.syncFromSheet(u, i),
    'push-sheet': (u, i) => engine.pushAllToSheet(u, i),
    // master only (checked inside the engine as well)
    config: (u, i) => engine.saveConfig(u, i),
    teams: (u, i) => engine.saveTeams(u, i),
    import: (u, i) => engine.importFromSheet(u, i),
    player: (u, i) => engine.upsertPlayer(u, i),
    'player-delete': (u, i) => engine.deletePlayer(u, i),
    captains: (u, i) => engine.setCaptains(u, i),
    start: (u, i) => engine.start(u, i),
    revert: (u, i) => engine.revertSale(u, i),
    reset: (u, i) => engine.reset(u, i),
  };

  const NO_STORE = 'no-store';

  return async function route(req: ApiRequest): Promise<ApiResponse> {
    try {
      const { method, path } = req;

      // ---- public, read-only (cacheable by CloudFront) ----
      if (method === 'GET' && path === '/api/public/snapshot') {
        const snap = await engine.snapshot();
        const rv = Number(req.query.rv);
        // A request pinned to a roster version is immutable once served -> long cache.
        const pinned = Number.isFinite(rv) && rv > 0 && snap.state.rosterVersion >= rv;
        return { status: 200, body: snap, cacheControl: pinned ? 'public, max-age=300' : 'public, max-age=2' };
      }
      if (method === 'GET' && path === '/api/public/health') {
        return { status: 200, body: { ok: true }, cacheControl: NO_STORE };
      }

      // ---- admin ----
      if (!path.startsWith('/api/admin/')) throw new HttpError(404, 'Not found');
      const user = req.user;
      if (!user) throw new HttpError(401, 'Please log in');
      const sub = path.slice('/api/admin/'.length);

      if (method === 'GET') {
        if (sub === 'me') return { status: 200, body: user, cacheControl: NO_STORE };
        if (sub === 'snapshot') return { status: 200, body: await engine.snapshot(), cacheControl: NO_STORE };
        if (sub === 'config') {
          if (user.role !== 'master') throw new HttpError(403, 'Only the master admin can view settings');
          return { status: 200, body: await engine.fullConfig(), cacheControl: NO_STORE };
        }
        if (sub === 'audit') return { status: 200, body: await engine.audit(Number(req.query.limit) || 200), cacheControl: NO_STORE };
        if (sub === 'bids') return { status: 200, body: await engine.bidLog(String(req.query.playerId ?? '')), cacheControl: NO_STORE };
        throw new HttpError(404, 'Not found');
      }

      if (method === 'POST') {
        const cmd = commands[sub];
        if (!cmd) throw new HttpError(404, `Unknown command ${sub}`);
        const input = (req.body && typeof req.body === 'object' ? req.body : {}) as CommandInput;
        return { status: 200, body: await cmd(user, input), cacheControl: NO_STORE };
      }
      throw new HttpError(405, 'Method not allowed');
    } catch (e) {
      if (e instanceof HttpError) {
        return { status: e.status, body: { ok: false, error: e.message, ...e.extra }, cacheControl: NO_STORE };
      }
      console.error(e);
      return { status: 500, body: { ok: false, error: 'Server error, please retry' }, cacheControl: NO_STORE };
    }
  };
}

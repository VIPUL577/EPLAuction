// Local development server: same engine + router, in-memory store, `ws` for WebSockets,
// and simple username/password logins instead of Cognito. Never deployed.
//
//   npm run dev     -> http://localhost:8787  (the Vite dev server proxies /api to here)
import { createServer } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import { demoPlayers, defaultConfig, defaultTeams, initialState } from '../core/defaults.js';
import { Engine } from '../core/engine.js';
import { createRouter } from '../core/router.js';
import type { Role, User } from '../core/types.js';
import { MemoryStore } from '../store/memory.js';

const PORT = Number(process.env.PORT ?? 8787);

// Hardcoded logins (override with DEV_USERS="user:pass:role,...")
const users = new Map<string, { password: string; role: Role }>();
for (const spec of (process.env.DEV_USERS ?? 'eashan:unsoldEashan:master,admin1:Pass@7:admin,admin2:Pass@11:admin,admin3:Pass@15:admin,admin4:Pass@19:admin').split(',')) {
  const [u, p, r] = spec.split(':');
  users.set(u, { password: p, role: r === 'master' ? 'master' : 'admin' });
}

const store = new MemoryStore();
const sockets = new Set<WebSocket>();
const engine = new Engine(store, {
  async broadcast(msg) {
    const data = JSON.stringify(msg);
    for (const s of sockets) if (s.readyState === WebSocket.OPEN) s.send(data);
  },
});
const route = createRouter(engine);

// Seed with demo data so the UI is usable immediately.
const config = defaultConfig();
await store.commit({ expectedVersion: -1, state: initialState(), config, teams: defaultTeams(), players: demoPlayers(config) });

const tokens = new Map<string, User>();

function readBody(req: import('node:http').IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);
  const send = (status: number, body: unknown, cache = 'no-store') => {
    res.writeHead(status, { 'content-type': 'application/json', 'cache-control': cache });
    res.end(JSON.stringify(body));
  };
  let body: unknown;
  try {
    const raw = await readBody(req);
    body = raw ? JSON.parse(raw) : undefined;
  } catch {
    return send(400, { ok: false, error: 'Invalid JSON' });
  }

  if (req.method === 'POST' && url.pathname === '/api/dev/login') {
    const { username, password } = (body ?? {}) as { username?: string; password?: string };
    const u = users.get(String(username));
    if (!u || u.password !== password) return send(401, { ok: false, error: 'Wrong username or password' });
    const token = `dev-${Math.random().toString(36).slice(2)}`;
    tokens.set(token, { username: String(username), role: u.role });
    return send(200, { token, username, role: u.role });
  }

  const auth = req.headers.authorization?.replace(/^Bearer\s+/i, '');
  const user = auth ? tokens.get(auth) : undefined;
  const r = await route({ method: req.method ?? 'GET', path: url.pathname, query: Object.fromEntries(url.searchParams), body, user });
  send(r.status, r.body, r.cacheControl);
});

const wss = new WebSocketServer({ server, path: '/ws' });
wss.on('connection', (ws) => {
  sockets.add(ws);
  ws.on('close', () => sockets.delete(ws));
});

server.listen(PORT, () => {
  console.log(`EPL Auction dev API on http://localhost:${PORT}  (ws://localhost:${PORT}/ws)`);
  console.log('Dev logins: eashan (master), admin1..admin4 (admin)');
});

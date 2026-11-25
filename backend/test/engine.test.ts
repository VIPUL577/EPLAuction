import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import { defaultConfig, defaultTeams, demoPlayers, initialState } from '../src/core/defaults.js';
import { Engine } from '../src/core/engine.js';
import { createRouter } from '../src/core/router.js';
import { HttpError, type User } from '../src/core/types.js';
import { MemoryStore } from '../src/store/memory.js';

const master: User = { username: 'master', role: 'master' };
const admin: User = { username: 'admin1', role: 'admin' };

let store: MemoryStore;
let engine: Engine;
let messages: unknown[];

beforeEach(async () => {
  store = new MemoryStore();
  messages = [];
  engine = new Engine(store, { broadcast: async (m) => void messages.push(m) });
  const config = defaultConfig();
  await store.commit({ expectedVersion: -1, state: initialState(), config, teams: defaultTeams(), players: demoPlayers(config) });
});

const version = async () => (await store.getMeta())!.state.version;
const rejects400 = (p: Promise<unknown>, re: RegExp) =>
  assert.rejects(p, (e: unknown) => e instanceof HttpError && e.status === 400 && re.test(e.message));

/** Captains P1, P9, P17 ... (first player of categories 1..8). */
const captainIds = () => Array.from({ length: 8 }, (_, i) => `P${i * 8 + 1}`);

async function startWithCaptains() {
  await engine.setCaptains(master, { playerIds: captainIds() });
  await engine.start(master, {});
}

test('normal admins cannot use master commands', async () => {
  await assert.rejects(engine.start(admin, {}), (e: unknown) => e instanceof HttpError && e.status === 403);
});

test('start requires exactly one captain per team', async () => {
  await rejects400(engine.start(master, {}), /exactly 8 captains/);
});

test('captains are auctioned first; last captain auto-goes at 3x', async () => {
  await startWithCaptains();
  let meta = (await store.getMeta())!;
  assert.equal(meta.state.phase, 'CAPTAINS');
  const teams = defaultTeams();
  for (let i = 0; i < 7; i++) {
    await engine.draw(admin, {});
    meta = (await store.getMeta())!;
    const lot = meta.state.lot!;
    assert.ok(captainIds().includes(lot.playerId), 'only captains are drawn in the captain phase');
    // pick a team without a captain
    const t = (await store.listTeams()).find((x) => !x.captainId)!;
    await engine.bid(admin, { version: await version() });
    await engine.sell(admin, { teamId: t.id, version: await version() });
  }
  meta = (await store.getMeta())!;
  assert.equal(meta.state.phase, 'PLAYERS');
  assert.equal(meta.state.lastAuto[0]?.mode, 'LAST_CAPTAIN');
  const auto = await store.getPlayer(meta.state.lastAuto[0].playerId);
  const base = defaultConfig().categories.find((c) => c.id === auto!.categoryId)!.basePrice;
  assert.equal(auto!.price, base * 3);
  assert.equal((await store.listTeams()).filter((t) => t.captainId).length, teams.length);
});

test('owner-player is pre-assigned at 3x; owner-captain fills the captain slot', async () => {
  const teams = await store.listTeams();
  teams[0].owners = [{ name: 'Owner A', playerId: 'P1', isCaptain: true }, { name: 'Owner B', playerId: 'P20' }];
  await engine.saveTeams(master, { teams });
  await engine.setCaptains(master, { playerIds: captainIds() });
  await engine.start(master, {});
  const t1 = (await store.getTeam('T1'))!;
  assert.equal(t1.captainId, 'P1');
  assert.equal((await store.getPlayer('P1'))!.price, 270); // AR1 90 x3
  assert.equal((await store.getPlayer('P20'))!.price, 210); // P20 is Batsman 1 (70) x3
  assert.equal(t1.purse, 1800 - 270 - 210);
});

test('concurrent bids on the same version: exactly one wins, the other gets 409', async () => {
  await startWithCaptains();
  await engine.draw(admin, {});
  const v = await version();
  const results = await Promise.allSettled([
    engine.bid(admin, { version: v }),
    engine.bid({ username: 'admin2', role: 'admin' }, { version: v }),
  ]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  const failed = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
  assert.equal((failed.reason as HttpError).status, 409);
  assert.equal((await store.getMeta())!.state.lot!.bids.length, 1);
});

test('idempotent retries do not double-bid', async () => {
  await startWithCaptains();
  await engine.draw(admin, {});
  const v = await version();
  await engine.bid(admin, { version: v, requestId: 'abc' });
  const again = await engine.bid(admin, { version: v, requestId: 'abc' });
  assert.equal(again.duplicate, true);
  assert.equal((await store.getMeta())!.state.lot!.bids.length, 1);
});

test('ladder (no team needed), undo and broadcast after persistence', async () => {
  await startWithCaptains();
  await engine.draw(admin, {});
  const lot = (await store.getMeta())!.state.lot!;
  const player = (await store.getPlayer(lot.playerId))!;
  const base = defaultConfig().categories.find((c) => c.id === player.categoryId)!.basePrice;
  await engine.bid(admin, {});
  await engine.bid(admin, {});
  let bids = (await store.getMeta())!.state.lot!.bids;
  assert.deepEqual(bids.map((b) => b.amount), [base, base + 10]);
  assert.ok(bids.every((b) => b.teamId === undefined));
  await engine.undoBid(admin, {});
  bids = (await store.getMeta())!.state.lot!.bids;
  assert.equal(bids.length, 1);
  assert.ok(messages.length >= 4);
  const log = await store.listBidLog(lot.playerId);
  assert.deepEqual(log.map((l) => l.kind), ['BID', 'BID', 'UNDO']);
});

test('bids below base / wallet rule violations are rejected', async () => {
  await startWithCaptains();
  await engine.draw(admin, {});
  await rejects400(engine.bid(admin, { amount: 5 }), /below the base/);
  await rejects400(engine.bid(admin, { amount: 1700 }), /No team can bid/);
});

test('sold once only; unsold players return to the pool', async () => {
  await startWithCaptains();
  await engine.draw(admin, {});
  await engine.unsold(admin, {});
  const unsoldId = (await store.getMeta())!.state.lot!.playerId;
  assert.equal((await store.getPlayer(unsoldId))!.status, 'UNSOLD');
  await engine.draw(admin, {});
  await engine.bid(admin, {});
  await rejects400(engine.sell(admin, {}), /Tick the team/);
  await engine.sell(admin, { teamId: 'T3' });
  await rejects400(engine.sell(admin, { teamId: 'T3' }), /No player is currently up/);
});

test('full auction completes with forced last-in-category assignments at 2x', async () => {
  await startWithCaptains();
  let guard = 0;
  while ((await store.getMeta())!.state.phase !== 'COMPLETE' && guard++ < 200) {
    await engine.draw(admin, {});
    const meta = (await store.getMeta())!;
    const p = (await store.getPlayer(meta.state.lot!.playerId))!;
    const teams = await store.listTeams();
    const t = teams.find((x) => !x.filled[p.categoryId] && (meta.state.phase !== 'CAPTAINS' || !x.captainId))!;
    await engine.bid(admin, {});
    await engine.sell(admin, { teamId: t.id });
  }
  const teams = await store.listTeams();
  assert.equal((await store.getMeta())!.state.phase, 'COMPLETE');
  for (const t of teams) {
    assert.equal(Object.keys(t.filled).length, 11);
    assert.ok(t.captainId);
    assert.ok(t.purse >= 0);
  }
  const players = await store.listPlayers();
  assert.equal(players.filter((p) => p.saleMode === 'LAST_IN_CATEGORY').length, 11); // one per category
  assert.ok(players.filter((p) => p.saleMode === 'LAST_IN_CATEGORY').every((p) => p.price === defaultConfig().categories.find((c) => c.id === p.categoryId)!.basePrice * 2));
  assert.ok(players.every((p) => p.status === 'SOLD'));
});

test('router: public snapshot hides sheet secrets; admin routes need a user', async () => {
  await engine.saveConfig(master, { config: { sheetWebhookSecret: 'shh', sheetWebhookUrl: 'https://script.google.com/macros/s/x/exec' } });
  const route = createRouter(engine);
  const pub = await route({ method: 'GET', path: '/api/public/snapshot', query: {}, body: undefined });
  assert.equal(pub.status, 200);
  assert.ok(!JSON.stringify(pub.body).includes('shh'));
  const denied = await route({ method: 'POST', path: '/api/admin/bid', query: {}, body: {} });
  assert.equal(denied.status, 401);
  const forbidden = await route({ method: 'POST', path: '/api/admin/reset', query: {}, body: { confirm: 'RESET' }, user: admin });
  assert.equal(forbidden.status, 403);
});

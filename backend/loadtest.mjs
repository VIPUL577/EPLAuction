// WebSocket load test: opens N viewer connections, then reports how many received each broadcast.
//   WS_URL=wss://xxxx.execute-api.ap-south-1.amazonaws.com/prod N=300 npm run loadtest
// While it runs, place a few bids from the admin console and watch the counts.
// Cost note: 300 connections for 10 minutes = 3,000 connection-minutes + 300 messages per broadcast.
import WebSocket from 'ws';

const URL = process.env.WS_URL ?? 'ws://localhost:8787/ws';
const N = Number(process.env.N ?? 300);
const DURATION_S = Number(process.env.DURATION ?? 600);

let open = 0, failed = 0, closed = 0;
const received = new Map(); // state.version -> count
const latencies = [];
const sockets = [];

for (let i = 0; i < N; i++) {
  await new Promise((r) => setTimeout(r, 20)); // ramp up ~50 connections/s
  const ws = new WebSocket(URL);
  ws.on('open', () => open++);
  ws.on('error', () => failed++);
  ws.on('close', () => closed++);
  ws.on('message', (buf) => {
    try {
      const msg = JSON.parse(buf.toString());
      if (msg.type !== 'state') return;
      const v = msg.state.version;
      received.set(v, (received.get(v) ?? 0) + 1);
      latencies.push(Date.now() - Date.parse(msg.state.updatedAt));
    } catch {}
  });
  sockets.push(ws);
}

const report = () => {
  const lines = [...received.entries()].slice(-5).map(([v, c]) => `v${v}: ${c}/${open}`).join('  ');
  const sorted = [...latencies].sort((a, b) => a - b);
  const p95 = sorted.length ? sorted[Math.floor(sorted.length * 0.95)] : '-';
  console.log(`open=${open} failed=${failed} closed=${closed} | ${lines || 'no broadcasts yet'} | p95 delivery ${p95} ms`);
};
const timer = setInterval(report, 5000);
setTimeout(() => {
  clearInterval(timer);
  report();
  sockets.forEach((s) => s.close());
  setTimeout(() => process.exit(0), 1000);
}, DURATION_S * 1000);

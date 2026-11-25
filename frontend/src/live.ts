// Real-time auction data: one HTTP snapshot on load / reconnect, then WebSocket pushes.
// No polling. Small "state" messages carry bids; when the roster changes the message carries a
// new rosterVersion and the client refetches the (CloudFront-cached) snapshot for that version.
import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchSnapshot } from './api';
import { appConfig } from './config';
import type { AuctionState, Snapshot } from './types';

export type ConnStatus = 'connecting' | 'live' | 'offline';

const PING_MS = 8 * 60_000; // API Gateway drops idle sockets after 10 min
const HIDDEN_CLOSE_MS = 3 * 60_000; // save connection-minutes when the tab is in the background

export function useLive() {
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [status, setStatus] = useState<ConnStatus>('connecting');
  const [error, setError] = useState<string | null>(null);
  const snapRef = useRef<Snapshot | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const retry = useRef(0);
  const timers = useRef<{ ping?: number; reconnect?: number; hidden?: number }>({});
  const stopped = useRef(false);

  const rosterRv = useRef(-1); // roster version of the teams/players we currently hold

  const apply = useCallback((next: Snapshot) => {
    const cur = snapRef.current;
    const takeRoster = !cur || next.state.rosterVersion >= rosterRv.current;
    const takeState = !cur || next.state.version >= cur.state.version;
    if (!takeRoster && !takeState) return;
    const merged: Snapshot = {
      config: takeRoster ? next.config : cur!.config,
      teams: takeRoster ? next.teams : cur!.teams,
      players: takeRoster ? next.players : cur!.players,
      state: takeState ? next.state : cur!.state,
    };
    if (takeRoster) rosterRv.current = next.state.rosterVersion;
    snapRef.current = merged;
    setSnap(merged);
  }, []);

  const refresh = useCallback(
    async (rv?: number) => {
      try {
        apply(await fetchSnapshot(rv));
        setError(null);
      } catch (e) {
        setError((e as Error).message);
      }
    },
    [apply],
  );

  /** Apply a state that came from a WebSocket push or from an admin command response. */
  const applyState = useCallback(
    (state: AuctionState) => {
      const cur = snapRef.current;
      if (!cur) return void refresh();
      if (state.version <= cur.state.version) return;
      const next = { ...cur, state };
      snapRef.current = next;
      setSnap(next);
      if (state.rosterVersion > rosterRv.current) void refresh(state.rosterVersion);
    },
    [refresh],
  );

  const connect = useCallback(() => {
    if (stopped.current) return;
    const old = wsRef.current;
    if (old && (old.readyState === WebSocket.OPEN || old.readyState === WebSocket.CONNECTING)) return;
    setStatus('connecting');
    const ws = new WebSocket(appConfig().wsUrl);
    wsRef.current = ws;
    ws.onopen = () => {
      retry.current = 0;
      setStatus('live');
      void refresh(); // catch up on anything missed while disconnected
      window.clearInterval(timers.current.ping);
      timers.current.ping = window.setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) ws.send('{"action":"ping"}');
      }, PING_MS);
    };
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        if (msg.type === 'state') applyState(msg.state);
      } catch {
        /* ignore */
      }
    };
    ws.onclose = () => {
      window.clearInterval(timers.current.ping);
      if (wsRef.current !== ws) return;
      wsRef.current = null;
      setStatus('offline');
      if (stopped.current || document.hidden) return;
      const delay = Math.min(30_000, 1000 * 2 ** retry.current) + Math.random() * 1000;
      retry.current++;
      timers.current.reconnect = window.setTimeout(connect, delay);
    };
    ws.onerror = () => ws.close();
  }, [applyState, refresh]);

  useEffect(() => {
    stopped.current = false;
    void refresh();
    connect();
    const onVisibility = () => {
      window.clearTimeout(timers.current.hidden);
      if (document.hidden) {
        timers.current.hidden = window.setTimeout(() => wsRef.current?.close(), HIDDEN_CLOSE_MS);
      } else {
        connect();
      }
    };
    const onOnline = () => connect();
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('online', onOnline);
    return () => {
      stopped.current = true;
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('online', onOnline);
      Object.values(timers.current).forEach((t) => {
        window.clearTimeout(t);
        window.clearInterval(t);
      });
      wsRef.current?.close();
    };
  }, [connect, refresh]);

  return { snap, status, error, refresh, applyState };
}

export function useIsMobile(query = '(max-width: 820px)') {
  const [m, setM] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setM(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [query]);
  return m;
}

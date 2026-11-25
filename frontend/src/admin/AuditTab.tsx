import { useCallback, useEffect, useState } from 'react';
import { fetchAudit } from '../api';
import type { AuditEntry } from '../types';
import type { AdminCtx } from './AdminApp';

export function AuditTab({ ctx }: { ctx: AdminCtx }) {
  const [rows, setRows] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState('');
  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows(await fetchAudit(500));
    } catch (e) {
      ctx.toast('err', (e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [ctx.toast]);
  useEffect(() => {
    void load();
  }, [load]);

  const players = new Map(ctx.snap.players.map((p) => [p.id, p.name]));
  const teams = new Map(ctx.snap.teams.map((t) => [t.id, t.name]));
  const pretty = (d: unknown) =>
    JSON.stringify(d)
      .replace(/"playerId":"(P\d+)"/g, (_, id) => `"player":"${players.get(id) ?? id}"`)
      .replace(/"teamId":"(T\d+)"/g, (_, id) => `"team":"${teams.get(id) ?? id}"`);
  const list = rows.filter((r) => !filter || r.action === filter);

  return (
    <div className="panel">
      <div className="toolbar">
        <h3 className="panel-title">Audit trail <span className="muted small">every admin action, newest first</span></h3>
        <select value={filter} onChange={(e) => setFilter(e.target.value)}>
          <option value="">All actions</option>
          {[...new Set(rows.map((r) => r.action))].sort().map((a) => <option key={a}>{a}</option>)}
        </select>
        <button className="btn" onClick={load} disabled={loading}>{loading ? 'Loading...' : 'Reload'}</button>
      </div>
      <table className="table audit">
        <thead><tr><th>Time</th><th>Admin</th><th>Action</th><th>v</th><th>Details</th></tr></thead>
        <tbody>
          {list.map((r, i) => (
            <tr key={r.at + i}>
              <td className="nowrap">{new Date(r.at).toLocaleString()}</td>
              <td>{r.by} <span className="muted small">{r.role}</span></td>
              <td><b>{r.action}</b></td>
              <td>{r.version}</td>
              <td><code>{pretty(r.details)}</code></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

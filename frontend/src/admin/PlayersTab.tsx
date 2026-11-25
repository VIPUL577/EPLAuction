import { useState } from 'react';
import { Photo, TeamDot } from '../components/common';
import { SALE_LABEL, basePriceOf, categoryName, money } from '../format';
import type { Player } from '../types';
import type { AdminCtx } from './AdminApp';

export function PlayersTab({ ctx }: { ctx: AdminCtx }) {
  const { snap, user, run, busy } = ctx;
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('');
  const [status, setStatus] = useState('');
  const [editing, setEditing] = useState<Partial<Player> | null>(null);
  const master = user.role === 'master';
  const teams = new Map(snap.teams.map((t) => [t.id, t]));
  const list = snap.players.filter(
    (p) =>
      (!q || p.name.toLowerCase().includes(q.toLowerCase()) || String(p.slNo) === q) &&
      (!cat || p.categoryId === cat) &&
      (!status || p.status === status),
  );

  return (
    <div className="panel">
      <div className="toolbar">
        <h3 className="panel-title">Players <span className="muted small">{list.length} of {snap.players.length}</span></h3>
        <input className="search" placeholder="Search name or Sl No" value={q} onChange={(e) => setQ(e.target.value)} />
        <select value={cat} onChange={(e) => setCat(e.target.value)}>
          <option value="">All categories</option>
          {snap.config.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">Any status</option>
          {['AVAILABLE', 'UNSOLD', 'SOLD', 'UNAVAILABLE'].map((s) => <option key={s}>{s}</option>)}
        </select>
        {master && <button className="btn btn-gold" onClick={() => setEditing({ categoryId: snap.config.categories[0]?.id })}>+ Add player</button>}
      </div>
      <table className="table">
        <thead>
          <tr><th>#</th><th></th><th>Name</th><th>Category</th><th>Base</th><th>Status</th><th>Team</th><th>Price</th><th></th></tr>
        </thead>
        <tbody>
          {list.map((p) => (
            <tr key={p.id} className={p.status === 'UNAVAILABLE' ? 'dim' : ''}>
              <td>{p.slNo}</td>
              <td><Photo player={p} size="sm" /></td>
              <td>{p.name} {p.isCaptain && <em className="c-badge">C</em>}</td>
              <td>{categoryName(snap.config, p.categoryId)}</td>
              <td>{money(basePriceOf(p, snap.config))}</td>
              <td><span className={`status status-${p.status.toLowerCase()}`}>{p.status}</span></td>
              <td>{p.teamId ? <TeamDot team={teams.get(p.teamId)} /> : ''}</td>
              <td>{p.price !== undefined ? <>{money(p.price)} <span className="muted small">{p.saleMode && p.saleMode !== 'AUCTION' ? SALE_LABEL[p.saleMode] : ''}</span></> : ''}</td>
              <td className="actions">
                {master && <button className="btn btn-sm" onClick={() => setEditing(p)}>Edit</button>}
                {master && p.teamId && (
                  <button
                    className="btn btn-sm btn-red"
                    disabled={busy}
                    onClick={() => confirm(`Revert the sale of ${p.name}? The money goes back to the team.`) && run('revert', { playerId: p.id }, { okText: 'Sale reverted' })}
                  >
                    Revert sale
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {editing && <PlayerEditor ctx={ctx} initial={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function PlayerEditor({ ctx, initial, onClose }: { ctx: AdminCtx; initial: Partial<Player>; onClose: () => void }) {
  const { snap, run, busy } = ctx;
  const [p, setP] = useState<Partial<Player>>(initial);
  const isNew = !initial.id;
  const setup = snap.state.phase === 'SETUP';
  const set = (k: keyof Player, v: unknown) => setP((x) => ({ ...x, [k]: v }));
  const save = async () => {
    const r = await run('player', { player: p }, { okText: isNew ? 'Player added' : 'Player saved' });
    if (r) onClose();
  };
  const del = async () => {
    if (!confirm(`Delete ${p.name}?`)) return;
    const r = await run('player-delete', { playerId: p.id }, { okText: 'Player deleted' });
    if (r) onClose();
  };
  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>{isNew ? 'Add player' : `Edit ${initial.name}`}</h2>
        <div className="form-grid">
          {isNew && <label>Sl No<input type="number" value={p.slNo ?? ''} onChange={(e) => set('slNo', Number(e.target.value))} placeholder="auto" /></label>}
          <label>Name<input value={p.name ?? ''} onChange={(e) => set('name', e.target.value)} /></label>
          <label className="wide">Photo URL (Google Drive link works)<input value={p.photo ?? ''} onChange={(e) => set('photo', e.target.value)} /></label>
          <label>Category
            <select value={p.categoryId} disabled={!setup && !isNew} onChange={(e) => set('categoryId', e.target.value)}>
              {snap.config.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
          <label>Base price (L)<input type="number" value={p.basePrice ?? ''} onChange={(e) => set('basePrice', Number(e.target.value))} placeholder="category default" /></label>
          <label>Availability
            <select value={p.status === 'UNAVAILABLE' ? 'UNAVAILABLE' : 'AVAILABLE'} disabled={p.status === 'SOLD'} onChange={(e) => set('status', e.target.value)}>
              <option value="AVAILABLE">Eligible for auction</option>
              <option value="UNAVAILABLE">Unavailable</option>
            </select>
          </label>
          <label>Age<input type="number" value={p.age ?? ''} onChange={(e) => set('age', e.target.value)} /></label>
          <label>Batting style<input value={p.battingStyle ?? ''} onChange={(e) => set('battingStyle', e.target.value)} /></label>
          <label>Bowling style<input value={p.bowlingStyle ?? ''} onChange={(e) => set('bowlingStyle', e.target.value)} /></label>
        </div>
        <p className="muted small">Photos: paste a Google Drive share link (file shared "Anyone with the link"). It is shown resized to 600px.</p>
        <div className="modal-actions">
          <button className="btn btn-gold" onClick={save} disabled={busy}>Save</button>
          {!isNew && setup && <button className="btn btn-red" onClick={del} disabled={busy}>Delete</button>}
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

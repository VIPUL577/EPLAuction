import { useEffect, useState } from 'react';
import { money } from '../format';
import { TeamsPanel } from '../public/panels';
import type { Team } from '../types';
import type { AdminCtx } from './AdminApp';

export function TeamsTab({ ctx }: { ctx: AdminCtx }) {
  const { snap, user, run, busy } = ctx;
  const master = user.role === 'master';
  const setup = snap.state.phase === 'SETUP';
  const [draft, setDraft] = useState<Team[]>(snap.teams);
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    if (!dirty) setDraft(snap.teams);
  }, [snap.teams, dirty]);

  const update = (i: number, patch: Partial<Team>) => {
    setDirty(true);
    setDraft((d) => d.map((t, j) => (j === i ? { ...t, ...patch } : t)));
  };
  const updateOwner = (i: number, o: number, patch: Record<string, unknown>) => {
    const base = [...(draft[i].owners ?? [])];
    while (base.length < 2) base.push({ name: '' });
    const owners = base.map((x, k) => (k === o ? { ...x, ...patch } : patch.isCaptain ? { ...x, isCaptain: false } : x));
    update(i, { owners });
  };
  const save = async () => {
    const r = await run('teams', { teams: draft }, { okText: 'Teams saved' });
    if (r) setDirty(false);
  };

  if (!master) return <TeamsPanel snap={snap} />;
  const usable = snap.players.filter((p) => p.status !== 'UNAVAILABLE');

  return (
    <div className="teams-admin">
      <div className="panel">
        <div className="toolbar">
          <h3 className="panel-title">Teams & owners</h3>
          {!setup && <span className="muted small">Auction started: only names and colours can change now.</span>}
          <span className="spacer" />
          {setup && (
            <button
              className="btn"
              onClick={() => {
                setDirty(true);
                setDraft((d) => [...d, { id: '', name: 'New team', color: '#888888', budget: d[0]?.budget ?? 1800, purse: 0, owners: [{ name: '' }, { name: '' }], filled: {} }]);
              }}
            >
              + Add team
            </button>
          )}
          <button className="btn btn-ghost" disabled={!dirty} onClick={() => { setDirty(false); setDraft(snap.teams); }}>Discard</button>
          <button className="btn btn-gold" disabled={!dirty || busy} onClick={save}>Save teams</button>
        </div>
        <table className="table">
          <thead>
            <tr><th>Team</th><th>Colour</th><th>Budget (L)</th><th>Owner 1 · player? · captain?</th><th>Owner 2 · player? · captain?</th><th></th></tr>
          </thead>
          <tbody>
            {draft.map((t, i) => (
              <tr key={t.id || `new${i}`}>
                <td><input value={t.name} onChange={(e) => update(i, { name: e.target.value })} /></td>
                <td><input type="color" value={t.color} onChange={(e) => update(i, { color: e.target.value.toUpperCase() })} /></td>
                <td>
                  <input type="number" disabled={!setup} value={t.budget} onChange={(e) => update(i, { budget: Number(e.target.value) })} />
                  <div className="muted small">{money(t.budget)}</div>
                </td>
                {[0, 1].map((o) => {
                  const owner = t.owners?.[o] ?? { name: '' };
                  return (
                    <td key={o} className="owner-cell">
                      <input placeholder="Owner name" disabled={!setup} value={owner.name} onChange={(e) => updateOwner(i, o, { name: e.target.value })} />
                      <select disabled={!setup} value={owner.playerId ?? ''} onChange={(e) => updateOwner(i, o, { playerId: e.target.value || undefined, isCaptain: e.target.value ? owner.isCaptain : false })}>
                        <option value="">Not a player</option>
                        {usable.map((p) => <option key={p.id} value={p.id}>#{p.slNo} {p.name}</option>)}
                      </select>
                      <label className="check">
                        <input type="checkbox" disabled={!setup || !owner.playerId} checked={!!owner.isCaptain} onChange={(e) => updateOwner(i, o, { isCaptain: e.target.checked })} /> Captain
                      </label>
                    </td>
                  );
                })}
                <td>{setup && <button className="btn btn-sm btn-red" onClick={() => { setDirty(true); setDraft((d) => d.filter((_, j) => j !== i)); }}>Delete</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="muted small">
          An owner linked to a player joins his own team automatically at {snap.config.multipliers.ownerPlayer}x his category's base price when the auction starts.
          An owner ticked as captain becomes that team's captain (and counts as one of the {snap.teams.length} captains).
        </p>
      </div>
      <TeamsPanel snap={snap} />
    </div>
  );
}

// Master-only setup: Google Sheet links, bid ladder, multipliers, categories, captains, start/reset.
import { useEffect, useState } from 'react';
import { fetchConfig } from '../api';
import { categoryName, money } from '../format';
import type { Category, Config } from '../types';
import type { AdminCtx } from './AdminApp';

export function SetupTab({ ctx }: { ctx: AdminCtx }) {
  const { snap, run, busy, toast } = ctx;
  const setup = snap.state.phase === 'SETUP';
  const [cfg, setCfg] = useState<Config | null>(null);
  const [captains, setCaptains] = useState<Set<string>>(new Set());
  const [capFilter, setCapFilter] = useState('');
  const [resetText, setResetText] = useState('');

  useEffect(() => {
    fetchConfig().then(setCfg).catch((e) => toast('err', e.message));
  }, [snap.state.rosterVersion, toast]);
  useEffect(() => {
    setCaptains(new Set(snap.players.filter((p) => p.isCaptain).map((p) => p.id)));
  }, [snap.players]);

  if (!cfg) return <div className="panel muted">Loading settings...</div>;
  const set = <K extends keyof Config>(k: K, v: Config[K]) => setCfg({ ...cfg, [k]: v });
  const setCat = (i: number, patch: Partial<Category>) => set('categories', cfg.categories.map((c, j) => (j === i ? { ...c, ...patch } : c)));

  const saveConfig = () =>
    run('config', {
      config: {
        tournamentName: cfg.tournamentName,
        sheetUrl: cfg.sheetUrl,
        sheetWebhookUrl: cfg.sheetWebhookUrl,
        sheetWebhookSecret: cfg.sheetWebhookSecret,
        ladder: cfg.ladder,
        multipliers: cfg.multipliers,
        ...(setup ? { categories: cfg.categories } : {}),
      },
    }, { okText: 'Settings saved' });

  const importSheet = async () => {
    if (!confirm('Replace the player list with the Google Sheet contents?')) return;
    const r = (await run('import', { sheetUrl: cfg.sheetUrl })) as { info?: { count: number; errors: string[] } } | null;
    if (r?.info) {
      toast('ok', `Imported ${r.info.count} players`);
      r.info.errors.slice(0, 5).forEach((e) => toast('warn', e));
    }
  };

  const capList = snap.players.filter((p) => p.status !== 'UNAVAILABLE' && (!capFilter || p.name.toLowerCase().includes(capFilter.toLowerCase())));
  const ownerCaptains = new Set(snap.teams.flatMap((t) => t.owners.filter((o) => o.isCaptain && o.playerId).map((o) => o.playerId!)));

  return (
    <div className="setup">
      <div className="panel">
        <h3 className="panel-title">1. Player database (Google Sheet)</h3>
        <label className="field">Tournament name<input value={cfg.tournamentName} onChange={(e) => set('tournamentName', e.target.value)} /></label>
        <label className="field">
          Google Sheet link (columns: Sl No · Name · Photo Drive link · Category · Base price · Final team)
          <input value={cfg.sheetUrl} onChange={(e) => set('sheetUrl', e.target.value)} placeholder="https://docs.google.com/spreadsheets/d/.../edit#gid=0" />
        </label>
        <label className="field">
          Apps Script Web App URL (writes the final team back to the sheet, see docs/google-apps-script.gs)
          <input value={cfg.sheetWebhookUrl} onChange={(e) => set('sheetWebhookUrl', e.target.value)} placeholder="https://script.google.com/macros/s/.../exec" />
        </label>
        <label className="field">Apps Script shared secret<input value={cfg.sheetWebhookSecret} onChange={(e) => set('sheetWebhookSecret', e.target.value)} /></label>
        <div className="row">
          <button className="btn btn-gold" onClick={saveConfig} disabled={busy}>Save settings</button>
          <button className="btn" onClick={importSheet} disabled={busy || !setup || !cfg.sheetUrl}>Import players from sheet</button>
          <button className="btn btn-ghost" onClick={() => run('push-sheet', {}, { okText: 'Pushed all results to the sheet', noVersion: true })} disabled={busy || !cfg.sheetWebhookUrl}>Push all results to sheet</button>
        </div>
        <p className="muted small">Share the sheet as "Anyone with the link can view". Save settings before importing.</p>
      </div>

      <div className="panel">
        <h3 className="panel-title">2. Bid ladder & multipliers</h3>
        <div className="form-grid">
          <label>Ladder threshold (L)<input type="number" value={cfg.ladder.threshold} onChange={(e) => set('ladder', { ...cfg.ladder, threshold: Number(e.target.value) })} /></label>
          <label>Step below threshold (L)<input type="number" value={cfg.ladder.stepLow} onChange={(e) => set('ladder', { ...cfg.ladder, stepLow: Number(e.target.value) })} /></label>
          <label>Step from threshold (L)<input type="number" value={cfg.ladder.stepHigh} onChange={(e) => set('ladder', { ...cfg.ladder, stepHigh: Number(e.target.value) })} /></label>
          <label>Wallet reserve (x)<input type="number" step="0.5" value={cfg.multipliers.walletReserve} onChange={(e) => set('multipliers', { ...cfg.multipliers, walletReserve: Number(e.target.value) })} /></label>
          <label>Owner-player (x)<input type="number" step="0.5" value={cfg.multipliers.ownerPlayer} onChange={(e) => set('multipliers', { ...cfg.multipliers, ownerPlayer: Number(e.target.value) })} /></label>
          <label>Last captain (x)<input type="number" step="0.5" value={cfg.multipliers.lastCaptain} onChange={(e) => set('multipliers', { ...cfg.multipliers, lastCaptain: Number(e.target.value) })} /></label>
          <label>Last player in category (x)<input type="number" step="0.5" value={cfg.multipliers.lastInCategory} onChange={(e) => set('multipliers', { ...cfg.multipliers, lastInCategory: Number(e.target.value) })} /></label>
        </div>
        <h4>Categories & base prices {!setup && <span className="muted small">(locked after the start)</span>}</h4>
        <table className="table compact">
          <thead><tr><th>ID</th><th>Name (must match the sheet)</th><th>Base price (L)</th><th></th></tr></thead>
          <tbody>
            {cfg.categories.map((c, i) => (
              <tr key={i}>
                <td><input disabled={!setup} value={c.id} onChange={(e) => setCat(i, { id: e.target.value.toUpperCase() })} /></td>
                <td><input disabled={!setup} value={c.name} onChange={(e) => setCat(i, { name: e.target.value })} /></td>
                <td><input disabled={!setup} type="number" value={c.basePrice} onChange={(e) => setCat(i, { basePrice: Number(e.target.value) })} /> <span className="muted small">{money(c.basePrice)}</span></td>
                <td>{setup && <button className="btn btn-sm btn-red" onClick={() => set('categories', cfg.categories.filter((_, j) => j !== i))}>✕</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {setup && <button className="btn btn-sm" onClick={() => set('categories', [...cfg.categories, { id: `C${cfg.categories.length + 1}`, name: 'New category', basePrice: 20 }])}>+ Category</button>}
        <div className="row"><button className="btn btn-gold" onClick={saveConfig} disabled={busy}>Save settings</button></div>
      </div>

      <div className="panel">
        <h3 className="panel-title">3. Captains <span className="muted small">{captains.size}/{snap.teams.length} selected</span></h3>
        <p className="muted small">Captains are ordinary players from any category. Their base price is their category's base price. Owners ticked as captain (Teams tab) are added automatically at the start.</p>
        <input className="search" placeholder="Filter players" value={capFilter} onChange={(e) => setCapFilter(e.target.value)} disabled={!setup} />
        <div className="captain-grid">
          {capList.map((p) => (
            <label key={p.id} className={`check-card ${captains.has(p.id) ? 'on' : ''}`}>
              <input
                type="checkbox"
                disabled={!setup}
                checked={captains.has(p.id)}
                onChange={(e) => {
                  const next = new Set(captains);
                  if (e.target.checked) next.add(p.id);
                  else next.delete(p.id);
                  setCaptains(next);
                }}
              />
              <span>#{p.slNo} {p.name}</span>
              <small className="muted">{categoryName(snap.config, p.categoryId)}{ownerCaptains.has(p.id) ? ' · owner' : ''}</small>
            </label>
          ))}
        </div>
        <div className="row">
          <button className="btn btn-gold" disabled={!setup || busy} onClick={() => run('captains', { playerIds: [...captains] }, { okText: 'Captains saved' })}>Save captains</button>
        </div>
      </div>

      <div className="panel">
        <h3 className="panel-title">4. Start / reset</h3>
        {setup ? (
          <>
            <p>Starting assigns owner-players to their teams, then the captains round begins. Check teams, owners and captains first.</p>
            <button
              className="btn btn-green btn-lg"
              disabled={busy}
              onClick={() => confirm('Start the auction now?') && run('start', {}, { okText: 'Auction started!' })}
            >
              Start auction
            </button>
          </>
        ) : (
          <p className="muted">Auction is running (phase {snap.state.phase}).</p>
        )}
        <div className="danger-zone">
          <h4>Danger zone</h4>
          <p className="muted small">Reset clears every sale, restores all purses and returns to setup. Settings, teams, owners and the player list are kept. Recorded in the audit log.</p>
          <input placeholder='Type "RESET"' value={resetText} onChange={(e) => setResetText(e.target.value)} />
          <button className="btn btn-red" disabled={resetText !== 'RESET' || busy} onClick={() => run('reset', { confirm: 'RESET' }, { okText: 'Auction reset' }).then(() => setResetText(''))}>Reset auction</button>
        </div>
      </div>
    </div>
  );
}

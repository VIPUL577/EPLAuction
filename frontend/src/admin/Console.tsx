import type { CSSProperties } from 'react';
// Live auction console. Keyboard first:
//   PgUp (or ↑) raise the bid one ladder step · Backspace undo
//   N draw next player · E end bidding (pick the buying team, or unsold) · Esc close
// Bids are not team-specific: the admins only raise the price; the buyer is picked when the bid ends.
import { useEffect, useRef, useState } from 'react';
import { AutoNotice, LotCard, SaleBanner, TeamDot } from '../components/common';
import { basePriceOf, bidBlock, categoryName, liveLot, maxBidFor, money, openSlots } from '../format';
import type { Player } from '../types';
import type { AdminCtx } from './AdminApp';

export function Console({ ctx }: { ctx: AdminCtx }) {
  const { snap, run, busy, user } = ctx;
  const lot = snap.state.lot;
  const live = liveLot(snap);
  const player = live?.player;
  const [custom, setCustom] = useState('');
  const [ending, setEnding] = useState(false);
  const teams = snap.teams;

  // Reset the panel when a new player comes up.
  const lastPlayer = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (lot?.playerId !== lastPlayer.current) {
      lastPlayer.current = lot?.playerId;
      setEnding(false);
      setCustom('');
    }
  }, [lot?.playerId]);

  const upcoming = live?.upcoming ?? 0;

  const bidNext = () => {
    if (!live) return;
    void run('bid', {});
  };
  const bidCustom = () => {
    if (!live || !custom) return;
    void run('bid', { amount: Number(custom) }).then((r) => r && setCustom(''));
  };
  const undo = () => live && live.lot.bids.length > 0 && void run('undo', {}, { okText: 'Last bid undone' });
  const draw = () => !live && void run('draw');

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName)) return;
      if (ending) {
        if (e.key === 'Escape') setEnding(false);
        return;
      }
      if (e.key === 'PageUp' || e.key === 'ArrowUp') {
        e.preventDefault();
        if (!busy) bidNext();
      } else if (e.key === 'Backspace' || (e.key === 'z' && (e.ctrlKey || e.metaKey))) {
        e.preventDefault();
        undo();
      } else if (e.key === 'n' || e.key === 'N') {
        draw();
      } else if ((e.key === 'e' || e.key === 'E') && live) {
        setEnding(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (snap.state.phase === 'SETUP') {
    return (
      <div className="console-setup panel">
        <h2>Auction not started</h2>
        <p className="muted">
          Players: {snap.players.length} · Captains selected: {snap.players.filter((p) => p.isCaptain).length}/{teams.length}
        </p>
        {user.role === 'master' ? (
          <p>Finish the <b>Setup</b> tab (sheet link, captains, owners), then press <b>Start auction</b> there.</p>
        ) : (
          <p>Waiting for the master admin to start the auction.</p>
        )}
        <RefreshButton ctx={ctx} />
      </div>
    );
  }

  return (
    <div className="console">
      <section className="console-left">
        <LotCard snap={snap} />
        <AutoNotice snap={snap} />
        <div className="controls">
          <button className="btn btn-gold" onClick={draw} disabled={busy || !!live || snap.state.phase === 'COMPLETE'}>
            {snap.state.phase === 'CAPTAINS' ? 'Draw next captain' : 'Draw next player'} <kbd>N</kbd>
          </button>
          <button className="btn" onClick={undo} disabled={busy || !live || !live.lot.bids.length}>Undo last bid <kbd>⌫</kbd></button>
          <button className="btn btn-green" onClick={() => setEnding(true)} disabled={busy || !live}>End bid <kbd>E</kbd></button>
          <RefreshButton ctx={ctx} />
        </div>

        {live && (
          <div className="bid-box">
            <div className="bid-next">
              <span className="muted">Current bid</span>
              <strong>{live.current === null ? '-' : money(live.current)}</strong>
              <span className="muted">next {money(upcoming)}</span>
              <button className="btn btn-gold" onClick={bidNext} disabled={busy}>Raise bid <kbd>PgUp</kbd></button>
            </div>
            <div className="bid-custom">
              <input type="number" min={1} placeholder="Custom amount (L)" value={custom} onChange={(e) => setCustom(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && bidCustom()} />
              <button className="btn" onClick={bidCustom} disabled={busy || !custom}>Set bid</button>
            </div>
            <ol className="bid-history">
              {[...live.lot.bids].reverse().map((b, i) => (
                <li key={b.at + i} className={i === 0 ? 'latest' : ''}>
                  <b>{money(b.amount)}</b>
                  <span />
                  <span className="muted small">{b.by} · {new Date(b.at).toLocaleTimeString()}</span>
                </li>
              ))}
            </ol>
          </div>
        )}
      </section>

      <section className="console-right">
        <h3 className="panel-title">Teams <span className="muted small">darkened = can't bid {live ? money(upcoming) : ''}</span></h3>
        <div className="team-grid">
          {teams.map((t) => {
            const block = live ? bidBlock(t, live.player, snap, upcoming) : null;
            const max = player ? maxBidFor(t, snap.config, player.categoryId) : null;
            return (
              <div key={t.id} className={`team-card ${block ? 'blocked' : ''}`} style={{ '--team': t.color } as CSSProperties}>
                <div className="tc-head"><span>{t.name}</span></div>
                <div className="tc-purse">{money(t.purse)}</div>
                <div className="tc-sub">
                  <span>{snap.config.categories.length - openSlots(t, snap.config)}/{snap.config.categories.length}</span>
                  {live && <span>max {money(Math.max(0, max ?? 0))}</span>}
                </div>
                {block && <div className="tc-flag">{block}</div>}
              </div>
            );
          })}
        </div>
        <div className="ladder-hint muted small">
          Ladder: +{snap.config.ladder.stepLow} L below {money(snap.config.ladder.threshold)}, then +{snap.config.ladder.stepHigh} L ·
          Wallet reserve {snap.config.multipliers.walletReserve}x base of open slots
        </div>
      </section>

      {ending && live && <EndBidModal ctx={ctx} player={live.player} onClose={() => setEnding(false)} />}
      <SaleBanner snap={snap} durationMs={4000} />
    </div>
  );
}

function RefreshButton({ ctx }: { ctx: AdminCtx }) {
  return (
    <button
      className="btn btn-ghost"
      disabled={ctx.busy}
      title="Reload the screen and pull names/photos from the Google Sheet"
      onClick={async () => {
        await ctx.refresh();
        const r = (await ctx.run('sync', {}, { noVersion: true })) as { info?: { updated: number; added: number; errors: string[] } } | null;
        if (r?.info) ctx.toast('ok', `Synced from sheet: ${r.info.updated} updated, ${r.info.added} added${r.info.errors.length ? `, ${r.info.errors.length} rows skipped` : ''}`);
      }}
    >
      Refresh from sheet
    </button>
  );
}

function EndBidModal({ ctx, player, onClose }: { ctx: AdminCtx; player: Player; onClose: () => void }) {
  const { snap, run, busy, user } = ctx;
  const lot = snap.state.lot!;
  const top = lot.bids[lot.bids.length - 1];
  const [teamId, setTeamId] = useState<string>('');
  const [price, setPrice] = useState('');
  const amount = price ? Number(price) : top ? top.amount : basePriceOf(player, snap.config);
  const override = !!price && user.role === 'master';
  const chosen = snap.teams.find((t) => t.id === teamId);
  const chosenBlock = chosen ? bidBlock(chosen, player, snap, override ? 0 : amount) : 'Tick a team';
  const sell = async () => {
    if (!teamId || chosenBlock) return;
    const payload: Record<string, unknown> = { teamId };
    if (price && user.role === 'master') payload.price = Number(price);
    const r = await run('sell', payload, { okText: `${player.name} SOLD to ${snap.teams.find((t) => t.id === teamId)?.name} for ${money(amount)}` });
    if (r) onClose();
  };
  const unsold = async () => {
    const r = await run('unsold', {}, { okText: `${player.name} marked UNSOLD` });
    if (r) onClose();
  };
  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.key === 'Enter' && void sell()}>
        <h2>End bidding · {player.name}</h2>
        <p className="muted">{categoryName(snap.config, player.categoryId)} · {top ? `Final bid ${money(top.amount)}` : `No bids, base ${money(basePriceOf(player, snap.config))}`} · tick the team that won</p>
        <div className="radio-list">
          {snap.teams.map((t) => {
            // A master price override skips the wallet rule (server does the same), so only slot rules apply then.
            const block = bidBlock(t, player, snap, override ? 0 : amount);
            return (
              <label key={t.id} className={`radio ${block ? 'disabled' : ''}`}>
                <input type="radio" name="soldTo" checked={teamId === t.id} disabled={!!block} onChange={() => setTeamId(t.id)} />
                <TeamDot team={t} />
                <span className="muted small">{block ?? money(t.purse)}</span>
              </label>
            );
          })}
        </div>
        {user.role === 'master' && (
          <div className="override">
            <label className="muted small">Master override price (optional, lakhs)</label>
            <input type="number" min={0} value={price} onChange={(e) => setPrice(e.target.value)} placeholder={String(amount)} />
          </div>
        )}
        <div className="modal-actions">
          <button className="btn btn-green" onClick={sell} disabled={busy || !!chosenBlock}>SOLD for {money(amount)}</button>
          <button className="btn btn-red" onClick={unsold} disabled={busy}>UNSOLD</button>
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

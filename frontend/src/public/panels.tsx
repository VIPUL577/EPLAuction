import { useMemo, useState, type CSSProperties } from 'react';
import { Photo, TeamDot } from '../components/common';
import { SALE_LABEL, basePriceOf, categoryName, maxBidFor, money, openSlots, reserveRequired } from '../format';
import type { Player, Snapshot, Team } from '../types';

export function StatsBar({ snap }: { snap: Snapshot }) {
  const active = snap.players.filter((p) => p.status !== 'UNAVAILABLE');
  const sold = active.filter((p) => p.status === 'SOLD');
  const spent = sold.reduce((s, p) => s + (p.price ?? 0), 0);
  return (
    <div className="stats-bar">
      <div><strong>{sold.length}</strong><span>Sold</span></div>
      <div><strong>{active.length - sold.length}</strong><span>Left</span></div>
      <div><strong>{money(spent)}</strong><span>Spent</span></div>
    </div>
  );
}

/** Tap any team to see its squad, purse and open slots. */
export function TeamsPanel({ snap }: { snap: Snapshot }) {
  const [open, setOpen] = useState<string | null>(null);
  const players = useMemo(() => new Map(snap.players.map((p) => [p.id, p])), [snap.players]);
  return (
    <div className="panel">
      <h3 className="panel-title">Squads <span className="muted small">Tap a team to see its squad</span></h3>
      <div className="team-list">
        {snap.teams.map((t) => {
          const isOpen = open === t.id;
          const slots = openSlots(t, snap.config);
          const spent = t.budget - t.purse;
          return (
            <div key={t.id} className={`team-row ${isOpen ? 'open' : ''}`} style={{ '--team': t.color } as CSSProperties}>
              <button className="team-head" onClick={() => setOpen(isOpen ? null : t.id)} aria-expanded={isOpen}>
                <span className="team-name"><i style={{ background: t.color }} />{t.name}</span>
                <span className="team-figs">
                  <b>{money(t.purse)}</b>
                  <small>{snap.config.categories.length - slots}/{snap.config.categories.length}</small>
                </span>
              </button>
              <div className="purse-bar"><span style={{ width: `${Math.max(0, (t.purse / t.budget) * 100)}%` }} /></div>
              {isOpen && <Squad team={t} snap={snap} players={players} spent={spent} />}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Squad({ team, snap, players, spent }: { team: Team; snap: Snapshot; players: Map<string, Player>; spent: number }) {
  const owners = team.owners.filter((o) => o.name);
  return (
    <div className="squad">
      <div className="squad-figs">
        <div><label>Purse left</label><b>{money(team.purse)}</b></div>
        <div><label>Spent</label><b>{money(spent)}</b></div>
        <div><label>Open slots</label><b>{openSlots(team, snap.config)}</b></div>
        <div><label>Reserve held</label><b>{money(reserveRequired(team, snap.config))}</b></div>
      </div>
      {owners.length > 0 && <div className="owners muted small">Owners: {owners.map((o) => o.name).join(' & ')}</div>}
      <ul className="squad-list">
        {snap.config.categories.map((c) => {
          const p = team.filled[c.id] ? players.get(team.filled[c.id]) : undefined;
          return (
            <li key={c.id} className={p ? '' : 'slot-open'}>
              <span className="slot-cat">{c.name}</span>
              {p ? (
                <span className="slot-player">
                  {p.name}
                  {team.captainId === p.id && <em className="c-badge">C</em>}
                  <b>{money(p.price)}</b>
                </span>
              ) : (
                <span className="slot-player muted">Open · max bid {money(Math.max(0, maxBidFor(team, snap.config, c.id)))}</span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function SoldPanel({ snap }: { snap: Snapshot }) {
  const teams = new Map(snap.teams.map((t) => [t.id, t]));
  // Chronological: first sale at the top (owner-players assigned at the start come first).
  const sold = snap.players
    .filter((p) => p.status === 'SOLD')
    .sort((a, b) => (a.soldAt ?? '').localeCompare(b.soldAt ?? '') || a.slNo - b.slNo);
  return (
    <div className="panel">
      <h3 className="panel-title">Players sold <span className="muted small">{sold.length} · in order of sale</span></h3>
      {sold.length === 0 && <p className="muted">Nobody sold yet.</p>}
      <ul className="plist">
        {sold.map((p, i) => (
          <li key={p.id}>
            <span className="plist-idx muted small">{i + 1}</span>
            <Photo player={p} size="sm" />
            <div className="plist-main">
              <b>{p.name}{p.isCaptain && <em className="c-badge">C</em>}</b>
              <span className="muted small">{categoryName(snap.config, p.categoryId)} · base {money(basePriceOf(p, snap.config))}{p.saleMode && p.saleMode !== 'AUCTION' ? ` · ${SALE_LABEL[p.saleMode]}` : ''}</span>
            </div>
            <div className="plist-right">
              <b className="gold">{money(p.price)}</b>
              <TeamDot team={teams.get(p.teamId!)} />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function LeftPanel({ snap }: { snap: Snapshot }) {
  const [q, setQ] = useState('');
  const left = snap.players.filter((p) => p.status === 'AVAILABLE' || p.status === 'UNSOLD');
  const query = q.trim().toLowerCase();
  return (
    <div className="panel">
      <h3 className="panel-title">Players left <span className="muted small">{left.length}</span></h3>
      <input className="search" placeholder="Search players" value={q} onChange={(e) => setQ(e.target.value)} />
      {snap.config.categories.map((c) => {
        const list = left.filter((p) => p.categoryId === c.id && (!query || p.name.toLowerCase().includes(query)));
        if (!list.length) return null;
        return (
          <div key={c.id} className="cat-group">
            <h4>{c.name} <span className="muted small">{list.length} left · base {money(c.basePrice)}</span></h4>
            <ul className="plist compact">
              {list.map((p) => (
                <li key={p.id}>
                  <Photo player={p} size="sm" />
                  <div className="plist-main">
                    <b>{p.name}{p.isCaptain && <em className="c-badge">C</em>}</b>
                    <span className="muted small">#{p.slNo}{p.status === 'UNSOLD' ? ' · went unsold' : ''}</span>
                  </div>
                  <div className="plist-right"><b>{money(basePriceOf(p, snap.config))}</b></div>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

/** Most expensive buy in each category (non-captains) plus a final row for captains. Owner-players excluded. */
export function TopPanel({ snap }: { snap: Snapshot }) {
  const teams = new Map(snap.teams.map((t) => [t.id, t]));
  const sold = snap.players.filter((p) => p.status === 'SOLD' && p.saleMode !== 'OWNER');
  const best = (list: Player[]) => list.reduce<Player | undefined>((m, p) => (!m || (p.price ?? 0) > (m.price ?? 0) ? p : m), undefined);
  const rows = [
    ...snap.config.categories.map((c) => ({ key: c.id, label: c.name, p: best(sold.filter((p) => p.categoryId === c.id && !p.isCaptain)) })),
    { key: 'CAPT', label: 'Captain', p: best(sold.filter((p) => p.isCaptain)) },
  ];
  return (
    <div className="panel">
      <h3 className="panel-title">Most expensive buys</h3>
      <table className="top-table">
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} className={r.key === 'CAPT' ? 'captain-row' : ''}>
              <td className="muted small">{r.label}</td>
              <td>{r.p ? <b>{r.p.name}</b> : <span className="muted">-</span>}</td>
              <td>{r.p && <TeamDot team={teams.get(r.p.teamId!)} label={false} />}</td>
              <td className="num gold">{r.p ? money(r.p.price) : ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="muted small">Owner-players (pre-assigned) are not counted.</p>
    </div>
  );
}

export function RulesPanel({ snap }: { snap: Snapshot }) {
  const { ladder, multipliers: m, categories } = snap.config;
  const budget = snap.teams[0]?.budget ?? 0;
  return (
    <div className="panel rules">
      <h3 className="panel-title">Auction rules</h3>
      <ol>
        <li><b>{snap.teams.length} teams</b>, {categories.length} categories. Each team has a <b>{money(budget)}</b> budget and must end with exactly {categories.length} players, one from each category.</li>
        <li>Each team has 2 owners. An owner who is also a player joins his own team automatically at <b>{m.ownerPlayer}x</b> his category's base price.</li>
        <li><b>Captains first.</b> Captains are auctioned in random order at their category's base price. No other player comes up until every team has a captain. The last captain goes automatically to the last team without one at <b>{m.lastCaptain}x</b> base. A captain fills both the captain slot and his category slot.</li>
        <li>After the captains, players come up in random order. Each team buys one player from every category it doesn't hold yet.</li>
        <li><b>Bid ladder:</b> +{money(ladder.stepLow)} while the bid is below {money(ladder.threshold)}, then +{money(ladder.stepHigh)} (e.g. {money(ladder.threshold - ladder.stepLow)}, {money(ladder.threshold)}, {money(ladder.threshold + ladder.stepHigh)}).</li>
        <li><b>Minimum wallet:</b> after every purchase a team must still hold at least <b>{m.walletReserve}x</b> the base price of every category it hasn't filled. Bids that break this are rejected.</li>
        <li><b>Category penalty:</b> the last player of each category goes automatically to the last team that still needs that category, at <b>{m.lastInCategory}x</b> base.</li>
        <li><b>Bidding conduct:</b> only 2 teams bid against each other at a time. A 3rd team can join only after one withdraws. The auctioneer enforces this in the room.</li>
        <li>The auctioneer's decision is final on bids. The Auction Committee's decision is final on rules.</li>
        <li>Impact Players A, B and C are a match rule only.</li>
      </ol>
      <h4>Base prices</h4>
      <div className="base-grid">
        {categories.map((c) => (
          <div key={c.id}><span>{c.name}</span><b>{money(c.basePrice)}</b></div>
        ))}
      </div>
    </div>
  );
}

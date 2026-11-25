import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { bidBlock, categoryName, initials, liveLot, money, basePriceOf, openSlots } from '../format';
import type { ConnStatus } from '../live';
import type { Player, Snapshot, Team } from '../types';

export function Photo({ player, size = 'md' }: { player: Player; size?: 'sm' | 'md' | 'lg' | 'xl' }) {
  const [failed, setFailed] = useState(false);
  const [fallback, setFallback] = useState(false);
  // lh3 link first; if Google refuses, try the Drive thumbnail endpoint once.
  const src = fallback ? player.photo.replace(/^https:\/\/lh3\.googleusercontent\.com\/d\/([^=]+)=w\d+$/, 'https://drive.google.com/thumbnail?id=$1&sz=w600') : player.photo;
  if (!player.photo || failed) {
    return <div className={`photo photo-${size} photo-empty`}>{initials(player.name)}</div>;
  }
  return (
    <img
      className={`photo photo-${size}`}
      src={src}
      alt={player.name}
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => (!fallback && /lh3\.googleusercontent/.test(player.photo) ? setFallback(true) : setFailed(true))}
    />
  );
}

export function TeamDot({ team, label = true }: { team?: Team; label?: boolean }) {
  if (!team) return <span className="muted">-</span>;
  return (
    <span className="team-dot">
      <i style={{ background: team.color }} />
      {label && team.name}
    </span>
  );
}

export function ConnBadge({ status }: { status: ConnStatus }) {
  const text = status === 'live' ? 'Live' : status === 'connecting' ? 'Connecting' : 'Offline';
  return <span className={`conn conn-${status}`}><i />{text}</span>;
}

export function Logo({ size = 44 }: { size?: number }) {
  return <img src="/logo.webp" alt="EPL 2026" width={size} height={size} className="logo" />;
}

export type LotStatus = 'UPCOMING' | 'LIVE' | 'SOLD' | 'UNSOLD';

export function lotStatus(snap: Snapshot): LotStatus {
  return snap.state.lot ? snap.state.lot.status : 'UPCOMING';
}

export function StatusPill({ status }: { status: LotStatus }) {
  return <span className={`pill pill-${status.toLowerCase()}`}>{status}</span>;
}

/** The current player: photo, name, role, base price, current bid, how many teams can still bid, status. */
export function LotCard({ snap, big = false }: { snap: Snapshot; big?: boolean }) {
  const lot = snap.state.lot;
  const player = lot ? snap.players.find((p) => p.id === lot.playerId) : undefined;
  const teams = new Map(snap.teams.map((t) => [t.id, t]));
  const status = lotStatus(snap);
  if (!lot || !player) {
    return (
      <div className={`lot-card lot-empty ${big ? 'lot-big' : ''}`}>
        <Logo size={big ? 220 : 120} />
        <h2>{phaseHeadline(snap)}</h2>
        <p className="muted">Waiting for the next player...</p>
      </div>
    );
  }
  const top = lot.bids[lot.bids.length - 1];
  const soldTeam = lot.teamId ? teams.get(lot.teamId) : undefined;
  const accent = (status === 'SOLD' ? soldTeam?.color : undefined) ?? 'var(--gold)';
  const live = liveLot(snap);
  const stillIn = live ? snap.teams.filter((t) => !bidBlock(t, player, snap, live.upcoming)).length : 0;
  return (
    <div className={`lot-card ${big ? 'lot-big' : ''} lot-${status.toLowerCase()}`} style={{ '--accent': accent } as CSSProperties}>
      <div className="lot-photo">
        <Photo player={player} size={big ? 'xl' : 'lg'} />
        {player.isCaptain && <span className="captain-tag">CAPTAIN</span>}
      </div>
      <div className="lot-info">
        <div className="lot-top">
          <span className="sl">#{player.slNo}</span>
          <StatusPill status={status} />
        </div>
        <h2 className="lot-name">{player.name}</h2>
        <div className="lot-role">{categoryName(snap.config, player.categoryId)}</div>
        <div className="lot-meta">
          {player.age ? <span>Age {player.age}</span> : null}
          {player.battingStyle ? <span>{player.battingStyle}</span> : null}
          {player.bowlingStyle ? <span>{player.bowlingStyle}</span> : null}
        </div>
        <div className="lot-prices">
          <div>
            <label>Base price</label>
            <strong>{money(basePriceOf(player, snap.config))}</strong>
          </div>
          <div className="lot-bid">
            <label>{status === 'SOLD' ? 'Sold for' : 'Current bid'}</label>
            <strong>{status === 'SOLD' ? money(lot.price) : top ? money(top.amount) : '-'}</strong>
          </div>
        </div>
        <div className="lot-leader">
          {status === 'SOLD' ? (
            <>
              <label>Sold to</label>
              <TeamDot team={soldTeam} />
            </>
          ) : status === 'UNSOLD' ? (
            <span className="unsold-text">Unsold, may come back later</span>
          ) : (
            <>
              <label>Next bid</label>
              <b>{live ? money(live.upcoming) : '-'}</b>
              <span className="muted small">{stillIn} of {snap.teams.length} teams can bid</span>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export function phaseHeadline(snap: Snapshot) {
  switch (snap.state.phase) {
    case 'SETUP':
      return 'Auction starting soon';
    case 'CAPTAINS':
      return 'Captains round';
    case 'PLAYERS':
      return 'Players round';
    case 'COMPLETE':
      return 'Auction complete';
  }
}

export function AutoNotice({ snap }: { snap: Snapshot }) {
  if (!snap.state.lastAuto.length) return null;
  const players = new Map(snap.players.map((p) => [p.id, p]));
  const teams = new Map(snap.teams.map((t) => [t.id, t]));
  return (
    <div className="auto-notice">
      {snap.state.lastAuto.map((a) => (
        <div key={a.playerId}>
          <b>Auto-assigned:</b> {players.get(a.playerId)?.name} → <TeamDot team={teams.get(a.teamId)} /> at {money(a.price)}{' '}
          <span className="muted">({a.mode === 'LAST_CAPTAIN' ? 'last captain' : 'last in category'})</span>
        </div>
      ))}
    </div>
  );
}

/**
 * Team purses for viewers. While a player is live, teams that cannot bid the next amount
 * (category already filled, already has a captain, or wallet rule) are darkened, like on the admin console.
 */
export function PurseGrid({ snap, compact = false }: { snap: Snapshot; compact?: boolean }) {
  const live = liveLot(snap);
  const captains = new Map(snap.players.filter((p) => p.isCaptain).map((p) => [p.id, p]));
  const total = snap.config.categories.length;
  return (
    <div className={`purse-grid ${compact ? 'purse-compact' : ''}`}>
      {snap.teams.map((t) => {
        const block = live ? bidBlock(t, live.player, snap, live.upcoming) : null;
        return (
          <div key={t.id} className={`purse-tile ${block ? 'blocked' : ''}`} style={{ '--team': t.color } as CSSProperties}>
            <div className="purse-name">{t.name}</div>
            <div className="purse-amt">{money(t.purse)}</div>
            <div className="purse-sub">
              <span>{total - openSlots(t, snap.config)}/{total}{compact ? '' : ' players'}</span>
              {block ? <span className="purse-flag">{block}</span> : !compact && <span>{t.captainId ? `C: ${captains.get(t.captainId)?.name ?? ''}` : 'No captain'}</span>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/**
 * Full-screen "SOLD to X for Y" / "UNSOLD" announcement. Appears when a lot closes (not on page load),
 * disappears after a few seconds, on click / Esc, or as soon as the next player is drawn.
 */
export function SaleBanner({ snap, durationMs = 7000 }: { snap: Snapshot; durationMs?: number }) {
  const lot = snap.state.lot;
  const key = lot && lot.status !== 'LIVE' ? `${lot.playerId}|${lot.closedAt ?? ''}` : null;
  const seen = useRef<string | null | undefined>(undefined);
  const [shown, setShown] = useState<string | null>(null);

  useEffect(() => {
    if (seen.current !== undefined && key && key !== seen.current) setShown(key);
    seen.current = key;
  }, [key]);

  useEffect(() => {
    if (!shown) return;
    const timer = window.setTimeout(() => setShown(null), durationMs);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setShown(null);
    window.addEventListener('keydown', onKey);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('keydown', onKey);
    };
  }, [shown, durationMs]);

  if (!lot || !shown || shown !== key) return null;
  const player = snap.players.find((p) => p.id === lot.playerId);
  const team = lot.teamId ? snap.teams.find((t) => t.id === lot.teamId) : undefined;
  const players = new Map(snap.players.map((p) => [p.id, p]));
  const teams = new Map(snap.teams.map((t) => [t.id, t]));
  const sold = lot.status === 'SOLD';
  return (
    <div className="sale-back" onClick={() => setShown(null)} role="alert">
      <div className={`sale-card ${sold ? 'is-sold' : 'is-unsold'}`} style={{ '--team': team?.color ?? 'var(--red)' } as CSSProperties}>
        {player && <Photo player={player} size="lg" />}
        <div className="sale-stamp">{sold ? 'SOLD!' : 'UNSOLD'}</div>
        <div className="sale-name">{player?.name ?? ''}</div>
        {sold ? (
          <div className="sale-line">
            to <span className="sale-team">{team?.name ?? ''}</span> for <span className="sale-price">{money(lot.price)}</span>
          </div>
        ) : (
          <div className="sale-line muted">Goes back to the pool and may come up again</div>
        )}
        {snap.state.lastAuto.map((a) => (
          <div key={a.playerId} className="sale-auto">
            Auto-assigned: <b>{players.get(a.playerId)?.name}</b> → <TeamDot team={teams.get(a.teamId)} /> at {money(a.price)}
          </div>
        ))}
        <div className="muted small">Tap to close</div>
      </div>
    </div>
  );
}

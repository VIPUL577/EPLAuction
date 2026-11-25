// Public, read-only viewer. Phones get a tabbed app with all the stats; desktops / the big
// screen get a large live card with the team purses below.
import { useState } from 'react';
import { AutoNotice, ConnBadge, LotCard, Logo, PurseGrid, SaleBanner, TeamDot } from '../components/common';
import { money } from '../format';
import { useIsMobile, useLive } from '../live';
import type { Snapshot } from '../types';
import { LeftPanel, RulesPanel, SoldPanel, StatsBar, TeamsPanel, TopPanel } from './panels';

const TABS = ['Live', 'Teams', 'Sold', 'Left', 'Top', 'Rules'] as const;
type Tab = (typeof TABS)[number];

export function PublicApp() {
  const { snap, status, error } = useLive();
  const mobile = useIsMobile();
  const [tab, setTab] = useState<Tab>('Live');

  if (!snap) {
    return (
      <div className="splash">
        <Logo size={160} />
        <p className="muted">{error ?? 'Loading auction...'}</p>
      </div>
    );
  }

  const panel = (t: Tab) => {
    switch (t) {
      case 'Live':
        return mobile ? <MobileLive snap={snap} /> : <BigScreen snap={snap} />;
      case 'Teams':
        return <TeamsPanel snap={snap} />;
      case 'Sold':
        return <SoldPanel snap={snap} />;
      case 'Left':
        return <LeftPanel snap={snap} />;
      case 'Top':
        return <TopPanel snap={snap} />;
      case 'Rules':
        return <RulesPanel snap={snap} />;
    }
  };

  return (
    <div className={`public ${mobile ? 'is-mobile' : 'is-desktop'}`}>
      <header className="topbar">
        <div className="brand">
          <Logo size={mobile ? 36 : 48} />
          <div>
            <h1>{snap.config.tournamentName}</h1>
            <span className="muted small">14th Edition · Player Auction</span>
          </div>
        </div>
        {!mobile && (
          <nav className="tabs">
            {TABS.map((t) => (
              <button key={t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>{t}</button>
            ))}
          </nav>
        )}
        <ConnBadge status={status} />
      </header>
      <main className="public-main">{panel(tab)}</main>
      <SaleBanner snap={snap} />
      {mobile && (
        <nav className="bottom-nav">
          {TABS.map((t) => (
            <button key={t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>{t}</button>
          ))}
        </nav>
      )}
    </div>
  );
}

function MobileLive({ snap }: { snap: Snapshot }) {
  const sold = snap.players.filter((p) => p.status === 'SOLD').sort((a, b) => (b.soldAt ?? '').localeCompare(a.soldAt ?? '')).slice(0, 5);
  const teams = new Map(snap.teams.map((t) => [t.id, t]));
  return (
    <div className="mobile-live">
      <LotCard snap={snap} />
      <AutoNotice snap={snap} />
      <PurseGrid snap={snap} compact />
      <StatsBar snap={snap} />
      {sold.length > 0 && (
        <div className="panel">
          <h3 className="panel-title">Recently sold</h3>
          <ul className="recent">
            {sold.map((p) => (
              <li key={p.id}>
                <span>{p.name}</span>
                <TeamDot team={teams.get(p.teamId!)} />
                <b className="gold">{money(p.price)}</b>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export function BigScreen({ snap }: { snap: Snapshot }) {
  return (
    <div className="bigscreen">
      <LotCard snap={snap} big />
      <AutoNotice snap={snap} />
      <PurseGrid snap={snap} />
    </div>
  );
}

import { useCallback, useRef, useState, type FormEvent } from 'react';
import { ApiError, command } from '../api';
import { currentUser, login, logout } from '../auth';
import { ConnBadge, Logo } from '../components/common';
import { useIsMobile, useLive } from '../live';
import type { Snapshot, User } from '../types';
import { AuditTab } from './AuditTab';
import { Console } from './Console';
import { PlayersTab } from './PlayersTab';
import { SetupTab } from './SetupTab';
import { TeamsTab } from './TeamsTab';

export interface Toast {
  id: number;
  kind: 'ok' | 'err' | 'warn';
  text: string;
}

export interface AdminCtx {
  snap: Snapshot;
  user: User;
  busy: boolean;
  /** Runs an admin command based on the current state version. Returns the result or null on error. */
  run: (name: string, payload?: Record<string, unknown>, opts?: { okText?: string; noVersion?: boolean }) => Promise<unknown | null>;
  toast: (kind: Toast['kind'], text: string) => void;
  refresh: () => Promise<void>;
}

export function AdminApp() {
  const [user, setUser] = useState<User | null>(currentUser());
  const mobile = useIsMobile('(max-width: 900px)');
  if (mobile) {
    return (
      <div className="splash">
        <Logo size={120} />
        <h2>The admin dashboard is desktop only</h2>
        <p className="muted">Please open it on a laptop or desktop. <a href="/">Go to the live auction</a></p>
      </div>
    );
  }
  if (!user) return <Login onLogin={setUser} />;
  return <Dashboard user={user} onLogout={() => { logout(); setUser(null); }} />;
}

function Login({ onLogin }: { onLogin: (u: User) => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      onLogin(await login(username.trim(), password));
    } catch (ex) {
      setErr((ex as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="login-wrap">
      <form className="login-card" onSubmit={submit}>
        <Logo size={120} />
        <h2>Admin login</h2>
        <input placeholder="Username" autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} required />
        <input placeholder="Password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        {err && <div className="form-error">{err}</div>}
        <button className="btn btn-gold" disabled={busy}>{busy ? 'Signing in...' : 'Sign in'}</button>
        <a href="/" className="muted small">← Public view</a>
      </form>
    </div>
  );
}

const TABS = ['Auction', 'Players', 'Teams', 'Setup', 'Audit'] as const;
type Tab = (typeof TABS)[number];

function Dashboard({ user, onLogout }: { user: User; onLogout: () => void }) {
  const { snap, status, error, refresh, applyState } = useLive();
  const [tab, setTab] = useState<Tab>('Auction');
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const snapRef = useRef(snap);
  snapRef.current = snap;

  const toast = useCallback((kind: Toast['kind'], text: string) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t.slice(-3), { id, kind, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'ok' ? 2500 : 6000);
  }, []);

  const run = useCallback<AdminCtx['run']>(
    async (name, payload = {}, opts = {}) => {
      // One command at a time per admin: rapid key presses are serialized, never double-applied.
      if (busyRef.current || !snapRef.current) return null;
      busyRef.current = true;
      setBusy(true);
      try {
        const res = await command(name, payload, opts.noVersion ? undefined : snapRef.current.state.version);
        applyState(res.state);
        if (opts.okText) toast('ok', opts.okText);
        res.warnings?.forEach((w) => toast('warn', w));
        return res;
      } catch (e) {
        const err = e as ApiError;
        if (err.state) applyState(err.state);
        if (err.status === 401) {
          toast('err', err.message);
          onLogout();
        } else toast('err', err.message);
        return null;
      } finally {
        busyRef.current = false;
        setBusy(false);
      }
    },
    [applyState, toast, onLogout],
  );

  if (!snap) return <div className="splash"><Logo size={120} /><p className="muted">{error ?? 'Loading...'}</p></div>;
  const ctx: AdminCtx = { snap, user, busy, run, toast, refresh: () => refresh() };

  return (
    <div className="admin">
      <header className="topbar">
        <div className="brand">
          <Logo size={40} />
          <div>
            <h1>{snap.config.tournamentName}</h1>
            <span className="muted small">Admin · phase {snap.state.phase} · v{snap.state.version}</span>
          </div>
        </div>
        <nav className="tabs">
          {TABS.filter((t) => t !== 'Setup' || user.role === 'master').map((t) => (
            <button key={t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>{t}</button>
          ))}
        </nav>
        <div className="userbox">
          <ConnBadge status={status} />
          <span className={`role role-${user.role}`}>{user.username} · {user.role === 'master' ? 'Master admin' : 'Admin'}</span>
          <button className="btn btn-ghost btn-sm" onClick={onLogout}>Log out</button>
        </div>
      </header>
      <main className="admin-main">
        {tab === 'Auction' && <Console ctx={ctx} />}
        {tab === 'Players' && <PlayersTab ctx={ctx} />}
        {tab === 'Teams' && <TeamsTab ctx={ctx} />}
        {tab === 'Setup' && user.role === 'master' && <SetupTab ctx={ctx} />}
        {tab === 'Audit' && <AuditTab ctx={ctx} />}
      </main>
      <div className="toasts">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.kind}`}>{t.text}</div>
        ))}
      </div>
    </div>
  );
}

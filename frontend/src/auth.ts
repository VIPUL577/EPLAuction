// Admin login. On AWS: Cognito USER_PASSWORD_AUTH via plain fetch (no Amplify dependency).
// Locally: the dev server's /api/dev/login. The role comes from the Cognito group (master/admin).
import { appConfig } from './config';
import type { Role, User } from './types';

interface Session {
  idToken: string;
  refreshToken?: string;
  expiresAt: number;
  user: User;
}

const KEY = 'epl-admin-session';
let session: Session | null = null;
try {
  session = JSON.parse(localStorage.getItem(KEY) || 'null');
} catch {
  session = null;
}

function save(s: Session | null) {
  session = s;
  try {
    if (s) localStorage.setItem(KEY, JSON.stringify(s));
    else localStorage.removeItem(KEY);
  } catch {
    /* private mode: keep in memory only */
  }
}

function decodeJwt(token: string): Record<string, unknown> {
  const part = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(part.padEnd(part.length + ((4 - (part.length % 4)) % 4), '='));
  return JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0))));
}

function userFromIdToken(idToken: string): User {
  const c = decodeJwt(idToken);
  const groups = (c['cognito:groups'] as string[] | undefined) ?? [];
  const role: Role | null = groups.includes('master') ? 'master' : groups.includes('admin') ? 'admin' : null;
  if (!role) throw new Error('This account is not in the "master" or "admin" group');
  return { username: String(c['cognito:username'] ?? c.email ?? 'admin'), role };
}

async function cognito(target: string, body: unknown) {
  const { cognito } = appConfig();
  const res = await fetch(`https://cognito-idp.${cognito!.region}.amazonaws.com/`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-amz-json-1.1', 'x-amz-target': `AWSCognitoIdentityProviderService.${target}` },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || 'Login failed');
  return data;
}

export async function login(username: string, password: string): Promise<User> {
  const cfg = appConfig();
  if (!cfg.cognito) {
    const res = await fetch(`${cfg.apiBase}/dev/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Login failed');
    save({ idToken: data.token, expiresAt: Date.now() + 12 * 3600_000, user: { username: data.username, role: data.role } });
    return session!.user;
  }
  const data = await cognito('InitiateAuth', {
    AuthFlow: 'USER_PASSWORD_AUTH',
    ClientId: cfg.cognito.clientId,
    AuthParameters: { USERNAME: username, PASSWORD: password },
  });
  if (data.ChallengeName) {
    throw new Error(`Cognito requires "${data.ChallengeName}". Set a permanent password with scripts/create-admin.sh.`);
  }
  const r = data.AuthenticationResult;
  const user = userFromIdToken(r.IdToken);
  save({ idToken: r.IdToken, refreshToken: r.RefreshToken, expiresAt: Date.now() + r.ExpiresIn * 1000, user });
  return user;
}

export function currentUser(): User | null {
  return session?.user ?? null;
}

export function logout() {
  save(null);
}

/** Returns a valid ID token, refreshing it with the refresh token if it is about to expire. */
export async function getToken(): Promise<string | null> {
  if (!session) return null;
  if (Date.now() < session.expiresAt - 60_000) return session.idToken;
  const cfg = appConfig();
  if (!cfg.cognito || !session.refreshToken) {
    save(null);
    return null;
  }
  try {
    const data = await cognito('InitiateAuth', {
      AuthFlow: 'REFRESH_TOKEN_AUTH',
      ClientId: cfg.cognito.clientId,
      AuthParameters: { REFRESH_TOKEN: session.refreshToken },
    });
    const r = data.AuthenticationResult;
    save({ ...session, idToken: r.IdToken, expiresAt: Date.now() + r.ExpiresIn * 1000, user: userFromIdToken(r.IdToken) });
    return session!.idToken;
  } catch {
    save(null);
    return null;
  }
}

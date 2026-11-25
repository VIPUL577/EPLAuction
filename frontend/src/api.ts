import { getToken } from './auth';
import { appConfig } from './config';
import type { AuctionState, AuditEntry, Config, Snapshot, User } from './types';

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public state?: AuctionState,
  ) {
    super(message);
  }
}

async function request<T>(method: string, path: string, body?: unknown, auth = false): Promise<T> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (auth) {
    const token = await getToken();
    if (!token) throw new ApiError(401, 'Session expired, please log in again');
    headers.authorization = `Bearer ${token}`;
  }
  let res: Response;
  try {
    res = await fetch(`${appConfig().apiBase}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    throw new ApiError(0, 'Network error, check your connection');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.error || `Request failed (${res.status})`, data.state);
  return data as T;
}

export const fetchSnapshot = (rv?: number) => request<Snapshot>('GET', `/public/snapshot${rv ? `?rv=${rv}` : ''}`);

export interface CommandResult {
  ok: true;
  state: AuctionState;
  duplicate?: boolean;
  warnings?: string[];
  info?: unknown;
}

/** Sends an admin command with an idempotency key and the state version it was based on. */
export function command(name: string, payload: Record<string, unknown> = {}, version?: number) {
  const requestId = crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
  return request<CommandResult>('POST', `/admin/${name}`, { ...payload, version, requestId }, true);
}

export const fetchMe = () => request<User>('GET', '/admin/me', undefined, true);
export const fetchConfig = () => request<Config>('GET', '/admin/config', undefined, true);
export const fetchAudit = (limit = 200) => request<AuditEntry[]>('GET', `/admin/audit?limit=${limit}`, undefined, true);

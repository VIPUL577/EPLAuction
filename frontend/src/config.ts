// Runtime config is loaded from /config.json so the same build works locally and on AWS.
// scripts/deploy-frontend.sh writes the AWS values (WebSocket URL, Cognito client) into it.
export interface AppConfig {
  apiBase: string;
  wsUrl: string;
  cognito: { region: string; clientId: string } | null;
}

let cached: AppConfig | null = null;

export async function loadConfig(): Promise<AppConfig> {
  if (cached) return cached;
  const res = await fetch('/config.json', { cache: 'no-store' });
  cached = (await res.json()) as AppConfig;
  return cached;
}

export function appConfig(): AppConfig {
  if (!cached) throw new Error('config not loaded');
  return cached;
}

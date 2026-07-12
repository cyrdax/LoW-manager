export interface ServerListenOptions {
  port: number;
  host: string;
}

const DEFAULT_DEV_HOST = '127.0.0.1';
const DEFAULT_PRODUCTION_HOST = '0.0.0.0';
const DEFAULT_PORT = 3100;
const DEV_COOKIE_SECRET = 'dev-secret';
const PLACEHOLDER_COOKIE_SECRETS = new Set([
  '',
  DEV_COOKIE_SECRET,
  'change-me-to-a-long-random-string',
]);

export function serverListenOptionsFromEnv(env: NodeJS.ProcessEnv = process.env): ServerListenOptions {
  return {
    port: serverPortFromEnv(env),
    host: env.HOST?.trim() || (isProductionRuntime(env) ? DEFAULT_PRODUCTION_HOST : DEFAULT_DEV_HOST),
  };
}

export function secureCookiesFromEnv(env: NodeJS.ProcessEnv = process.env): boolean {
  if (parseBoolean(env.SECURE_COOKIES)) return true;
  if (isProductionRuntime(env)) return true;
  return env.APP_BASE_URL?.startsWith('https://') ?? false;
}

export function cookieSecretFromEnv(env: NodeJS.ProcessEnv = process.env): string {
  const secret = env.COOKIE_SECRET?.trim() ?? '';
  if (!isProductionRuntime(env)) return secret || DEV_COOKIE_SECRET;
  if (PLACEHOLDER_COOKIE_SECRETS.has(secret)) {
    throw new Error('COOKIE_SECRET must be set to a long random value in production');
  }
  return secret;
}

function serverPortFromEnv(env: NodeJS.ProcessEnv): number {
  const raw = env.PORT ?? String(DEFAULT_PORT);
  const port = Number(raw);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`Invalid PORT: ${raw}`);
  }
  return port;
}

function isProductionRuntime(env: NodeJS.ProcessEnv): boolean {
  return env.NODE_ENV === 'production';
}

function parseBoolean(value: string | undefined): boolean {
  return value === '1' || value === 'true' || value === 'yes';
}

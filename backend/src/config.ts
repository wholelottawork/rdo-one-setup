import 'dotenv/config';

/**
 * Single typed view of the environment. Every module reads from here instead of
 * touching `process.env` directly, so defaults and names live in one place.
 *
 * Graceful-degradation is deliberate: we do NOT throw at boot for missing
 * secrets. The 1inch / Aster-signer / agent-key features each check their own
 * value lazily and 503/throw only when actually used (same behavior as before),
 * so the server still starts and serves everything else without them.
 */
function int(value: string | undefined, fallback: number): number {
  const n = parseInt(value ?? '', 10);
  return Number.isNaN(n) ? fallback : n;
}

export const config = {
  port: int(process.env.PORT, 3001),
  nodeEnv: process.env.NODE_ENV ?? 'development',
  isProd: process.env.NODE_ENV === 'production',

  redisUrl: process.env.REDIS_URL ?? 'redis://localhost:6379',

  // Comma-separated allowed frontend origins ('' / empty ⇒ allow all, same as
  // the original CORS plugin logic).
  allowedOrigins: (process.env.ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),

  rateLimit: {
    max: int(process.env.RATE_LIMIT_MAX, 200),
    windowMs: int(process.env.RATE_LIMIT_WINDOW_MS, 60_000),
  },

  // Optional secrets — empty string when unset; feature code guards on these.
  oneInchApiKey: process.env.ONEINCH_API_KEY ?? '',
  asterSignerPrivateKey: process.env.ASTER_SIGNER_PRIVATE_KEY ?? '',
  agentKeyEncryptionSecret: process.env.AGENT_KEY_ENCRYPTION_SECRET ?? '',
} as const;

export type Config = typeof config;

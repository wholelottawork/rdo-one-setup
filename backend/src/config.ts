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

  // Pino level. The default is derived from NODE_ENV (see the note in
  // index.ts), and that default is the one production should keep. The
  // override exists because the Docker stack runs NODE_ENV=production even
  // when it is running on a laptop for testing — without it, `warn` is the
  // only way to watch a local run, which hides the request log entirely.
  logLevel: process.env.LOG_LEVEL ?? '',

  // Comma-separated allowed frontend origins ('' / empty ⇒ allow all, same as
  // the original CORS plugin logic). Fine in dev, wrong in prod — .env.example
  // therefore ships real domains rather than an empty value.
  allowedOrigins: (process.env.ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),

  rateLimit: {
    max: int(process.env.RATE_LIMIT_MAX, 200),
    windowMs: int(process.env.RATE_LIMIT_WINDOW_MS, 60_000),
  },

  // WebSocket relay abuse backstops. The HTTP rate-limit plugin never sees an
  // upgrade, so these are the only ceiling on the relay. Deliberately generous:
  // a user with the app open in five tabs is not an attacker — this exists to
  // stop the VPS being used as a free, unbounded Hyperliquid relay.
  ws: {
    maxConnectionsPerIp: int(process.env.WS_MAX_CONNECTIONS_PER_IP, 25),
    maxSubscriptionsPerConnection: int(process.env.WS_MAX_SUBSCRIPTIONS_PER_CONNECTION, 100),
  },

  // ── Observability ────────────────────────────────────────────────────────
  // Stamped on the boot line so a log file can be pinned to the code that
  // produced it. deploy/deploy.sh already computes a short git SHA for
  // IMAGE_TAG, so this costs nothing to populate and answers "which build was
  // running at 3am" without guessing from deploy timestamps.
  release: process.env.RELEASE ?? process.env.IMAGE_TAG ?? '',

  // Opt-in, default OFF, and it must stay that way: request bodies on the
  // Aster routes are signatures — /aster-withdraw's body is a live withdrawal
  // Aster will replay until the nonce ages out. Even when this is on,
  // src/plugins/request-log.ts drops the money routes' bodies entirely rather
  // than redacting them field by field.
  logRequestBodies: process.env.LOG_REQUEST_BODIES === 'true',

  // Optional secrets — empty string when unset; feature code guards on these.
  oneInchApiKey: process.env.ONEINCH_API_KEY ?? '',
  lifiApiKey: process.env.LIFI_API_KEY ?? '',
  asterSignerPrivateKey: process.env.ASTER_SIGNER_PRIVATE_KEY ?? '',
  agentKeyEncryptionSecret: process.env.AGENT_KEY_ENCRYPTION_SECRET ?? '',
} as const;

export type Config = typeof config;

import crypto from "node:crypto";
import type { Redis } from "ioredis";
import { decrypt, encrypt } from "./secret-box";

// Aster's V1 endpoints — withdraw, deposit address — authenticate with the
// legacy Binance-style scheme: an API key header plus an HMAC-SHA256 of the
// query string, NOT the V3 EIP-712 agent signature the rest of this app uses
// (see aster-auth.ts). Those credentials can move funds.
//
// They used to be typed into the Transfer page and HMAC'd in the browser,
// which left a withdrawal-capable secret sitting in the DOM and in page memory
// for any extension or injected script to read. They are stored encrypted here
// instead (same AES-256-GCM box as the agent keys) and never sent back to a
// client — the only thing a browser can learn is whether a pair exists.
const REDIS_KEY_PREFIX = "aster:api-creds:";

export interface AsterCreds {
  apiKey: string;
  apiSecret: string;
}

export async function saveAsterCreds(redis: Redis, user: string, creds: AsterCreds): Promise<void> {
  await redis.set(REDIS_KEY_PREFIX + user.toLowerCase(), encrypt(JSON.stringify(creds)));
}

export async function loadAsterCreds(redis: Redis, user: string): Promise<AsterCreds | null> {
  const raw = await redis.get(REDIS_KEY_PREFIX + user.toLowerCase());
  if (!raw) return null;
  try {
    return JSON.parse(decrypt(raw)) as AsterCreds;
  } catch {
    // Wrong/rotated AGENT_KEY_ENCRYPTION_SECRET, or a corrupted value. Treat as
    // absent so the caller prompts for re-entry rather than 500ing.
    return null;
  }
}

export async function deleteAsterCreds(redis: Redis, user: string): Promise<void> {
  await redis.del(REDIS_KEY_PREFIX + user.toLowerCase());
}

/** Query string plus its HMAC-SHA256 signature, ready to append to a V1 URL. */
export function hmacQuery(secret: string, params: Record<string, string>): string {
  const qs = new URLSearchParams(params).toString();
  const signature = crypto.createHmac("sha256", secret).update(qs).digest("hex");
  return `${qs}&signature=${signature}`;
}

import { Wallet, type BaseWallet } from "ethers";
import type { Redis } from "ioredis";
import { decrypt, encrypt } from "./secret-box";

// Per-user Aster Pro API agent keys. Aster's own integration flow
// ("recommended: one signer per user" — asterdex.github.io/aster-api-website/
// asterCode/integration-flow/) requires a dedicated agent keypair per
// end user: their signed reads/trades resolve identity from the signer
// alone, not from any `user=` query param (confirmed against Aster's docs
// and reference client — see the frontend's lib/aster.ts ASTER_BUILDER_ADDRESS
// comment for the full writeup). A single shared agent, as this app used to
// use, can only ever be "live" for the one user who most recently approved it.
//
// Each user's agent private key is generated locally (no gas, no on-chain
// action, no Aster balance needed — it's purely a signer, canWithdraw is
// always false when we register it), encrypted at rest, and stored in
// Redis indefinitely (not a cache — no TTL). Losing this store just means
// affected users re-approve once; it never risks funds, since these agents
// can never withdraw.
const REDIS_KEY_PREFIX = "aster:agent-key:";

/**
 * Returns `userAddress`'s dedicated Aster agent wallet, minting and
 * persisting a fresh one on first call. Safe under concurrent first-visits
 * for the same address: `SET ... NX` means only one request's key ever
 * wins, and everyone else reads back the winner instead of clobbering it.
 */
export async function getOrCreateUserAgent(
  redis: Redis,
  userAddress: string,
): Promise<BaseWallet> {
  const key = REDIS_KEY_PREFIX + userAddress.toLowerCase();

  const existing = await redis.get(key);
  if (existing) return new Wallet(decrypt(existing));

  const wallet = Wallet.createRandom();
  const encrypted = encrypt(wallet.privateKey);
  const set = await redis.set(key, encrypted, "NX");
  if (set === null) {
    const winner = await redis.get(key);
    if (winner) return new Wallet(decrypt(winner));
  }
  return wallet;
}

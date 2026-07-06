import { Wallet } from "ethers";

// Aster Pro API (V3) — Web3-native auth, NOT the legacy X-MBX-APIKEY/HMAC
// scheme. Every signed (TRADE/USER_DATA/USER_STREAM) request is authenticated
// by an EIP-712 signature made with an "agent" wallet's private key, plus a
// microsecond nonce for replay protection. Verified against asterdex/api-docs
// (V3(Recommended)/EN/aster-finance-futures-api-v3.md) and confirmed live:
// fapi.asterdex.com is the correct host — the doc's own code sample points at
// fapi3.asterdex.com, which 403s on every endpoint including /ping.
const CHAIN_ID = 1666;
const VERIFYING_CONTRACT = "0x0000000000000000000000000000000000000000";
const MESSAGE_TYPES = { Message: [{ name: "msg", type: "string" }] };

let cachedWallet;

function getAgentWallet() {
  if (cachedWallet) return cachedWallet;
  const privateKey = process.env.ASTER_SIGNER_PRIVATE_KEY;
  if (!privateKey) {
    throw new Error(
      "ASTER_SIGNER_PRIVATE_KEY not configured — add the agent's private key to server/.env (never commit it, never paste it into chat)",
    );
  }
  cachedWallet = new Wallet(privateKey);
  return cachedWallet;
}

// Microsecond, strictly-increasing nonce — Aster tracks each user's last 100
// nonces and rejects anything older/duplicate (see V3 doc's "Nonce Mechanism").
let lastMs = 0;
let counter = 0;
function nextNonce() {
  const nowMs = Date.now();
  if (nowMs === lastMs) counter += 1;
  else {
    lastMs = nowMs;
    counter = 0;
  }
  return nowMs * 1000 + counter;
}

/**
 * Signs a param object for an Aster V3 signed endpoint. Returns the full
 * query string — including `signer`, `nonce`, and `signature` — ready to
 * append to the request URL or send as a form body.
 */
export async function signAsterV3Request(params = {}) {
  const signerAddress = process.env.ASTER_SIGNER_ADDRESS;
  if (!signerAddress) {
    throw new Error("ASTER_SIGNER_ADDRESS not configured — add it to server/.env");
  }

  const withAuth = { ...params, nonce: String(nextNonce()), signer: signerAddress };
  const query = new URLSearchParams(withAuth).toString();

  const wallet = getAgentWallet();
  const domain = {
    name: "AsterSignTransaction",
    version: "1",
    chainId: CHAIN_ID,
    verifyingContract: VERIFYING_CONTRACT,
  };
  const signature = await wallet.signTypedData(domain, MESSAGE_TYPES, { msg: query });

  return `${query}&signature=${signature}`;
}

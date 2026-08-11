// Run: npm test   (node strips the types natively, no test framework)
import assert from "node:assert/strict";
import { walletErrorMessage } from "./walletError.ts";
import { HlAgentError } from "./hl-agent.ts";

// The verbatim shape ethers v6 throws when MetaMask refuses an L1 action
// signature — the one that used to reach the UI in full.
const chainMismatch = {
  code: "UNKNOWN_ERROR",
  message:
    'could not coalesce error (error={ "code": -32603, "data": { "cause": { "message": "Provided chainId \\"1337\\" must match the active chainId \\"42161\\"", "stack": "Error: ...\\n    at c (chrome-extension://nkbihfbeogaeaoehlefnkodbefgpgknn/1620.js:2060:95295)" } }, "message": "Provided chainId \\"1337\\" must match the active chainId \\"42161\\"" }, payload={ "id": 4, "jsonrpc": "2.0", "method": "eth_signTypedData_v4" }, code=UNKNOWN_ERROR, version=6.17.0)',
  info: {
    error: {
      code: -32603,
      message: 'Provided chainId "1337" must match the active chainId "42161"',
    },
  },
};

const msg = walletErrorMessage(chainMismatch);
assert.equal(msg, "Wallet is on the wrong network for this signature");
assert.ok(!msg.includes("chrome-extension://"), "never leaks an extension stack");
assert.ok(msg.length < 80, "stays toast-sized");

// --- rejection, the overwhelmingly common case -----------------------------
assert.equal(
  walletErrorMessage({ code: "ACTION_REJECTED", message: "user rejected action" }),
  "Signature rejected in wallet",
);
assert.equal(
  walletErrorMessage({ info: { error: { code: 4001, message: "User denied message signature." } } }),
  "Signature rejected in wallet",
);

// --- other provider codes --------------------------------------------------
assert.match(walletErrorMessage({ code: -32002 }), /already open/);
assert.match(walletErrorMessage({ code: 4900 }), /disconnected/);
assert.match(walletErrorMessage({ code: "INSUFFICIENT_FUNDS" }), /gas/);

// --- our own errors pass through untouched ---------------------------------
const agentErr = new HlAgentError("Deposit to Hyperliquid first — an account has to exist before it can be traded.");
assert.equal(walletErrorMessage(agentErr), agentErr.message);

// --- readable provider text survives; junk does not ------------------------
assert.equal(walletErrorMessage({ message: "Order has invalid price." }), "Order has invalid price.");
assert.equal(
  walletErrorMessage({ message: '{ "jsonrpc": "2.0", "id": 1, "method": "eth_sendTransaction" }' }),
  "Transaction failed",
);
assert.equal(walletErrorMessage({ message: "x".repeat(300) }, "Close failed"), "Close failed");
assert.equal(walletErrorMessage(undefined, "Cancel failed"), "Cancel failed");

// --- network failures ------------------------------------------------------
assert.match(walletErrorMessage(new TypeError("Failed to fetch")), /Network error/);

console.log("walletError: ok");

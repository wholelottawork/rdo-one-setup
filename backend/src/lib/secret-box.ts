import crypto from "node:crypto";
import { config } from "../config";

// AES-256-GCM at-rest encryption for anything this process must store but must
// never hand back to a browser — per-user Aster agent private keys
// (agent-keystore.ts) and Aster V1 API credentials (aster-creds.ts). Both key
// off the same AGENT_KEY_ENCRYPTION_SECRET, so losing that secret invalidates
// both stores together and users re-enter what they had.
const ALGO = "aes-256-gcm";

function getEncryptionKey(): Buffer {
  const secret = config.agentKeyEncryptionSecret;
  if (!secret) {
    throw new Error(
      "AGENT_KEY_ENCRYPTION_SECRET not configured — add a random secret to backend/.env (never commit it, never paste it into chat)",
    );
  }
  return crypto.createHash("sha256").update(secret).digest();
}

export function encrypt(plaintext: string): string {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [iv, authTag, ciphertext].map((b) => b.toString("hex")).join(":");
}

export function decrypt(payload: string): string {
  const [ivHex, tagHex, dataHex] = payload.split(":");
  const key = getEncryptionKey();
  const decipher = crypto.createDecipheriv(ALGO, key, Buffer.from(ivHex, "hex"));
  decipher.setAuthTag(Buffer.from(tagHex, "hex"));
  return Buffer.concat([decipher.update(Buffer.from(dataHex, "hex")), decipher.final()]).toString("utf8");
}

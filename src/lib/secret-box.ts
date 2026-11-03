// Seal and open short secrets (alert webhook URLs and the HMAC secret,
// migration 0047) with AES-256-GCM under a key derived from APP_SECRET.
// No APP_SECRET (or one under 16 characters) → sealing is OFF: the alerts page
// says so and only email alerts can be saved. A wrong or rotated APP_SECRET
// opens nothing (null), and the alert is skipped with a logged reason; it never
// throws into a run.
import "server-only";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { appSecret } from "./provider-settings";

const VERSION = "v1";

function keyOf(secret: string): Buffer {
  return createHash("sha256").update(`saylent-secret-box:${secret}`).digest();
}

export function sealingAvailable(env: NodeJS.ProcessEnv = process.env): boolean {
  return appSecret(env) !== null;
}

/** "v1.<iv>.<tag>.<ciphertext>", base64url parts. */
export function seal(plain: string, env: NodeJS.ProcessEnv = process.env): string {
  const secret = appSecret(env);
  if (!secret) throw new Error("APP_SECRET is not set (16+ characters), so secrets cannot be stored");
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", keyOf(secret), iv);
  const body = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return [VERSION, iv.toString("base64url"), c.getAuthTag().toString("base64url"), body.toString("base64url")].join(".");
}

export function open(sealed: string | null | undefined, env: NodeJS.ProcessEnv = process.env): string | null {
  if (!sealed) return null;
  const secret = appSecret(env);
  if (!secret) return null;
  const [v, iv, tag, body] = sealed.split(".");
  if (v !== VERSION || !iv || !tag || !body) return null;
  try {
    const d = createDecipheriv("aes-256-gcm", keyOf(secret), Buffer.from(iv, "base64url"));
    d.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([d.update(Buffer.from(body, "base64url")), d.final()]).toString("utf8");
  } catch {
    return null;
  }
}

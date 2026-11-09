import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * Authenticated encryption for secrets stored in Postgres (AES-256-GCM, key from env).
 * Values are sealed into a versioned JSON envelope; anything that is not an envelope is legacy
 * plaintext and is returned as is on read. See docs/OAUTH.md ("Token Storage Security").
 */

export const SECRET_KEY_ENV = "CAMERON_SECRET_KEY";

const ALGORITHM = "aes-256-gcm";
const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;

export interface SecretEnvelope {
  enc: typeof ALGORITHM;
  v: 1;
  iv: string;
  tag: string;
  data: string;
}

/** The key is missing or malformed. Thrown instead of ever writing plaintext. */
export class SecretKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SecretKeyError";
  }
}

/** An envelope failed to open: wrong key, tampered ciphertext, or moved to another row/column. */
export class SecretDecryptError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SecretDecryptError";
  }
}

const GENERATE_HINT = `Generate one with: openssl rand -base64 32`;

export function parseKey(raw: string | undefined): Buffer {
  if (!raw || raw.trim() === "") {
    throw new SecretKeyError(
      `${SECRET_KEY_ENV} is not set, so MCP server credentials cannot be encrypted or read. ${GENERATE_HINT}`,
    );
  }
  const key = Buffer.from(raw.trim(), "base64");
  if (key.length !== KEY_BYTES) {
    throw new SecretKeyError(
      `${SECRET_KEY_ENV} must be ${KEY_BYTES} bytes, base64-encoded (got ${key.length}). ${GENERATE_HINT}`,
    );
  }
  return key;
}

export function isEnvelope(value: unknown): value is SecretEnvelope {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  return (
    Object.keys(v).length === 5 &&
    v.enc === ALGORITHM &&
    v.v === 1 &&
    typeof v.iv === "string" &&
    typeof v.tag === "string" &&
    typeof v.data === "string"
  );
}

/** Encrypt any JSON value. `context` is bound as associated data (e.g. table, column, row id). */
export function sealWith(key: Buffer, value: unknown, context: string): SecretEnvelope {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: TAG_BYTES });
  cipher.setAAD(Buffer.from(context, "utf8"));
  const data = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return {
    enc: ALGORITHM,
    v: 1,
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    data: data.toString("base64"),
  };
}

/** Decrypt an envelope; a non-envelope (legacy plaintext) is returned unchanged. */
export function openWith(key: Buffer, stored: unknown, context: string): unknown {
  if (!isEnvelope(stored)) return stored;
  try {
    const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(stored.iv, "base64"), {
      authTagLength: TAG_BYTES,
    });
    decipher.setAAD(Buffer.from(context, "utf8"));
    decipher.setAuthTag(Buffer.from(stored.tag, "base64"));
    const plain = Buffer.concat([
      decipher.update(Buffer.from(stored.data, "base64")),
      decipher.final(),
    ]);
    return JSON.parse(plain.toString("utf8"));
  } catch {
    throw new SecretDecryptError(
      `Could not decrypt ${context}: ${SECRET_KEY_ENV} is not the key it was written with, or the value was altered or copied from elsewhere.`,
    );
  }
}

function envKey(): Buffer {
  return parseKey(process.env[SECRET_KEY_ENV]);
}

// null, undefined and `{}` hold nothing to protect, so a server without credentials needs no key.
function isEmpty(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  return (
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype &&
    Object.keys(value).length === 0
  );
}

/** Seal with the env key. Empty values are stored as they are. */
export function sealSecret(value: unknown, context: string): unknown {
  if (isEmpty(value)) return value;
  return sealWith(envKey(), value, context);
}

/** Open with the env key. Plaintext passes through without needing the key. */
export function openSecret(stored: unknown, context: string): unknown {
  if (!isEnvelope(stored)) return stored;
  return openWith(envKey(), stored, context);
}

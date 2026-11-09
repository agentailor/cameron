import { randomBytes } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import {
  SECRET_KEY_ENV,
  SecretDecryptError,
  SecretKeyError,
  isEnvelope,
  openSecret,
  openWith,
  parseKey,
  sealSecret,
  sealWith,
} from "./secretBox";

const key = randomBytes(32);
const ctx = "mcp_server.auth_tokens:abc";
const tokens = { access_token: "at-123", refresh_token: "rt-456", expires_in: 3600 };

describe("sealWith / openWith", () => {
  it("round-trips a JSON value and leaves no plaintext in the envelope", () => {
    const env = sealWith(key, tokens, ctx);
    expect(isEnvelope(env)).toBe(true);
    expect(JSON.stringify(env)).not.toContain("rt-456");
    expect(openWith(key, env, ctx)).toEqual(tokens);
  });

  it("uses a fresh IV per value", () => {
    const a = sealWith(key, tokens, ctx);
    const b = sealWith(key, tokens, ctx);
    expect(a.iv).not.toBe(b.iv);
    expect(a.data).not.toBe(b.data);
  });

  it("rejects tampered ciphertext", () => {
    const env = sealWith(key, tokens, ctx);
    const bytes = Buffer.from(env.data, "base64");
    bytes[0] ^= 0xff;
    expect(() => openWith(key, { ...env, data: bytes.toString("base64") }, ctx)).toThrow(
      SecretDecryptError,
    );
  });

  it("rejects a tampered tag", () => {
    const env = sealWith(key, tokens, ctx);
    const tag = Buffer.from(env.tag, "base64");
    tag[0] ^= 0x01;
    expect(() => openWith(key, { ...env, tag: tag.toString("base64") }, ctx)).toThrow(
      SecretDecryptError,
    );
  });

  it("rejects the wrong key", () => {
    const env = sealWith(key, tokens, ctx);
    expect(() => openWith(randomBytes(32), env, ctx)).toThrow(SecretDecryptError);
  });

  it("rejects an envelope moved to another row or column", () => {
    const env = sealWith(key, tokens, ctx);
    expect(() => openWith(key, env, "mcp_server.auth_tokens:other")).toThrow(SecretDecryptError);
    expect(() => openWith(key, env, "mcp_server.headers:abc")).toThrow(SecretDecryptError);
  });

  it("passes legacy plaintext through on read", () => {
    expect(openWith(key, tokens, ctx)).toEqual(tokens);
    expect(openWith(key, { API_TOKEN: "x" }, ctx)).toEqual({ API_TOKEN: "x" });
    expect(openWith(key, null, ctx)).toBeNull();
  });
});

describe("isEnvelope", () => {
  it("does not mistake a map that merely has similar keys for an envelope", () => {
    const env = sealWith(key, tokens, ctx);
    expect(isEnvelope({ ...env, extra: "x" })).toBe(false);
    expect(isEnvelope({ ...env, v: 2 })).toBe(false);
    expect(isEnvelope([env])).toBe(false);
  });
});

describe("parseKey", () => {
  it("accepts 32 base64 bytes", () => {
    expect(parseKey(key.toString("base64")).equals(key)).toBe(true);
  });

  it("refuses a missing or wrong-length key", () => {
    expect(() => parseKey(undefined)).toThrow(SecretKeyError);
    expect(() => parseKey("  ")).toThrow(SecretKeyError);
    expect(() => parseKey(randomBytes(16).toString("base64"))).toThrow(SecretKeyError);
  });
});

describe("sealSecret / openSecret (env key)", () => {
  const original = process.env[SECRET_KEY_ENV];
  afterEach(() => {
    if (original === undefined) delete process.env[SECRET_KEY_ENV];
    else process.env[SECRET_KEY_ENV] = original;
  });

  it("refuses to write a secret without a key — never falls back to plaintext", () => {
    delete process.env[SECRET_KEY_ENV];
    expect(() => sealSecret(tokens, ctx)).toThrow(SecretKeyError);
  });

  it("needs no key for empty values or legacy plaintext reads", () => {
    delete process.env[SECRET_KEY_ENV];
    expect(sealSecret(null, ctx)).toBeNull();
    expect(sealSecret({}, ctx)).toEqual({});
    expect(() => sealSecret({ A: "" }, ctx)).toThrow(SecretKeyError);
    expect(openSecret(tokens, ctx)).toEqual(tokens);
  });

  it("fails loudly reading an envelope without a key", () => {
    process.env[SECRET_KEY_ENV] = key.toString("base64");
    const env = sealSecret(tokens, ctx);
    delete process.env[SECRET_KEY_ENV];
    expect(() => openSecret(env, ctx)).toThrow(SecretKeyError);
  });

  it("round-trips with the env key", () => {
    process.env[SECRET_KEY_ENV] = key.toString("base64");
    expect(openSecret(sealSecret(tokens, ctx), ctx)).toEqual(tokens);
  });
});

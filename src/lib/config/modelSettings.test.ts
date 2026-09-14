import { describe, expect, it } from "vitest";
import {
  isSupportedProvider,
  OPENAI_COMPATIBLE_PROVIDER,
  parseBaseUrl,
  parseModelName,
  parseProvider,
  providerRequiresBaseUrl,
} from "./modelSettings";

describe("isSupportedProvider", () => {
  it("accepts the four shipped providers and nothing else", () => {
    expect(isSupportedProvider("anthropic")).toBe(true);
    expect(isSupportedProvider("openai")).toBe(true);
    expect(isSupportedProvider("google")).toBe(true);
    expect(isSupportedProvider(OPENAI_COMPATIBLE_PROVIDER)).toBe(true);
    expect(isSupportedProvider("grok")).toBe(false);
    expect(isSupportedProvider("")).toBe(false);
  });
});

describe("providerRequiresBaseUrl", () => {
  it("is true only for the compatible provider", () => {
    expect(providerRequiresBaseUrl(OPENAI_COMPATIBLE_PROVIDER)).toBe(true);
    expect(providerRequiresBaseUrl("anthropic")).toBe(false);
    expect(providerRequiresBaseUrl("nonsense")).toBe(false);
  });
});

describe("parseProvider", () => {
  it("accepts a known provider", () => {
    expect(parseProvider("anthropic")).toEqual({ ok: true, value: "anthropic" });
  });

  it("rejects an unknown one and lists the valid ids", () => {
    const result = parseProvider("grok");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("anthropic");
  });
});

describe("parseModelName", () => {
  it("trims and accepts a name", () => {
    expect(parseModelName("  gpt-4o  ")).toEqual({ ok: true, value: "gpt-4o" });
  });

  it("rejects an empty name", () => {
    expect(parseModelName("   ").ok).toBe(false);
  });
});

describe("parseBaseUrl", () => {
  it("accepts an http or https URL and strips trailing slashes", () => {
    expect(parseBaseUrl("http://localhost:11434/v1/")).toEqual({
      ok: true,
      value: "http://localhost:11434/v1",
    });
    expect(parseBaseUrl("https://api.groq.com/openai/v1").ok).toBe(true);
  });

  it("rejects an empty value", () => {
    expect(parseBaseUrl("").ok).toBe(false);
  });

  it("rejects a non-URL", () => {
    expect(parseBaseUrl("localhost:11434").ok).toBe(false);
  });

  it("rejects a non-http protocol", () => {
    expect(parseBaseUrl("ftp://example.com/v1").ok).toBe(false);
  });
});

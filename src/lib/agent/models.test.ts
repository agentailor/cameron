import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createChatModel, needsSchemaSanitizing, OPENAI_COMPATIBLE_PROVIDER } from "./models";

const ENV_KEYS = [
  "OPENAI_COMPATIBLE_API_KEY",
  "OPENAI_COMPATIBLE_SANITIZE_SCHEMA",
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "GOOGLE_API_KEY",
] as const;

const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const key of ENV_KEYS) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

function apiKeyOf(model: unknown): string | undefined {
  return (model as { apiKey?: string }).apiKey;
}

function modelNameOf(model: unknown): string | undefined {
  return (model as { model?: string }).model;
}

describe("createChatModel", () => {
  it("throws on an unknown provider instead of falling back to Google", () => {
    expect(() => createChatModel({ provider: "grok", model: "grok-4" })).toThrow(
      /Unknown model provider/,
    );
  });

  it("throws when no provider is given rather than defaulting to one", () => {
    expect(() => createChatModel({ provider: "", model: "some-model" })).toThrow(
      /Unknown model provider/,
    );
  });

  it("builds the three built-in providers", () => {
    process.env.OPENAI_API_KEY = "sk-test";
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    process.env.GOOGLE_API_KEY = "goog-test";
    expect(createChatModel({ provider: "openai", model: "gpt-4o" })).toBeDefined();
    expect(createChatModel({ provider: "anthropic", model: "claude-haiku-4-5" })).toBeDefined();
    expect(createChatModel({ provider: "google", model: "gemini-3-flash-preview" })).toBeDefined();
  });

  describe(OPENAI_COMPATIBLE_PROVIDER, () => {
    it("requires a base URL", () => {
      expect(() =>
        createChatModel({ provider: OPENAI_COMPATIBLE_PROVIDER, model: "qwen3" }),
      ).toThrow(/requires a base URL/);
    });

    it("requires a model name", () => {
      expect(() =>
        createChatModel({
          provider: OPENAI_COMPATIBLE_PROVIDER,
          model: "",
          baseUrl: "http://localhost:11434/v1",
        }),
      ).toThrow(/requires a model name/);
    });

    it("uses the base URL and model it is given", () => {
      const llm = createChatModel({
        provider: OPENAI_COMPATIBLE_PROVIDER,
        model: "qwen3:32b",
        baseUrl: "http://localhost:11434/v1",
      });
      expect(modelNameOf(llm)).toBe("qwen3:32b");
    });

    it("never sends OPENAI_API_KEY to a third-party endpoint", () => {
      process.env.OPENAI_API_KEY = "sk-real-openai-key";
      const llm = createChatModel({
        provider: OPENAI_COMPATIBLE_PROVIDER,
        model: "some-model",
        baseUrl: "https://api.example.com/v1",
      });
      expect(apiKeyOf(llm)).not.toBe("sk-real-openai-key");
    });

    it("uses OPENAI_COMPATIBLE_API_KEY when set", () => {
      process.env.OPENAI_COMPATIBLE_API_KEY = "gsk-compatible";
      const llm = createChatModel({
        provider: OPENAI_COMPATIBLE_PROVIDER,
        model: "some-model",
        baseUrl: "https://api.example.com/v1",
      });
      expect(apiKeyOf(llm)).toBe("gsk-compatible");
    });
  });
});

describe("needsSchemaSanitizing", () => {
  it("always sanitizes for Google and never for the other built-ins", () => {
    expect(needsSchemaSanitizing("google")).toBe(true);
    expect(needsSchemaSanitizing("openai")).toBe(false);
    expect(needsSchemaSanitizing("anthropic")).toBe(false);
  });

  it("is opt-in for the compatible provider", () => {
    expect(needsSchemaSanitizing(OPENAI_COMPATIBLE_PROVIDER)).toBe(false);
    process.env.OPENAI_COMPATIBLE_SANITIZE_SCHEMA = "true";
    expect(needsSchemaSanitizing(OPENAI_COMPATIBLE_PROVIDER)).toBe(true);
  });
});

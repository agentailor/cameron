import { describe, expect, it } from "vitest";
import { GraphRecursionError } from "@langchain/langgraph";
import { describeRunError, MAX_RUN_ERROR_DETAIL_CHARS, runErrorMessage } from "./runErrors";

/** The shape LangChain gives a provider's 401: a status, a code and a docs link. */
function langchainError(message: string, fields: Record<string, unknown>) {
  const error = new Error(
    `${message}\n\nTroubleshooting URL: https://docs.langchain.com/oss/javascript/langchain/errors/X/\n`,
  );
  return Object.assign(error, fields);
}

describe("describeRunError", () => {
  it("names the key to check when the provider rejects it", () => {
    const error = langchainError("401 Unauthorized", {
      status: 401,
      lc_error_code: "MODEL_AUTHENTICATION",
    });
    const described = describeRunError(error, { keyEnvVar: "OPENAI_COMPATIBLE_API_KEY" });

    expect(described.code).toBe("model_auth");
    expect(described.message).toContain("OPENAI_COMPATIBLE_API_KEY");
    // The raw error is kept, without LangChain's docs link.
    expect(described.detail).toBe("401 Unauthorized");
  });

  it("still reads an auth failure from the text alone", () => {
    expect(describeRunError(new Error("401 Unauthorized")).code).toBe("model_auth");
    expect(describeRunError(new Error("Incorrect API key provided")).code).toBe("model_auth");
  });

  it.each([
    [langchainError("model x not found", { lc_error_code: "MODEL_NOT_FOUND" }), "model_not_found"],
    [langchainError("slow down", { status: 429 }), "rate_limited"],
    // By name: importing modelSettings would pull in the database client.
    [
      Object.assign(new Error("No model"), { name: "ModelNotConfiguredError" }),
      "model_not_configured",
    ],
    [new GraphRecursionError("Recursion limit of 50 reached"), "out_of_steps"],
    [new Error("fetch failed: ECONNREFUSED 127.0.0.1:11434"), "network"],
    [new Error("something odd"), "unknown"],
    ["a thrown string", "unknown"],
  ])("classifies %s", (error, code) => {
    const described = describeRunError(error);
    expect(described.code).toBe(code);
    expect(described.message.length).toBeGreaterThan(0);
  });

  it("caps a long raw error", () => {
    const { detail } = describeRunError(new Error("x".repeat(5000)));
    expect(detail).toHaveLength(MAX_RUN_ERROR_DETAIL_CHARS);
    expect(detail.endsWith("…")).toBe(true);
  });
});

describe("runErrorMessage", () => {
  it("renders the description as an error message, stable per saved failure", () => {
    const error = { code: "model_auth" as const, message: "Check the key.", detail: "401" };
    const message = runErrorMessage({ ...error, at: "2026-11-27T10:00:00.000Z" });
    expect(message).toEqual({
      type: "error",
      data: {
        id: "run-error-2026-11-27T10:00:00.000Z",
        content: "Check the key.",
        code: "model_auth",
        detail: "401",
      },
    });
  });
});

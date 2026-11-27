import type { MessageResponse } from "@/types/message";

/**
 * Why a run failed, in words the owner can act on. The raw error stays as `detail`.
 * A leaf (type imports only): the client builds the chat message from it, and tests stay free.
 */

export type RunErrorCode =
  | "model_auth"
  | "model_not_found"
  | "rate_limited"
  | "model_not_configured"
  | "network"
  | "out_of_steps"
  | "unknown";

export interface RunError {
  code: RunErrorCode;
  /** One or two sentences saying what to do. */
  message: string;
  /** The underlying error, trimmed; shown behind a toggle. */
  detail: string;
}

/** Longest raw error kept as `detail`. */
export const MAX_RUN_ERROR_DETAIL_CHARS = 600;

export interface RunErrorContext {
  /** The env var holding the selected provider's key, e.g. OPENAI_COMPATIBLE_API_KEY. */
  keyEnvVar?: string;
}

function rawMessage(error: unknown): string {
  if (error instanceof Error) return error.message || error.name;
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error) ?? String(error);
  } catch {
    return String(error);
  }
}

/** LangChain appends a docs link to every typed error; it is noise next to our own sentence. */
function trimDetail(text: string): string {
  const withoutLink = text.replace(/\s*Troubleshooting URL:\s*\S+\s*$/i, "").trim();
  return withoutLink.length <= MAX_RUN_ERROR_DETAIL_CHARS
    ? withoutLink
    : `${withoutLink.slice(0, MAX_RUN_ERROR_DETAIL_CHARS - 1)}…`;
}

function field(error: unknown, key: string): unknown {
  return typeof error === "object" && error !== null
    ? (error as Record<string, unknown>)[key]
    : undefined;
}

function codeOf(error: unknown, text: string): RunErrorCode {
  const name = error instanceof Error ? error.name : "";
  const lcCode = String(field(error, "lc_error_code") ?? "");
  const status = Number(field(error, "status") ?? field(error, "statusCode") ?? NaN);

  if (name === "ModelNotConfiguredError") return "model_not_configured";
  if (name === "GraphRecursionError" || lcCode === "GRAPH_RECURSION_LIMIT") return "out_of_steps";
  if (lcCode === "MODEL_AUTHENTICATION" || status === 401 || status === 403) return "model_auth";
  if (lcCode === "MODEL_NOT_FOUND" || status === 404) return "model_not_found";
  if (lcCode === "MODEL_RATE_LIMIT" || status === 429) return "rate_limited";
  if (/^(401|403)\b|unauthorized|invalid api key|incorrect api key/i.test(text)) {
    return "model_auth";
  }
  if (/^429\b|rate limit/i.test(text)) return "rate_limited";
  if (/ECONNREFUSED|ENOTFOUND|ETIMEDOUT|ECONNRESET|fetch failed|Connection error/i.test(text)) {
    return "network";
  }
  return "unknown";
}

function messageFor(code: RunErrorCode, context: RunErrorContext): string {
  switch (code) {
    case "model_auth":
      return context.keyEnvVar
        ? `The model provider rejected the API key. Check ${context.keyEnvVar} in your environment, then restart Cameron.`
        : "The model provider rejected the API key. Check it in your environment, then restart Cameron.";
    case "model_not_found":
      return "The model provider doesn't recognize the selected model. Pick another one in Settings.";
    case "rate_limited":
      return "The model provider is limiting requests right now. Wait a moment, then send your message again.";
    case "model_not_configured":
      return "No model is set up yet. Choose a provider and a model in Settings.";
    case "network":
      return "Cameron couldn't reach the model provider. Check your connection and the endpoint in Settings.";
    case "out_of_steps":
      return "Cameron ran out of steps before finishing. Try asking again, more narrowly.";
    case "unknown":
      return "Something went wrong and Cameron couldn't finish this reply.";
  }
}

export function describeRunError(error: unknown, context: RunErrorContext = {}): RunError {
  const text = rawMessage(error);
  const code = codeOf(error, text);
  return { code, message: messageFor(code, context), detail: trimDetail(text) };
}

/** A run failure as the chat renders it, live from the stream or saved on the thread. */
export function runErrorMessage(error: RunError & { at?: string }): MessageResponse {
  return {
    type: "error",
    data: {
      id: `run-error-${error.at ?? Date.now()}`,
      content: error.message,
      code: error.code,
      detail: error.detail,
    },
  };
}

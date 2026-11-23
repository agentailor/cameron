import type { BaseLanguageModel } from "@langchain/core/language_models/base";
import { ClearToolUsesEdit, countTokensApproximately, createMiddleware } from "langchain";

/** Approximate tokens (chars-based) in the request before old tool results are cleared. */
export const CONTEXT_CLEAR_TRIGGER = 40_000;

/** Most recent tool results always sent in full. */
export const CONTEXT_KEEP_RESULTS = 5;

/** Results the agent keeps acting on: instructions, preferences, validations, the schema. */
export const NEVER_CLEARED_TOOLS = [
  "load_skill",
  "validate_csv_import",
  "validate_transaction_update",
  "validate_transaction_delete",
  "describe_finance_schema",
] as const;

export const CLEARED_PLACEHOLDER =
  "[cleared to save context; call the tool again if you need this result]";

/**
 * Clears old tool results from the request sent to the model, never from the thread.
 *
 * Not langchain's `contextEditingMiddleware`: it edits `request.messages`, which is the state
 * array itself, so the clearing was saved into the checkpoint (see docs/MEMORY.md).
 */
export function contextEditingMiddleware(
  opts: { triggerTokens?: number; keepResults?: number } = {},
) {
  const edit = new ClearToolUsesEdit({
    trigger: { tokens: opts.triggerTokens ?? CONTEXT_CLEAR_TRIGGER },
    keep: { messages: opts.keepResults ?? CONTEXT_KEEP_RESULTS },
    excludeTools: [...NEVER_CLEARED_TOOLS],
    placeholder: CLEARED_PLACEHOLDER,
  });
  return createMiddleware({
    name: "CameronContextEditing",
    wrapModelCall: async (request, handler) => {
      if (!request.messages?.length) return handler(request);
      const messages = [...request.messages];
      await edit.apply({
        messages,
        // Read only for `fraction` limits, which this middleware doesn't use.
        model: request.model as unknown as BaseLanguageModel,
        countTokens: countTokensApproximately,
      });
      return handler({ ...request, messages });
    },
  });
}

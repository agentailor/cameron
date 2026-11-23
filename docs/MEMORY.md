# Memory

How Cameron keeps a long thread within the model's context. (Preferences that persist across
threads will be documented here as well.)

## Context editing

Tool results are most of what makes a thread long: one `run_sql`, `query_transactions` or
`read_document` result can be larger than the whole conversation around it. Once a request passes
`CONTEXT_CLEAR_TRIGGER` approximate tokens, older tool results are replaced in **the request sent
to the model** with:

```
[cleared to save context; call the tool again if you need this result]
```

The placeholder tells the agent what to do, so the system prompt carries no rule about it. The
`CONTEXT_KEEP_RESULTS` most recent results are always sent in full.

Code: `src/lib/agent/contextEditing.ts`, installed in `src/lib/agent/index.ts` as the innermost
`wrapModelCall`, so the malformed-call retry is trimmed too.

### The saved thread is never edited

The thread the owner sees, approval-card previews (`linkPreviews`) and `pendingToolCallIds` are
all read from the checkpoint. Clearing a result there would remove it from the owner's history,
not just from the model's view.

That's why Cameron does not install langchain's `contextEditingMiddleware`. `createAgent` hands
`wrapModelCall` the **state's own message array**, and the built-in edits that array in place, so
its placeholders were saved into the checkpoint after one model call. Cameron's middleware runs
langchain's `ClearToolUsesEdit` on a copy. `contextEditing.test.ts` pins this: it fails if the
copy is removed.

For the same reason, langchain's `summarizationMiddleware` is not used: it runs in `beforeModel`
and replaces the thread's messages with a summary (`RemoveMessage(REMOVE_ALL_MESSAGES)`).

### Never cleared

`NEVER_CLEARED_TOOLS` holds results the agent keeps acting on:

| Tool                                                                                | Why                                                                                                                                           |
| ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `load_skill`                                                                        | Clearing it makes the agent forget a skill's instructions mid-task.                                                                           |
| `validate_csv_import`, `validate_transaction_update`, `validate_transaction_delete` | The agent acts on what they report. (The gate itself doesn't depend on them: validation fingerprints are kept in memory, not in the history.) |
| `describe_finance_schema`                                                           | Small, and used before every `run_sql`.                                                                                                       |

A test pins every name to a registered tool, so a rename can't silently make a tool clearable.

### Settings

- **Approximate token counts** (character-based). Exact counting only works with OpenAI models.
- **An absolute token limit, not a fraction of the context window.** A fraction needs the model's
  context size, which `openai-compatible` endpoints don't report. A model with a small context
  window may still need a lower `CONTEXT_CLEAR_TRIGGER`.
- Constants, not owner settings.

### Tracing

A `chat` span carries `cameron.context.cleared_results` (a count) when that call had results
cleared. It's recorded with content capture off, since it's a count, not content.

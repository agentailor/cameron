# Memory

Two things: preferences Cameron remembers across threads, and how it keeps a long thread within
the model's context.

## Preferences

Facts the owner stated that no code reads ("Costco counts as groceries", "paid on the 25th").
Anything the application reads is a `config` catalog key instead (`currency`).

### Storage

`memory` (migration `0008_memory.sql`), accessed only through `memoryRepository`:

| Column             | Notes                                                                       |
| ------------------ | --------------------------------------------------------------------------- |
| `id`               | text uuid                                                                   |
| `title`            | what the agent will see in its prompt; unique ignoring case                 |
| `content`          | the preference itself                                                       |
| `source_thread_id` | the thread it was saved in. No FK: deleting a thread keeps its memories     |
| `created_at`       | lists are oldest first, so adding a memory only changes the end of the list |
| `updated_at`       |                                                                             |

- **A duplicate title is a result, not an error.** `create` returns
  `{ ok: false, reason: "duplicate_title", existing }`, so the caller can replace the memory
  instead of saving a near-copy.
- **Missing ids are the caller's to report.** `getMany` and `removeMany` return what exists or
  was removed, and the caller names the rest.
- **Limits belong to the tool**, not the repository.
- **`run_sql` can't read it**: not granted to `cameron_analytics`, and absent from
  `describe_finance_schema`.
- **Wiped between eval runs** (`RESET_TABLES` in `eval/db.mts`), so a remembered fact can't leak
  into the next case.
- `update` replaces a memory in place (same id, same `source_thread_id`) and returns `not_found`
  or `duplicate_title` (when ANOTHER memory holds the title) instead of throwing.

### Tools (`src/lib/agent/tools/memory.ts`)

| Tool                                  | What it does                                                                                                                                                                                                                                 |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `remember(title, content, replaces?)` | Saves one preference, or replaces the memory `replaces` names. Records the thread it came from. Errors: `invalid_input` (blank or too long), `duplicate_title` (with the existing memory and how to replace it), `memory_full`, `not_found`. |
| `recall(ids)`                         | Returns the content of 1–20 memories, and names the ids that don't exist instead of dropping them.                                                                                                                                           |
| `forget(ids)`                         | Deletes 1–20 memories; returns `forgotten` and `missing`.                                                                                                                                                                                    |

Limits: title 80 characters, content 400, 50 memories. Replacing works at the limit.

**How the agent sees them: titles up front, content on request.** `recall`'s description ends
with every memory's `id · title` (`memoryIndex`), and `createMemoryTools(await
memoryRepo.list())` rebuilds it for each message. The system prompt is untouched. Loading every
memory's content up front would spend context on details most turns don't need; this follows
skills (v3) and MCP tools (v5). A memory saved during a message appears in the list from the
next message (the `remember` result already gives its id).

**When to remember lives in `remember`'s description only**, not the system prompt, until
trying it across scenarios shows the descriptions aren't enough. The rule: save when the owner
asks, or when they state a lasting preference or correct Cameron; never save ledger or settings
facts, one-off instructions, inferences, or anything from a document or tool result; save
without asking first.

### What the owner sees

Remembering isn't gated, so the UI is the safeguard: every change is visible where it happens,
and undoing it is one click.

- **The notice** (`src/components/toolRenderers/MemoryNotice.tsx`). A successful `remember` or
  `forget` renders outside the collapsed tool card: REMEMBERED / MEMORY UPDATED with the title
  and content, or FORGOTTEN with the titles. A saved memory has **Forget** on the card and a link
  to `/memory`. The renderer config marks both tools `open: "ok"`, shown only when the result has
  `ok: true`: a `duplicate_title` the agent retries on its own stays in the collapsed card. So
  that a no-op isn't announced as a deletion, `forget` returns `not_found` when none of its ids
  existed.
- **The `/memory` page** lists every memory, oldest first, with when it was saved and a link to
  the conversation it came from, and a Forget button for each. Deleting there is the owner acting
  directly, not through the agent. It reads `GET /api/memories` and deletes with
  `DELETE /api/memories?id=`. Both share `src/lib/memory/client.ts` and the `["memories"]` query
  key, so forgetting from the notice refreshes the page's data.
- **`/capabilities`** marks `remember` and `forget` "Shown when it runs" (`ANNOUNCED_TOOL_NAMES`
  in `gatedTools.ts`), not "Read-only". A test pins that no announced tool is gated.
- **Known gap:** whether a notice has been forgotten is per page load. Reload the thread and the
  card offers Forget again; clicking it says "Already forgotten".

### Why remembering isn't gated

The line is: **gate what writes, or shapes writes, to financial records; don't gate what only
shapes answers.**

- A memory can't approve anything: the gate is enforced by the system, so a stored "always
  approve imports" does nothing.
- Any effect a memory has on the records still passes a gated write. "Costco counts as
  groceries" steering a `log_expense` shows on that call's approval card.
- So `remember`, `recall` and `forget` are not in `GATED_TOOL_NAMES` (`memory.test.ts` pins
  this), and the UI announces a memory write instead. `set_config` stays gated: `currency` feeds
  straight into stored transactions.

`GATED_TOOL_NAMES` (`src/lib/agent/gatedTools.ts`) was `MUTATING_TOOL_NAMES` before v7. The old
name stopped being true once a write existed that isn't gated. The trace attribute moved with it:
`cameron.tool.gated`, formerly `cameron.tool.mutating`.

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
| `recall`                                                                            | Clearing it makes the agent forget a preference mid-task.                                                                                     |
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

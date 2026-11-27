# Tool grants

The approval gate was designed for an owner sitting in the thread: every write, and every tool
from a connected server, stops for a click. A scheduled task runs while nobody is there, so it
would stop on every call. A **grant** is that click given in advance: the owner lets a tool run
without stopping, within one **scope**, from the next run.

The gate itself doesn't change. A run collects the grants that apply to it and passes them to
`approvalGateMiddleware({ preApproved })`; `pausesFor(name, preApproved)` (`gatedTools.ts`) is
the whole rule. Cameron's identity rule holds: every capability still passes the gate, either by
a click on the call or by a standing grant the owner made, can see, and can revoke.

## A grant

One row in `tool_grant`: `(scope_kind, scope_id, tool)`, unique together.

- **Scope.** Only `task` today (`scope_id` is the task's name). Another consumer (all of chat, one
  thread, a trigger) is a new `GrantScope` kind (`src/types/grant.ts`) and a caller that collects
  its grants; storage and the gate already fit.
- **Tool.** One tool name. An MCP server is granted tool by tool: "all tools listed now" on
  `/tasks` grants each one listed at that moment. A tool the server adds later asks first until
  the owner grants it, so a catalog refresh can never widen a grant.

- **Server.** An MCP grant stores its server's id (`server_id`, NULL for Cameron's own tools),
  resolved from the catalog when the owner saves (`withServers`). A tool name alone can't say
  which server a grant belongs to: server names allow `_`, so `a` + `b_x` and `a_b` + `x` are both
  `a_b_x`.
  - **Deleting the server deletes its grants** (`ON DELETE CASCADE`), so a server re-added under
    the same name, or a different one given that name, starts with none and every tool asks first.
  - **Renaming it** drops them too, in the same transaction (`mcpServerRepository.update`): its tool
    names changed, and a grant left behind could match a future server of the old name.
  - **Turning it off** keeps them: the row still exists, and the editor lists them as "not found
    now", revocable.

`toolGrantRepository` is the only ORM seam. Which tools may be granted is `lib/tasks/grants.ts`.

## What can be granted

| Tool                                                  | Grantable | Shown as                                      |
| ----------------------------------------------------- | --------- | --------------------------------------------- |
| `log_expense`, `log_from_document`, `create_category` | yes       | adds records you can delete                   |
| `update_transaction`, `set_config`                    | yes       | changes records in place                      |
| `import_transactions_csv`                             | yes       | adds many records at once                     |
| `delete_transaction`                                  | **never** | a hard delete: always asks                    |
| any MCP tool                                          | yes       | the server's own `readOnlyHint`, or a warning |
| built-in reads, memory, `load_tools`                  | no need   | they already run                              |

The risk is a description, not a rule: the owner decides. Only `delete_transaction` is barred,
because a hard delete has no undo; `NEVER_GRANTABLE_TOOL_NAMES` makes `pausesFor` pause it
whatever it is given. `grants.test.ts` fails if a new built-in write isn't classified, so a new
write can't become grantable without a risk.

An MCP server's `readOnlyHint` is its own claim, read from the stored catalog (nothing connects
to show it). Many servers don't set it, so the page warns rather than refuses.

## Tasks

- **`tools`** in `TASK.md` declares the tools a task expects to use. The package passes it on
  without reading it; Cameron marks those tools "suggested" in the editor. It grants nothing, and
  it's also where limiting what a run can see would read from later.
- **Granted on `/tasks`**, in each task's editor (`GET` / `PUT /api/tasks/{name}/grants`). `PUT`
  replaces the set; it refuses the hard delete, a tool that already runs, and a tool no server
  lists, unless it was already granted (a server turned off for a while keeps its grants).
- **Fixed per run.** A run stores the grants it started with (`task_run.granted_tools`); its
  retries, its recovery and the owner's resumes reuse them. A grant changed while a run is paused
  can't change the step it paused on, and applies from the next run.
- **A resumed turn keeps them.** When the owner approves a paused step on the task's thread, the
  continued turn is still the task's work: `streamResponse` takes the run's grants from the thread
  (`grantsForThread`). Never from the request: `approvalGate.test.ts` pins that the stream route
  and `MessageOptions` can't carry them. Ordinary chat has none.
- **A grant never answers a server's question.** A granted MCP call skips the approval gate, but
  a question its server asks mid-call (MCP elicitation) still pauses the run, with reason
  `server_request`. See [MCP_ELICITATION.md](MCP_ELICITATION.md).

## Mixed steps

One model step can now hold a granted call and a gated one. `readPendingBatch` therefore matches
the gate's own `actionRequests` to the step's calls, in order, instead of re-deriving the batch
from `requiresApproval`: the old derivation included the granted call, misaligned the batch, and
refused every resume.

## Not yet

- Grants for chat or a single thread (a new scope kind).
- Conditions on a call ("import up to 10 rows", "expenses up to €100"), checked against the call's
  real arguments. That deliberately changes the rule that approval never depends on arguments,
  which exists so a _model-written_ flag can't decide approval; an owner-set bound is different.
- A record of what ran under a grant, with undo where it can be done: the review side of "an
  approval queue for actions taken while unattended".

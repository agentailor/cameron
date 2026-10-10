# Correcting and deleting transactions

Before these tools existed the ledger was append-only from the agent's side. A wrong amount or
currency was permanent once approved, and the agent's only remedy was to "log it again", which
leaves the wrong row in place and counts the expense twice (issue #12).

## The four tools

| Tool                          | Writes? | Approval  | Purpose                                |
| ----------------------------- | ------- | --------- | -------------------------------------- |
| `validate_transaction_update` | no      | auto      | Preview one row's before → after       |
| `update_transaction`          | **yes** | **gated** | Correct one row in place               |
| `validate_transaction_delete` | no      | auto      | Show the rows a delete would remove    |
| `delete_transaction`          | **yes** | **gated** | Delete 1–25 rows by id, all or nothing |

All four live in `src/lib/agent/tools/transactionEdits.ts`. Ids come from `query_transactions`, or
from `run_sql` (`SELECT id … WHERE …`) when the user describes a set.

## The two flows

The pairs differ in where the human reviews the change:

- **Update — review at the gate.** `validate_transaction_update` → `update_transaction` →
  Approve. The agent does not stop to ask in between: the approval card shows the before → after,
  so the click is the confirmation. Asking first would mean two confirmations for one field.
- **Delete — review in the conversation, then the gate.** `validate_transaction_delete` shows
  its rows in the thread (always expanded), the agent asks, the user replies, then
  `delete_transaction` → Approve. Deletion is irreversible and can touch 25 rows, so the user gets
  a chance to adjust the set ("not that one") before anything is approved.

The pause is a convention set by the tool descriptions, not enforced. That is safe: if the agent
deletes straight after validating, the gate still holds the call, and its card shows the rows.

## Validation is mandatory, and bound to the row

As with [CSV import](CSV_IMPORT_FLOW.md), each write refuses a plan its validator has not seen
(`validation_required`), and validation is a separate tool rather than a flag because approval is
keyed by tool name. Each pair shares one schema object and one planning function, so a preview
cannot describe a write that would not happen.

Unlike a CSV file, a transaction can change between validation and approval. So validation records
each row's **version** — its raw `updated_at` — and the write is refused as `stale` if any row has
moved on since. The repository repeats the check under a row lock (`SELECT … FOR UPDATE`) in the
same database transaction as the write, so nothing can slip in between.

Versions are compared as the strings the driver returns, never round-tripped through `Date`: the
timestamp columns are naive literals, and a `Date` conversion would read them in local time.

## Update

- **One row per call**, partial: only the fields in `changes` are written, so an untouched date is
  never re-saved. `clear` empties `category`, `merchant` or `description`. It is a list rather than
  `null` values so the schema has no nullable types for a provider's schema subset to mangle.
- A new category name is **created**, in the same database transaction as the update, so a refused
  update never leaves a stray category. The validator only reports `categoryWouldBeCreated`.
- A change that changes nothing returns `no_changes`.
- The result echoes `before`, `after` and `changed`, so a correction is never reported as a new
  entry.

## Delete

- **Ids only, never a DELETE statement.** `run_sql` is safe because Postgres enforces read-only. No
  equivalent guard can limit an agent-written DELETE to the right rows of the right table. A
  predicate would also be evaluated twice, at preview and at execution, so rows added in between
  would be deleted without being shown. With ids, the card shows exactly what is deleted.
- **At most 25 ids per call.** Every row is listed on the approval card, and past roughly 25 a human
  stops reading each one. Over the cap the whole call is refused (`too_many_ids`); it never deletes
  the first N.
- **All or nothing.** An unknown id or a stale row fails the whole batch.
- **Hard delete.** A `deleted_at` column would make every agent-written `run_sql` total depend on
  remembering `WHERE deleted_at IS NULL`. The result echoes every deleted row in full, which is
  what makes a mistaken delete recoverable from the thread.
- Rows imported with a source id get a `reimportWarning`: re-importing that file brings them back,
  because duplicate detection no longer sees them.

## The approval card

An edit's own arguments are only ids, so its card shows the **validation result** that previewed
it: field-by-field now → after for an update, every row for a delete. The result was written by
the server, not the agent.

`linkPreviews` (`src/services/editPreview.ts`) finds it: the most recent earlier validation with
identical arguments, ids and `clear` compared as sets. That is the server's own matching rule, so
the card shows exactly what the write does, or the write is refused as `stale`. With no match the
card says the call is not validated and will be refused.

## Where things live

- `src/lib/agent/tools/transactionEdits.ts` — the tools, plans, fingerprints
- `src/lib/repositories/transactionRepository.ts` — `getManyByIds`, `updateIfUnchanged`,
  `removeManyIfUnchanged`
- `src/lib/finance/transactionView.ts` — the shape the tools return and the card shows
- `src/services/editPreview.ts` — matches a pending edit to its validation
- `src/components/toolRenderers/TransactionDiff.tsx`, `TransactionRows.tsx` — the views
- Tests beside the code; eval cases in `eval/cases/correction.cases.mts`

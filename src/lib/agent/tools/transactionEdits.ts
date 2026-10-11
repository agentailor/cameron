import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { createHash } from "node:crypto";
import * as transactionRepo from "@/lib/repositories/transactionRepository";
import type { TransactionPatch, TransactionSnapshot } from "@/lib/repositories/transactionTypes";
import * as categoryRepo from "@/lib/repositories/categoryRepository";
import { toTransactionView, TRANSACTION_VIEW_FIELDS } from "@/lib/finance/transactionView";
import { Account, TransactionType, type TransactionView } from "@/types/finance";

/**
 * Correcting and deleting transactions, each as a validate → write pair like CSV import:
 *
 *   validate_transaction_update -> update_transaction   (one row)
 *   validate_transaction_delete -> delete_transaction   (1..MAX_DELETE rows, all or nothing)
 *
 * The write refuses a plan that was not validated, and one whose rows changed since. See
 * docs/TRANSACTION_EDITS.md.
 */

/** Cap per delete call — every row is listed on the approval card, and must stay readable. */
export const MAX_DELETE = 25;

const accountEnum = z.enum(["CHECKING", "SAVINGS", "CREDIT", "CASH"]);
const CLEARABLE = ["category", "merchant", "description"] as const;

type Payload = Record<string, unknown>;

function fingerprint(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function notFound(ids: string[]): Payload {
  return {
    error: "not_found",
    message:
      `No transaction exists with id ${ids.map((i) => `"${i}"`).join(", ")}. Nothing was ` +
      "changed. Look the transaction up with `query_transactions` or `run_sql` and use the id " +
      "it returns — never guess or reconstruct one.",
    missingIds: ids,
  };
}

type ViewField = (typeof TRANSACTION_VIEW_FIELDS)[number];

function changedFields(before: TransactionView, after: TransactionView): ViewField[] {
  return TRANSACTION_VIEW_FIELDS.filter((f) => before[f] !== after[f]);
}

/** Rows that came from an import with a source id, which a re-import of that file would restore. */
function reimportable(rows: TransactionSnapshot[]): number {
  return rows.filter((r) => r.source !== "manual" && r.externalId !== null).length;
}

// ---------------------------------------------------------------------------------------------
// Update
// ---------------------------------------------------------------------------------------------

/** Shared verbatim by both tools, so a validated change cannot differ from the applied one. */
const updateSchema = {
  id: z
    .string()
    .min(1)
    .describe(
      "Id of the transaction to change, exactly as `query_transactions` or `run_sql` returned it",
    ),
  changes: z
    .object({
      amount: z.number().positive().optional().describe("New amount as a positive decimal"),
      type: z.enum(["expense", "income"]).optional(),
      note: z.string().min(1).optional().describe("New short label"),
      currency: z.string().min(1).optional().describe("New ISO currency code, e.g. 'EUR'"),
      account: accountEnum.optional(),
      occurredAt: z
        .string()
        .optional()
        .describe("New ISO date or date-time, e.g. '2026-08-01' or '2026-08-01T14:30:00Z'"),
      category: z
        .string()
        .min(1)
        .optional()
        .describe(
          "New category name. CREATED if no category has this exact name — call " +
            "`list_categories` and reuse an existing one rather than coining a near-duplicate.",
        ),
      merchant: z.string().min(1).optional(),
      description: z.string().min(1).optional(),
    })
    .describe("Only the fields to change. Anything omitted stays exactly as it is."),
  clear: z
    .array(z.enum(CLEARABLE))
    .optional()
    .describe(
      "Fields to empty, e.g. ['merchant'], or ['category'] to make it uncategorized. A field " +
        "cannot be both cleared and changed.",
    ),
};

type UpdateInput = {
  id: string;
  changes: {
    amount?: number;
    type?: string;
    note?: string;
    currency?: string;
    account?: string;
    occurredAt?: string;
    category?: string;
    merchant?: string;
    description?: string;
  };
  clear?: (typeof CLEARABLE)[number][];
};

interface UpdatePlan {
  row: TransactionSnapshot;
  patch: TransactionPatch;
  before: TransactionView;
  after: TransactionView;
  changed: ViewField[];
  newCategory: string | null;
}

/**
 * Resolve a requested change against the row as it is now, writing nothing. ONE code path for
 * both tools, so validation cannot predict a change the write would not make.
 */
async function planUpdate(input: UpdateInput): Promise<{ error: Payload } | { plan: UpdatePlan }> {
  const { changes } = input;
  const clear = input.clear ?? [];

  const both = clear.filter((f) => changes[f] !== undefined);
  if (both.length > 0) {
    return {
      error: {
        error: "conflicting_changes",
        message:
          `${both.join(", ")} is both changed and cleared. Pass each field in \`changes\` or in ` +
          "`clear`, not both. Nothing was changed.",
      },
    };
  }

  let occurredAt: string | undefined;
  if (changes.occurredAt !== undefined) {
    const d = new Date(changes.occurredAt);
    if (Number.isNaN(d.getTime())) {
      return {
        error: {
          error: "invalid_occurred_at",
          message:
            `"${changes.occurredAt}" is not a date. Pass an ISO date such as '2026-08-01' or ` +
            "'2026-08-01T14:30:00Z'. Nothing was changed.",
        },
      };
    }
    occurredAt = d.toISOString();
  }

  const [row] = await transactionRepo.getManyByIds([input.id]);
  if (!row) return { error: notFound([input.id]) };

  const before = toTransactionView(row);
  const after: TransactionView = { ...before };
  if (changes.amount !== undefined) after.amount = Math.round(changes.amount * 100) / 100;
  if (changes.type !== undefined) after.type = changes.type;
  if (changes.note !== undefined) after.note = changes.note;
  if (changes.currency !== undefined) after.currency = changes.currency;
  if (changes.account !== undefined) after.account = changes.account;
  if (occurredAt !== undefined) after.occurredAt = occurredAt;
  if (changes.category !== undefined) after.category = changes.category.trim();
  if (changes.merchant !== undefined) after.merchant = changes.merchant;
  if (changes.description !== undefined) after.description = changes.description;
  for (const f of clear) after[f] = null;

  const changed = changedFields(before, after);
  if (changed.length === 0) {
    return {
      error: {
        error: "no_changes",
        message:
          "Every value you passed already matches the transaction, so there is nothing to " +
          "change. Nothing was written.",
        transaction: before,
      },
    };
  }

  // Only changed fields are written, so an untouched date is never re-saved.
  const patch: TransactionPatch = {};
  for (const f of changed) {
    switch (f) {
      case "occurredAt":
        patch.occurredAt = after.occurredAt;
        break;
      case "type":
        patch.type = after.type as TransactionType;
        break;
      case "account":
        patch.account = after.account as Account;
        break;
      case "category":
        patch.categoryName = after.category;
        break;
      default:
        patch[f] = after[f] as never;
    }
  }

  let newCategory: string | null = null;
  if (changed.includes("category") && after.category !== null) {
    const existing = await categoryRepo.getByName(after.category);
    if (!existing) newCategory = after.category;
  }

  return { plan: { row, patch, before, after, changed, newCategory } };
}

function updateFingerprint(input: UpdateInput): string {
  return fingerprint({
    id: input.id,
    // Zod rebuilds parsed objects in schema key order, so `changes` arrives already normalized.
    changes: input.changes,
    clear: [...new Set(input.clear ?? [])].sort(),
  });
}

/**
 * Validated update plans → the row version they were validated against. In-memory on purpose,
 * as for CSV import: forgetting costs a redundant validation, persisting risks honouring a stale one.
 */
const validatedUpdates = new Map<string, string>();

export const validateTransactionUpdateTool = tool(
  async (input) => {
    const result = await planUpdate(input as UpdateInput);
    if ("error" in result) return JSON.stringify(result.error);

    const { plan } = result;
    validatedUpdates.set(updateFingerprint(input as UpdateInput), plan.row.version);
    return JSON.stringify({
      ok: true,
      validated: true,
      id: plan.row.id,
      before: plan.before,
      after: plan.after,
      changed: plan.changed,
      ...(plan.newCategory ? { categoryWouldBeCreated: plan.newCategory } : {}),
      hint:
        "Nothing has been written. Call `update_transaction` with these same arguments; its " +
        "approval card shows the user this before → after.",
    });
  },
  {
    name: "validate_transaction_update",
    description:
      "Preview a change to ONE existing transaction without writing anything: returns the row as " +
      "it is now (`before`), as it would be (`after`), and which fields `changed`. You MUST call " +
      "this before `update_transaction`, with the same arguments — an unvalidated change is " +
      "refused. Get the id from `query_transactions` or `run_sql` first; never guess one. " +
      "Read-only; needs no approval.",
    schema: z.object(updateSchema),
  },
);

export const updateTransactionTool = tool(
  async (input) => {
    const args = input as UpdateInput;

    // Plan FIRST, so a bad id or a no-op gets its specific error before the validation gate.
    const result = await planUpdate(args);
    if ("error" in result) return JSON.stringify(result.error);
    const { plan } = result;

    const key = updateFingerprint(args);
    const version = validatedUpdates.get(key);
    if (version === undefined) {
      return JSON.stringify({
        error: "validation_required",
        message:
          "This exact change has not been validated. Call `validate_transaction_update` with " +
          "these same arguments first, show the user the before → after, then update. Nothing " +
          "was written.",
      });
    }

    const stale = {
      error: "stale",
      message:
        "The transaction changed after you validated this update, so the preview no longer " +
        "describes what would happen. Call `validate_transaction_update` again. Nothing was written.",
    };
    if (version !== plan.row.version) {
      validatedUpdates.delete(key);
      return JSON.stringify(stale);
    }

    const written = await transactionRepo.updateIfUnchanged(plan.row.id, version, plan.patch);
    validatedUpdates.delete(key);
    if (written.status === "not_found") return JSON.stringify(notFound([plan.row.id]));
    if (written.status === "stale") return JSON.stringify(stale);

    const before = toTransactionView(written.before);
    const after = toTransactionView(written.after);
    return JSON.stringify({
      ok: true,
      updated: true,
      id: after.id,
      before,
      after,
      changed: changedFields(before, after),
      ...(written.categoryCreated ? { categoryCreated: written.categoryCreated } : {}),
    });
  },
  {
    name: "update_transaction",
    description:
      "Correct ONE existing transaction in place: a wrong amount, currency, date, type, note, " +
      "account, category, merchant or description. Use this whenever the user says a transaction " +
      "already in the ledger is wrong — including one you just logged. Do NOT log it again with " +
      "`log_expense`: that leaves the wrong row in place and double-counts it. Only the fields " +
      "you pass change. You MUST call `validate_transaction_update` with these exact arguments " +
      "first; there is no need to ask the user in between, because the approval card shows them " +
      "the before → after. If the transaction changed since validating, this returns `stale` and " +
      "you must validate again. This mutates financial records and will " +
      "require the user's approval. One transaction per call.",
    schema: z.object(updateSchema),
  },
);

// ---------------------------------------------------------------------------------------------
// Delete
// ---------------------------------------------------------------------------------------------

/** Shared verbatim by both tools. A plain array — the cap is checked in code, so exceeding it
 *  returns a correctable payload rather than a schema error. */
const deleteSchema = {
  ids: z
    .array(z.string().min(1))
    .describe(
      `Ids of the transactions to delete (1 to ${MAX_DELETE}), exactly as ` +
        "`query_transactions` or `run_sql` returned them",
    ),
};

type DeleteInput = { ids: string[] };

async function planDelete(
  input: DeleteInput,
): Promise<{ error: Payload } | { rows: TransactionSnapshot[] }> {
  const ids = [...new Set(input.ids)];
  if (ids.length === 0) {
    return { error: { error: "no_ids", message: "Pass at least one id. Nothing was deleted." } };
  }
  if (ids.length > MAX_DELETE) {
    return {
      error: {
        error: "too_many_ids",
        message:
          `${ids.length} ids were passed; at most ${MAX_DELETE} can be deleted per call, so the ` +
          `user can read every row they approve. Nothing was deleted. Split them into batches of ` +
          `at most ${MAX_DELETE} and validate each batch.`,
        requested: ids.length,
        max: MAX_DELETE,
      },
    };
  }

  const found = new Map((await transactionRepo.getManyByIds(ids)).map((r) => [r.id, r]));
  const missing = ids.filter((id) => !found.has(id));
  if (missing.length > 0) return { error: notFound(missing) };
  return { rows: ids.map((id) => found.get(id)!) };
}

function deleteFingerprint(input: DeleteInput): string {
  return fingerprint([...new Set(input.ids)].sort());
}

function reimportWarning(rows: TransactionSnapshot[]): Payload {
  const n = reimportable(rows);
  return n > 0
    ? {
        reimportWarning:
          `${n} of these came from an import with a source id. Re-importing that file would ` +
          "bring them back, because duplicate detection no longer sees them.",
      }
    : {};
}

/** Validated delete plans → the version of every row at validation time. */
const validatedDeletes = new Map<string, { id: string; version: string }[]>();

export const validateTransactionDeleteTool = tool(
  async (input) => {
    const result = await planDelete(input as DeleteInput);
    if ("error" in result) return JSON.stringify(result.error);

    const { rows } = result;
    validatedDeletes.set(
      deleteFingerprint(input as DeleteInput),
      rows.map((r) => ({ id: r.id, version: r.version })),
    );
    return JSON.stringify({
      ok: true,
      validated: true,
      count: rows.length,
      transactions: rows.map(toTransactionView),
      ...reimportWarning(rows),
      hint:
        "Nothing has been deleted. These rows are shown to the user. Ask them to confirm, and " +
        "wait for their reply before calling `delete_transaction` with these same ids. If they " +
        "want a different set, validate that set instead.",
    });
  },
  {
    name: "validate_transaction_delete",
    description:
      `Preview deleting up to ${MAX_DELETE} transactions by id, without deleting anything: ` +
      "returns each row exactly as it is now, and the user sees them. You MUST call this before " +
      "`delete_transaction`, with the same ids, then ask the user to confirm these are the rows " +
      "they mean and wait for their reply. Find ids with " +
      "`query_transactions`, or with `run_sql` (SELECT id … WHERE …) when the user describes a " +
      "set; never guess one. Read-only; needs no approval.",
    schema: z.object(deleteSchema),
  },
);

export const deleteTransactionTool = tool(
  async (input) => {
    const plan = input as DeleteInput;

    const result = await planDelete(plan);
    if ("error" in result) return JSON.stringify(result.error);

    const key = deleteFingerprint(plan);
    const versions = validatedDeletes.get(key);
    if (versions === undefined) {
      return JSON.stringify({
        error: "validation_required",
        message:
          "These ids have not been validated for deletion. Call `validate_transaction_delete` " +
          "with these same ids first, confirm the rows with the user, then delete. Nothing was " +
          "deleted.",
      });
    }

    const staleError = (ids: string[]) => ({
      error: "stale",
      message:
        "Some of these transactions changed after you validated the deletion, so the preview no " +
        "longer shows what would be deleted. Call `validate_transaction_delete` again. Nothing " +
        "was deleted.",
      staleIds: ids,
    });
    const current = new Map(result.rows.map((r) => [r.id, r.version]));
    const changed = versions.filter((v) => current.get(v.id) !== v.version).map((v) => v.id);
    if (changed.length > 0) {
      validatedDeletes.delete(key);
      return JSON.stringify(staleError(changed));
    }

    const deleted = await transactionRepo.removeManyIfUnchanged(versions);
    validatedDeletes.delete(key);
    if (deleted.status === "not_found") return JSON.stringify(notFound(deleted.ids));
    if (deleted.status === "stale") return JSON.stringify(staleError(deleted.ids));

    return JSON.stringify({
      ok: true,
      deleted: deleted.rows.length,
      // Echoed in full: with no undo, this is what lets a mistaken delete be logged again.
      transactions: deleted.rows.map(toTransactionView),
      ...reimportWarning(deleted.rows),
    });
  },
  {
    name: "delete_transaction",
    description:
      `Permanently delete 1 to ${MAX_DELETE} transactions by id, all or nothing: if any id is ` +
      "missing or changed since validation, nothing is deleted. Use this for transactions that " +
      "should not exist at all — a duplicate, an entry made by mistake. To fix a wrong value, " +
      "use `update_transaction` instead. You MUST call `validate_transaction_delete` with these " +
      "exact ids first, and call this only after the user has confirmed the rows it showed. There is no undo; the deleted " +
      `rows are returned. For more than ${MAX_DELETE}, delete in batches, validating each. This ` +
      "mutates financial records and will require the user's approval.",
    schema: z.object(deleteSchema),
  },
);

/** Edit tools, registered into the agent in agent/index.ts. */
export const transactionEditTools = [
  validateTransactionUpdateTool,
  updateTransactionTool,
  validateTransactionDeleteTool,
  deleteTransactionTool,
];

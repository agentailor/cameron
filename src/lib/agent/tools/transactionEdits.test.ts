import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TransactionSnapshot } from "@/lib/repositories/transactionTypes";
import { callTool, makeCategory, makeTransaction } from "./testing";

/** Contract tests for the edit tools — repositories stubbed. See docs/TRANSACTION_EDITS.md. */

vi.mock("@/lib/repositories/transactionRepository", () => ({
  getManyByIds: vi.fn(),
  updateIfUnchanged: vi.fn(),
  removeManyIfUnchanged: vi.fn(),
}));
vi.mock("@/lib/repositories/categoryRepository", () => ({
  getByName: vi.fn(),
}));

const transactionRepo = await import("@/lib/repositories/transactionRepository");
const categoryRepo = await import("@/lib/repositories/categoryRepository");
const {
  validateTransactionUpdateTool,
  updateTransactionTool,
  validateTransactionDeleteTool,
  deleteTransactionTool,
  MAX_DELETE,
} = await import("./transactionEdits");

function snapshot(overrides: Partial<TransactionSnapshot> = {}): TransactionSnapshot {
  return {
    ...makeTransaction({ id: "t1", amountMinor: 420, currency: "USD", note: "Coffee" }),
    categoryName: "Dining",
    version: "2026-07-05 00:00:00",
    ...overrides,
  };
}

/** Every getManyByIds call answers from this table, so a test can change a row between calls. */
function store(...rows: TransactionSnapshot[]) {
  const byId = new Map(rows.map((r) => [r.id, r]));
  vi.mocked(transactionRepo.getManyByIds).mockImplementation(async (ids) =>
    ids.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : [])),
  );
  return byId;
}

// The validated-plan store is module state; distinct ids per test keep tests independent.
let seq = 0;
const nextId = () => `t-${++seq}`;

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(categoryRepo.getByName).mockResolvedValue(makeCategory({ name: "Dining" }));
});

describe("validate_transaction_update", () => {
  it("previews before → after and the changed fields, writing nothing", async () => {
    const id = nextId();
    store(snapshot({ id }));

    const result = await callTool(validateTransactionUpdateTool, {
      id,
      changes: { currency: "EUR" },
    });

    expect(result).toMatchObject({ ok: true, validated: true, changed: ["currency"] });
    expect(result.before).toMatchObject({ amount: 4.2, currency: "USD", category: "Dining" });
    expect(result.after).toMatchObject({ amount: 4.2, currency: "EUR", category: "Dining" });
    expect(transactionRepo.updateIfUnchanged).not.toHaveBeenCalled();
  });

  it("returns not_found for an unknown id, pointing at the lookup tools", async () => {
    store();
    const result = await callTool(validateTransactionUpdateTool, {
      id: "made-up",
      changes: { amount: 5 },
    });
    expect(result.error).toBe("not_found");
    expect(result.missingIds).toEqual(["made-up"]);
    expect(result.message).toMatch(/query_transactions/);
  });

  it("refuses a change that changes nothing", async () => {
    const id = nextId();
    store(snapshot({ id }));
    const result = await callTool(validateTransactionUpdateTool, {
      id,
      changes: { amount: 4.2, currency: "USD" },
    });
    expect(result.error).toBe("no_changes");
  });

  it("reports a category it would create, without creating it", async () => {
    const id = nextId();
    store(snapshot({ id }));
    vi.mocked(categoryRepo.getByName).mockResolvedValue(null);

    const result = await callTool(validateTransactionUpdateTool, {
      id,
      changes: { category: "Coffee shops" },
    });

    expect(result.categoryWouldBeCreated).toBe("Coffee shops");
    expect(transactionRepo.updateIfUnchanged).not.toHaveBeenCalled();
  });

  it("clears a field listed in `clear`", async () => {
    const id = nextId();
    store(snapshot({ id, merchant: "Corner cafe" }));
    const result = await callTool(validateTransactionUpdateTool, {
      id,
      changes: {},
      clear: ["merchant", "category"],
    });
    expect(result.after).toMatchObject({ merchant: null, category: null });
    expect(result.changed).toEqual(["category", "merchant"]);
  });

  it("refuses a field that is both changed and cleared", async () => {
    const id = nextId();
    store(snapshot({ id }));
    const result = await callTool(validateTransactionUpdateTool, {
      id,
      changes: { merchant: "X" },
      clear: ["merchant"],
    });
    expect(result.error).toBe("conflicting_changes");
  });

  it("refuses an unparseable date", async () => {
    const id = nextId();
    store(snapshot({ id }));
    const result = await callTool(validateTransactionUpdateTool, {
      id,
      changes: { occurredAt: "last tuesday" },
    });
    expect(result.error).toBe("invalid_occurred_at");
  });
});

describe("update_transaction", () => {
  function written(before: TransactionSnapshot, after: Partial<TransactionSnapshot>) {
    vi.mocked(transactionRepo.updateIfUnchanged).mockResolvedValue({
      status: "updated",
      before,
      after: { ...before, ...after, version: "2026-07-06 00:00:00" },
      categoryCreated: null,
    });
  }

  it("refuses a change that was never validated", async () => {
    const id = nextId();
    store(snapshot({ id }));
    const result = await callTool(updateTransactionTool, { id, changes: { currency: "EUR" } });
    expect(result.error).toBe("validation_required");
    expect(transactionRepo.updateIfUnchanged).not.toHaveBeenCalled();
  });

  it("refuses when the arguments differ from the validated ones", async () => {
    const id = nextId();
    store(snapshot({ id }));
    await callTool(validateTransactionUpdateTool, { id, changes: { currency: "EUR" } });

    const result = await callTool(updateTransactionTool, { id, changes: { currency: "GBP" } });

    expect(result.error).toBe("validation_required");
    expect(transactionRepo.updateIfUnchanged).not.toHaveBeenCalled();
  });

  it("applies a validated change, writing only the changed fields", async () => {
    const id = nextId();
    const row = snapshot({ id });
    store(row);
    written(row, { currency: "EUR" });

    await callTool(validateTransactionUpdateTool, { id, changes: { currency: "EUR" } });
    const result = await callTool(updateTransactionTool, { id, changes: { currency: "EUR" } });

    expect(transactionRepo.updateIfUnchanged).toHaveBeenCalledWith(id, row.version, {
      currency: "EUR",
    });
    expect(result).toMatchObject({ ok: true, updated: true, changed: ["currency"] });
    expect(result.before.currency).toBe("USD");
    expect(result.after.currency).toBe("EUR");
  });

  it("converts an amount to minor units", async () => {
    const id = nextId();
    const row = snapshot({ id });
    store(row);
    written(row, { amountMinor: 2500 });

    await callTool(validateTransactionUpdateTool, { id, changes: { amount: 25 } });
    await callTool(updateTransactionTool, { id, changes: { amount: 25 } });

    expect(transactionRepo.updateIfUnchanged).toHaveBeenCalledWith(id, row.version, {
      amountMinor: 2500,
    });
  });

  it("returns stale when the row changed after validation", async () => {
    const id = nextId();
    const rows = store(snapshot({ id }));
    await callTool(validateTransactionUpdateTool, { id, changes: { currency: "EUR" } });

    rows.set(id, snapshot({ id, note: "Edited elsewhere", version: "2026-07-06 00:00:00" }));
    const result = await callTool(updateTransactionTool, { id, changes: { currency: "EUR" } });

    expect(result.error).toBe("stale");
    expect(transactionRepo.updateIfUnchanged).not.toHaveBeenCalled();
  });

  it("returns stale when the row changes between the check and the write", async () => {
    const id = nextId();
    store(snapshot({ id }));
    vi.mocked(transactionRepo.updateIfUnchanged).mockResolvedValue({ status: "stale" });

    await callTool(validateTransactionUpdateTool, { id, changes: { currency: "EUR" } });
    const result = await callTool(updateTransactionTool, { id, changes: { currency: "EUR" } });

    expect(result.error).toBe("stale");
  });

  it("reports a category the update created", async () => {
    const id = nextId();
    const row = snapshot({ id });
    store(row);
    vi.mocked(categoryRepo.getByName).mockResolvedValue(null);
    vi.mocked(transactionRepo.updateIfUnchanged).mockResolvedValue({
      status: "updated",
      before: row,
      after: { ...row, categoryName: "Coffee shops" },
      categoryCreated: "Coffee shops",
    });

    await callTool(validateTransactionUpdateTool, { id, changes: { category: "Coffee shops" } });
    const result = await callTool(updateTransactionTool, {
      id,
      changes: { category: "Coffee shops" },
    });

    expect(result.categoryCreated).toBe("Coffee shops");
  });

  it("needs validating again after a successful update", async () => {
    const id = nextId();
    const row = snapshot({ id });
    store(row);
    written(row, { currency: "EUR" });

    await callTool(validateTransactionUpdateTool, { id, changes: { currency: "EUR" } });
    await callTool(updateTransactionTool, { id, changes: { currency: "EUR" } });
    const again = await callTool(updateTransactionTool, { id, changes: { currency: "EUR" } });

    expect(again.error).toBe("validation_required");
  });
});

describe("validate_transaction_delete", () => {
  it("returns every row it would delete, deleting nothing", async () => {
    const a = nextId();
    const b = nextId();
    store(snapshot({ id: a, note: "A" }), snapshot({ id: b, note: "B" }));

    const result = await callTool(validateTransactionDeleteTool, { ids: [a, b, a] });

    expect(result).toMatchObject({ ok: true, validated: true, count: 2 });
    expect(result.transactions.map((t: { note: string }) => t.note)).toEqual(["A", "B"]);
    expect(transactionRepo.removeManyIfUnchanged).not.toHaveBeenCalled();
  });

  it(`refuses more than ${MAX_DELETE} ids outright rather than deleting some`, async () => {
    const ids = Array.from({ length: MAX_DELETE + 1 }, nextId);
    store(...ids.map((id) => snapshot({ id })));

    const result = await callTool(validateTransactionDeleteTool, { ids });

    expect(result).toMatchObject({ error: "too_many_ids", requested: MAX_DELETE + 1 });
    expect(transactionRepo.getManyByIds).not.toHaveBeenCalled();
  });

  it("fails the whole batch when any id is unknown", async () => {
    const a = nextId();
    store(snapshot({ id: a }));
    const result = await callTool(validateTransactionDeleteTool, { ids: [a, "made-up"] });
    expect(result.error).toBe("not_found");
    expect(result.missingIds).toEqual(["made-up"]);
  });

  it("refuses an empty list", async () => {
    const result = await callTool(validateTransactionDeleteTool, { ids: [] });
    expect(result.error).toBe("no_ids");
  });

  it("warns when a re-import would bring imported rows back", async () => {
    const a = nextId();
    const b = nextId();
    store(snapshot({ id: a, source: "csv", externalId: "bank-1" }), snapshot({ id: b }));
    const result = await callTool(validateTransactionDeleteTool, { ids: [a, b] });
    expect(result.reimportWarning).toMatch(/^1 of these/);
  });

  it("does not warn for manually logged rows", async () => {
    const a = nextId();
    store(snapshot({ id: a }));
    const result = await callTool(validateTransactionDeleteTool, { ids: [a] });
    expect(result.reimportWarning).toBeUndefined();
  });
});

describe("delete_transaction", () => {
  it("refuses ids that were never validated", async () => {
    const a = nextId();
    store(snapshot({ id: a }));
    const result = await callTool(deleteTransactionTool, { ids: [a] });
    expect(result.error).toBe("validation_required");
    expect(transactionRepo.removeManyIfUnchanged).not.toHaveBeenCalled();
  });

  it("refuses a different set of ids than the validated one", async () => {
    const a = nextId();
    const b = nextId();
    store(snapshot({ id: a }), snapshot({ id: b }));
    await callTool(validateTransactionDeleteTool, { ids: [a] });

    const result = await callTool(deleteTransactionTool, { ids: [a, b] });

    expect(result.error).toBe("validation_required");
  });

  it("deletes a validated set in any order and echoes the deleted rows", async () => {
    const a = nextId();
    const b = nextId();
    const rowA = snapshot({ id: a, note: "A" });
    const rowB = snapshot({ id: b, note: "B" });
    store(rowA, rowB);
    vi.mocked(transactionRepo.removeManyIfUnchanged).mockResolvedValue({
      status: "deleted",
      rows: [rowA, rowB],
    });

    await callTool(validateTransactionDeleteTool, { ids: [a, b] });
    const result = await callTool(deleteTransactionTool, { ids: [b, a] });

    expect(transactionRepo.removeManyIfUnchanged).toHaveBeenCalledWith([
      { id: a, version: rowA.version },
      { id: b, version: rowB.version },
    ]);
    expect(result).toMatchObject({ ok: true, deleted: 2 });
    expect(result.transactions).toHaveLength(2);
  });

  it("returns stale, deleting nothing, when a row changed after validation", async () => {
    const a = nextId();
    const rows = store(snapshot({ id: a }));
    await callTool(validateTransactionDeleteTool, { ids: [a] });

    rows.set(a, snapshot({ id: a, version: "2026-07-06 00:00:00" }));
    const result = await callTool(deleteTransactionTool, { ids: [a] });

    expect(result).toMatchObject({ error: "stale", staleIds: [a] });
    expect(transactionRepo.removeManyIfUnchanged).not.toHaveBeenCalled();
  });

  it("returns not_found when a validated row disappeared", async () => {
    const a = nextId();
    const rows = store(snapshot({ id: a }));
    await callTool(validateTransactionDeleteTool, { ids: [a] });

    rows.delete(a);
    const result = await callTool(deleteTransactionTool, { ids: [a] });

    expect(result.error).toBe("not_found");
    expect(transactionRepo.removeManyIfUnchanged).not.toHaveBeenCalled();
  });
});

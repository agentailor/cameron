import { describe, expect, it } from "vitest";
import { linkPreviews, VALIDATOR_FOR } from "./editPreview";
import { buildThreadItems, type ToolActivity, type ToolActivityGroup } from "./toolActivity";
import { listCapabilities, MUTATING_TOOL_NAMES } from "@/lib/agent/capabilities";
import type { MessageResponse, ToolCall } from "@/types/message";

/**
 * The approval card for an edit shows the validation matched here, so a wrong match shows the
 * human one plan while they approve another. The rule must be the server's: identical arguments.
 */

type Activity = Pick<ToolActivity, "name" | "args" | "result" | "preview">;

function activity(name: string, args: Record<string, unknown>, content?: object): Activity {
  return {
    name,
    args,
    result: content
      ? ({ type: "tool", data: { content: JSON.stringify(content) } } as ToolActivity["result"])
      : null,
  };
}

const validated = (extra: object = {}) => ({ ok: true, validated: true, ...extra });

describe("linkPreviews", () => {
  it("gives a delete the validation of the same ids, in any order", () => {
    const v = activity("validate_transaction_delete", { ids: ["a", "b"] }, validated({ count: 2 }));
    const d = activity("delete_transaction", { ids: ["b", "a", "a"] });
    linkPreviews([v, d]);
    expect(d.preview).toMatchObject({ count: 2 });
  });

  it("gives an update the validation of the same plan, whatever the key order", () => {
    const v = activity(
      "validate_transaction_update",
      { id: "t1", changes: { currency: "EUR", amount: 4.2 } },
      validated({ changed: ["currency"] }),
    );
    const u = activity("update_transaction", {
      changes: { amount: 4.2, currency: "EUR" },
      id: "t1",
    });
    linkPreviews([v, u]);
    expect(u.preview).toMatchObject({ changed: ["currency"] });
  });

  it("does not match a different plan", () => {
    const v = activity("validate_transaction_delete", { ids: ["a"] }, validated());
    const d = activity("delete_transaction", { ids: ["a", "b"] });
    linkPreviews([v, d]);
    expect(d.preview).toBeNull();
  });

  it("ignores a validation that failed", () => {
    const v = activity("validate_transaction_delete", { ids: ["a"] }, { error: "not_found" });
    const d = activity("delete_transaction", { ids: ["a"] });
    linkPreviews([v, d]);
    expect(d.preview).toBeNull();
  });

  it("ignores a validation that came after the edit", () => {
    const d = activity("delete_transaction", { ids: ["a"] });
    const v = activity("validate_transaction_delete", { ids: ["a"] }, validated());
    linkPreviews([d, v]);
    expect(d.preview).toBeNull();
  });

  it("uses the most recent validation of a plan", () => {
    const first = activity("validate_transaction_delete", { ids: ["a"] }, validated({ n: 1 }));
    const second = activity("validate_transaction_delete", { ids: ["a"] }, validated({ n: 2 }));
    const d = activity("delete_transaction", { ids: ["a"] });
    linkPreviews([first, second, d]);
    expect(d.preview).toMatchObject({ n: 2 });
  });

  it("does not reuse a validation an earlier write already consumed", () => {
    const v = activity(
      "validate_transaction_update",
      { id: "t1", changes: { amount: 5 } },
      validated(),
    );
    const ran = activity("update_transaction", { id: "t1", changes: { amount: 5 } }, { ok: true });
    const again = activity("update_transaction", { id: "t1", changes: { amount: 5 } });
    linkPreviews([v, ran, again]);
    expect(ran.preview).not.toBeNull();
    expect(again.preview).toBeNull();
  });

  it("leaves other tools untouched", () => {
    const other = activity("log_expense", { amount: 1 });
    linkPreviews([other]);
    expect(other.preview).toBeUndefined();
  });
});

describe("buildThreadItems", () => {
  const call = (name: string, id: string, args: Record<string, unknown>): ToolCall => ({
    name,
    args,
    id,
    type: "tool_call",
  });

  it("links an edit to a validation in an EARLIER card", () => {
    const messages: MessageResponse[] = [
      {
        type: "ai",
        data: {
          id: "a1",
          content: "",
          tool_calls: [call("validate_transaction_delete", "c1", { ids: ["x"] })],
        },
      },
      {
        type: "tool",
        data: {
          id: "c1",
          content: JSON.stringify(validated({ count: 1 })),
          status: "success",
          tool_call_id: "c1",
          name: "validate_transaction_delete",
        },
      },
      { type: "ai", data: { id: "a2", content: "Delete these?" } },
      { type: "human", data: { id: "h1", content: "yes" } },
      {
        type: "ai",
        data: {
          id: "a3",
          content: "",
          tool_calls: [call("delete_transaction", "c2", { ids: ["x"] })],
          pendingToolCallIds: ["c2"],
        },
      },
    ];
    const groups = buildThreadItems(messages).filter(
      (i): i is ToolActivityGroup => i.kind === "tools",
    );
    const del = groups.flatMap((g) => g.activities).find((a) => a.name === "delete_transaction")!;
    expect(del.isPending).toBe(true);
    expect(del.preview).toMatchObject({ count: 1 });
  });
});

describe("VALIDATOR_FOR", () => {
  // The client names these tools as strings; a rename on the server must fail here.
  it("pairs real gated tools with real read-only validators", () => {
    const caps = new Map(listCapabilities().map((c) => [c.name, c]));
    for (const [edit, validator] of Object.entries(VALIDATOR_FOR)) {
      expect(MUTATING_TOOL_NAMES, edit).toContain(edit);
      expect(caps.get(validator)?.mutating, validator).toBe(false);
    }
  });
});

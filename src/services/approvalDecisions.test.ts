import { describe, expect, it } from "vitest";
import {
  DENIED_MESSAGE,
  HELD_BACK_MESSAGE,
  resolveDecisions,
  type PausedCall,
} from "./approvalDecisions";

/**
 * The id -> position mapping for a paused approval batch (#45). The middleware aligns decisions
 * by position and its action requests carry no call id, so a wrong mapping approves a call the
 * user never clicked. Every refusal path is covered: a refusal is the only safe answer to doubt.
 */

const coffee: PausedCall = { id: "call_a", name: "log_expense", args: { amount: 12.5 } };
const dinner: PausedCall = { id: "call_b", name: "log_expense", args: { amount: 40 } };
const remove: PausedCall = { id: "call_c", name: "delete_transaction", args: { ids: ["t1"] } };

const requestsFor = (calls: PausedCall[]) => calls.map(({ name, args }) => ({ name, args }));

const resolve = (calls: PausedCall[], decisions: Record<string, "allow" | "deny">) =>
  resolveDecisions({ actionRequests: requestsFor(calls), pausedCalls: calls, decisions });

describe("resolveDecisions", () => {
  it("approves a batch of one", () => {
    expect(resolve([coffee], { call_a: "allow" })).toEqual({
      ok: true,
      decisions: [{ type: "approve" }],
    });
  });

  it("denies a batch of one", () => {
    expect(resolve([coffee], { call_a: "deny" })).toEqual({
      ok: true,
      decisions: [{ type: "reject", message: DENIED_MESSAGE }],
    });
  });

  it("orders decisions by the paused calls, not by the order they were sent", () => {
    const result = resolve([coffee, dinner, remove], {
      call_c: "allow",
      call_a: "allow",
      call_b: "allow",
    });
    expect(result).toEqual({
      ok: true,
      decisions: [{ type: "approve" }, { type: "approve" }, { type: "approve" }],
    });
  });

  it("approving one call never approves its siblings", () => {
    // The original bug: one Approve click became an approval for the whole batch.
    const result = resolve([coffee, remove], { call_a: "allow", call_c: "deny" });
    if (!result.ok) throw new Error(result.error);
    expect(result.decisions[1]).toEqual({ type: "reject", message: DENIED_MESSAGE });
    expect(result.decisions.some((d) => d.type === "approve")).toBe(false);
  });

  it("an approved call beside a denial is held back with its own message, not silently dropped", () => {
    // The middleware drops approved siblings once anything is rejected; this makes that visible.
    const result = resolve([coffee, dinner], { call_a: "allow", call_b: "deny" });
    expect(result).toEqual({
      ok: true,
      decisions: [
        { type: "reject", message: HELD_BACK_MESSAGE },
        { type: "reject", message: DENIED_MESSAGE },
      ],
    });
  });

  it("refuses when a pending call has no decision", () => {
    const result = resolve([coffee, dinner], { call_a: "allow" });
    expect(result).toEqual({ ok: false, error: expect.stringContaining("call_b") });
  });

  it("refuses a decision for a call that is not pending", () => {
    const result = resolve([coffee], { call_a: "allow", call_zzz: "allow" });
    expect(result).toEqual({ ok: false, error: expect.stringContaining("call_zzz") });
  });

  it("refuses an empty decision set rather than defaulting", () => {
    expect(resolve([coffee], {}).ok).toBe(false);
  });

  it("refuses a value other than allow or deny", () => {
    const result = resolveDecisions({
      actionRequests: requestsFor([coffee]),
      pausedCalls: [coffee],
      decisions: { call_a: "approve" as never },
    });
    expect(result.ok).toBe(false);
  });

  it("refuses when nothing is awaiting approval", () => {
    const result = resolveDecisions({
      actionRequests: [],
      pausedCalls: [],
      decisions: { call_a: "allow" },
    });
    expect(result.ok).toBe(false);
  });

  it("refuses when the action requests do not line up with the paused calls", () => {
    // Same names, swapped args: a positional mapping would approve the wrong amount.
    const swapped = resolveDecisions({
      actionRequests: requestsFor([dinner, coffee]),
      pausedCalls: [coffee, dinner],
      decisions: { call_a: "allow", call_b: "deny" },
    });
    expect(swapped.ok).toBe(false);

    const short = resolveDecisions({
      actionRequests: requestsFor([coffee]),
      pausedCalls: [coffee, remove],
      decisions: { call_a: "allow", call_c: "allow" },
    });
    expect(short.ok).toBe(false);
  });
});

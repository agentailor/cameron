import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

/**
 * The approval gate is Cameron's first design rule: nothing mutating runs without an explicit
 * human decision. A request must therefore never be able to switch it off.
 *
 * The bypass exists for ONE caller — the eval harness, which drives the agent factory in-process
 * and has no human to answer an interrupt. These tests pin the boundary between that and
 * everything reachable over HTTP, because the failure is silent: a bypass wired back into the
 * route would still typecheck, still stream, and quietly write to a real ledger.
 *
 * Source-level assertions, in the same spirit as capabilities.test.ts — what needs pinning is
 * that a future edit doesn't reintroduce the path, which no runtime assertion observes.
 */

const read = (path: string) => readFile(new URL(path, import.meta.url), "utf-8");

/** The eval-only flag. Named so no one mistakes it for a product setting. */
const BYPASS = "bypassApprovalForEval";

describe("the approval gate is not reachable from a request", () => {
  it("the stream route never reads an approval-bypass param", async () => {
    const route = await read("../../app/api/agent/stream/route.ts");
    expect(route).not.toContain("approveAllTools");
    expect(route).not.toContain(BYPASS);
  });

  it("the stream's public schema does not advertise one", async () => {
    // The OpenAPI doc is a contract; a documented bypass invites a client to send it.
    const schema = await read("../../app/api/agent/stream/schema.ts");
    expect(schema).not.toContain("approveAllTools");
    expect(schema).not.toContain(BYPASS);
  });

  it("the client never puts one on the wire", async () => {
    const chat = await read("../../services/chatService.ts");
    expect(chat).not.toContain("approveAllTools");
    expect(chat).not.toContain(BYPASS);
  });

  it("MessageOptions — the request-shaped type — cannot carry one", async () => {
    const types = await read("../../types/message.ts");
    expect(types).not.toContain("approveAllTools");
    expect(types).not.toContain(BYPASS);
  });

  it("agentService builds the agent without a bypass", async () => {
    // This is the seam where a request reaches the agent factory; it must not forward one.
    const service = await read("../../services/agentService.ts");
    expect(service).not.toMatch(new RegExp(`${BYPASS}\\s*:`));
    expect(service).not.toContain("approveAllTools");
  });

  it("no UI surface offers a toggle", async () => {
    for (const file of [
      "../../components/MessageInput.tsx",
      "../../contexts/UISettingsContext.tsx",
    ]) {
      const src = await read(file);
      expect(src, file).not.toContain("approveAllTools");
      expect(src, file).not.toContain(BYPASS);
    }
  });

  it("the middleware is installed unless the eval flag is set", async () => {
    const factory = await read("./index.ts");
    // The gate hangs off exactly one condition, and that condition is the eval-only flag.
    expect(factory).toContain(`cfg?.${BYPASS}`);
    expect(factory).toContain("humanInTheLoopMiddleware");
    expect(factory).not.toContain("approveAllTools");
  });

  it("every mutating tool is listed in interruptOn", async () => {
    const factory = await read("./index.ts");
    const { MUTATING_TOOL_NAMES } = await import("./mutatingTools");
    // interruptOn is built from MUTATING_TOOL_NAMES, so the gate covers a new mutating tool
    // automatically — pin that derivation rather than a hand-written list.
    expect(factory).toContain("MUTATING_TOOL_NAMES.map");
    expect(MUTATING_TOOL_NAMES.length).toBeGreaterThan(0);
  });
});

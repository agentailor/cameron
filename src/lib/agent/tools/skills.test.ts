import { beforeEach, describe, expect, it, vi } from "vitest";
import { callTool } from "./testing";

/** Contract tests for load_skill — registry stubbed. See docs/TESTING.md. */

vi.mock("@/lib/skills/registry", () => ({
  getSkill: vi.fn(),
  listSkills: vi.fn(),
}));

const registry = await import("@/lib/skills/registry");
const { loadSkill } = await import("./skills");

const DEMO = {
  name: "expense-reporter",
  description: "Turn spending questions into visual reports.",
  body: "# Expense Reporter\n\nStep 1: pick a chart.",
};

beforeEach(() => {
  vi.resetAllMocks();
});

describe("load_skill", () => {
  it("returns the skill's full instructions", async () => {
    vi.mocked(registry.getSkill).mockReturnValue(DEMO);

    const res = await callTool(loadSkill, { name: "expense-reporter" });

    expect(res).toMatchObject({ ok: true, name: DEMO.name, description: DEMO.description });
    expect(res.content).toBe(DEMO.body);
  });

  /**
   * The name is a plain string, not an enum, so a near-miss lands here rather than throwing at the
   * schema. Listing the real names is what turns a wrong guess into a one-turn correction.
   */
  it("rejects an unknown name and lists what is available", async () => {
    vi.mocked(registry.getSkill).mockReturnValue(undefined);
    vi.mocked(registry.listSkills).mockReturnValue([
      { name: DEMO.name, description: DEMO.description },
    ]);

    const res = await callTool(loadSkill, { name: "expense-report" });

    expect(res).toMatchObject({ ok: false, error: "unknown_skill" });
    expect(res.availableSkills.map((s: { name: string }) => s.name)).toEqual([DEMO.name]);
  });

  /** With no skills at all there is nothing to suggest — the payload must still be well-formed. */
  it("returns a well-formed payload when no skills are loaded", async () => {
    vi.mocked(registry.getSkill).mockReturnValue(undefined);
    vi.mocked(registry.listSkills).mockReturnValue([]);

    const res = await callTool(loadSkill, { name: "anything" });

    expect(res).toMatchObject({ ok: false, error: "unknown_skill" });
    expect(res.availableSkills).toEqual([]);
    expect(res.message).toContain("No skills are available");
  });
});

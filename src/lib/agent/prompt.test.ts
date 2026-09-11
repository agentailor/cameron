import { describe, expect, it } from "vitest";
import { buildSystemPrompt, SYSTEM_PROMPT } from "./prompt";

/**
 * The skills section is the always-on half of progressive disclosure, so what it says — and what
 * it says when there is nothing to say — is a contract with the model.
 */

describe("buildSystemPrompt", () => {
  /** An empty "Available skills:" heading would advertise a capability that isn't there. */
  it("returns the prompt untouched when there are no skills", () => {
    expect(buildSystemPrompt([])).toBe(SYSTEM_PROMPT);
  });

  it("lists every skill's name and description", () => {
    const prompt = buildSystemPrompt([
      { name: "expense-reporter", description: "Turn spending questions into visual reports." },
      { name: "tax-helper", description: "Prepare figures for a tax return." },
    ]);

    expect(prompt).toContain("expense-reporter");
    expect(prompt).toContain("Turn spending questions into visual reports.");
    expect(prompt).toContain("tax-helper");
    expect(prompt).toContain("Prepare figures for a tax return.");
  });

  it("keeps the base prompt and tells the agent how to load a skill", () => {
    const prompt = buildSystemPrompt([{ name: "demo", description: "A demo." }]);

    expect(prompt.startsWith(SYSTEM_PROMPT)).toBe(true);
    expect(prompt).toContain("load_skill");
  });
});

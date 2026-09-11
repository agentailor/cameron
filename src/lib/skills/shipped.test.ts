import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { validateSkill } from "./validate";

/**
 * The skills actually committed to `skills/` must pass the same validator the loader runs.
 *
 * Every other test here mocks the filesystem, which proves the rules work but not that the
 * shipped files obey them. A skill that fails validation is dropped at startup — the app still
 * boots, so nothing else would catch it until someone noticed the skill never activates.
 *
 * Reads real files, but no DB / network / API keys, so `pnpm test` stays free and offline.
 */

const SKILLS_DIR = join(process.cwd(), "skills");

const dirs = readdirSync(SKILLS_DIR, { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => e.name);

describe("shipped skills", () => {
  it("ships at least one skill", () => {
    expect(dirs.length).toBeGreaterThan(0);
  });

  it.each(dirs)("%s validates against the spec", (name) => {
    const source = readFileSync(join(SKILLS_DIR, name, "SKILL.md"), "utf8");
    const result = validateSkill(name, source);

    // Surface the actual rule that failed rather than a bare `false`.
    expect(result.ok ? null : result.error).toBeNull();
  });
});

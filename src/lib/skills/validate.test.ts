import { describe, expect, it } from "vitest";
import { parseFrontmatter, validateSkill } from "./validate";
import { MAX_DESCRIPTION_LENGTH, MAX_NAME_LENGTH } from "./types";

/**
 * The contract with the AgentSkills spec. A skill that validates here must validate against the
 * wider tooling, so the rules below mirror the reference validator rather than inventing limits.
 *
 * The defect class this guards: frontmatter that means something other than what its author wrote.
 * A hand-rolled parser (there is no YAML dependency) makes that failure cheap, so the rejection
 * cases matter more than the happy path.
 */

function skill(frontmatter: string, body = "Instructions."): string {
  return `---\n${frontmatter}\n---\n\n${body}\n`;
}

describe("parseFrontmatter", () => {
  it("returns the frontmatter map and the body separately", () => {
    const res = parseFrontmatter(skill("name: demo\ndescription: A demo.", "# Title\n\nBody."));

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.frontmatter).toEqual({ name: "demo", description: "A demo." });
    expect(res.body).toBe("# Title\n\nBody.");
  });

  it.each([
    ["double quotes", 'description: "Quoted."', "Quoted."],
    ["single quotes", "description: 'Quoted.'", "Quoted."],
  ])("unwraps %s", (_label, line, expected) => {
    const res = parseFrontmatter(skill(`name: demo\n${line}`));

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.frontmatter.description).toBe(expected);
  });

  it("keeps colons inside a value", () => {
    const res = parseFrontmatter(skill("name: demo\ndescription: Use when: a thing happens."));

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.frontmatter.description).toBe("Use when: a thing happens.");
  });

  /**
   * Structured YAML is the case worth refusing loudly. Silently taking `allowed-tools:` as an
   * empty string would drop the author's list without telling anyone.
   */
  it.each([
    ["a list value", "name: demo\ndescription: A demo.\nallowed-tools:\n  - Read"],
    ["a nested map", "name: demo\ndescription: A demo.\nmetadata:\n  version: 1.0.0"],
  ])("rejects %s rather than mis-parsing it", (_label, frontmatter) => {
    const res = parseFrontmatter(skill(frontmatter));

    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toMatch(/not supported/);
  });

  it.each([
    ["no opening fence", "name: demo\n---\n\nBody."],
    ["no closing fence", "---\nname: demo\n\nBody."],
  ])("rejects a file with %s", (_label, source) => {
    expect(parseFrontmatter(source).ok).toBe(false);
  });

  it("rejects a line that is not `key: value`", () => {
    const res = parseFrontmatter(skill("name: demo\nthis is not a pair"));

    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toMatch(/Malformed/);
  });
});

describe("validateSkill", () => {
  it("accepts a minimal valid skill and returns its parts intact", () => {
    const res = validateSkill(
      "demo",
      skill("name: demo\ndescription: Does a thing.", "Full instructions here."),
    );

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.skill).toEqual({
      name: "demo",
      description: "Does a thing.",
      body: "Full instructions here.",
    });
  });

  it.each(["license: MIT", "compatibility: any", "metadata: none", "allowed-tools: Read"])(
    "accepts the optional key %j",
    (line) => {
      const res = validateSkill("demo", skill(`name: demo\ndescription: A demo.\n${line}`));

      expect(res.ok).toBe(true);
    },
  );

  /**
   * `version` looks like it belongs and does not: the spec puts versioning under `metadata`.
   * Accepting it would store an author's intent that nothing ever reads.
   */
  it("rejects a top-level `version`, which is not in the spec", () => {
    const res = validateSkill("demo", skill("name: demo\ndescription: A demo.\nversion: 1.0.0"));

    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toMatch(/version/);
  });

  it("rejects an unrecognized key", () => {
    const res = validateSkill("demo", skill("name: demo\ndescription: A demo.\nauthor: someone"));

    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toMatch(/author/);
  });

  it.each([
    ["missing name", "description: A demo.", /Missing `name`/],
    ["missing description", "name: demo", /Missing `description`/],
    ["non-kebab name", "name: Demo_Skill\ndescription: A demo.", /kebab-case/],
    ["leading hyphen", "name: -demo\ndescription: A demo.", /hyphen/],
    ["trailing hyphen", "name: demo-\ndescription: A demo.", /hyphen/],
    ["doubled hyphen", "name: de--mo\ndescription: A demo.", /hyphen/],
  ])("rejects %s", (_label, frontmatter, expected) => {
    const res = validateSkill("demo", skill(frontmatter));

    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toMatch(expected);
  });

  it("rejects a name longer than the limit", () => {
    const name = "a".repeat(MAX_NAME_LENGTH + 1);
    const res = validateSkill(name, skill(`name: ${name}\ndescription: A demo.`));

    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toMatch(/maximum is 64/);
  });

  it("rejects a description longer than the limit", () => {
    const description = "a".repeat(MAX_DESCRIPTION_LENGTH + 1);
    const res = validateSkill("demo", skill(`name: demo\ndescription: ${description}`));

    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toMatch(/maximum is 1024/);
  });

  it("rejects angle brackets in the description", () => {
    const res = validateSkill("demo", skill("name: demo\ndescription: Use <this> thing."));

    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toMatch(/angle brackets/);
  });

  /** `load_skill` is called with the name, so a mismatch is a skill nothing can address. */
  it("rejects a name that does not match its directory", () => {
    const res = validateSkill("other-dir", skill("name: demo\ndescription: A demo."));

    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toMatch(/does not match its directory/);
  });

  it("rejects an empty body", () => {
    const res = validateSkill("demo", skill("name: demo\ndescription: A demo.", "   "));

    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toMatch(/body is empty/);
  });
});

import { describe, expect, it } from "vitest";
import { parseTaskFile } from "./taskFile";

function file(frontmatter: string, body = "Summarize last week's spending.") {
  return `---\n${frontmatter}\n---\n\n${body}\n`;
}

const VALID = `name: weekly-digest
description: A weekly summary of spending.
schedule: "0 8 * * MON"`;

describe("parseTaskFile", () => {
  it("parses a valid task, the body as its brief", () => {
    const result = parseTaskFile("weekly-digest", file(`${VALID}\ntimezone: Europe/Paris`));
    expect(result).toEqual({
      ok: true,
      task: {
        name: "weekly-digest",
        description: "A weekly summary of spending.",
        schedule: "0 8 * * MON",
        timezone: "Europe/Paris",
        brief: "Summarize last week's spending.",
      },
    });
  });

  it("leaves timezone out when absent", () => {
    const result = parseTaskFile("weekly-digest", file(VALID));
    expect(result.ok && "timezone" in result.task).toBe(false);
  });

  it("reads suggest_grants as a deduplicated list of tool names", () => {
    const result = parseTaskFile(
      "weekly-digest",
      file(
        `${VALID}\nsuggest_grants:\n  - gmail_search_messages\n  - gmail_read-message\n  - gmail_search_messages`,
      ),
    );
    expect(result.ok && result.task.suggestedGrants).toEqual([
      "gmail_search_messages",
      "gmail_read-message",
    ]);
  });

  it("leaves suggestedGrants out when absent or empty", () => {
    for (const extra of ["", "\nsuggest_grants: []"]) {
      const result = parseTaskFile("weekly-digest", file(`${VALID}${extra}`));
      expect(result.ok && "suggestedGrants" in result.task).toBe(false);
    }
  });

  it.each([
    ["a single string", "suggest_grants: gmail_search"],
    ["a name with spaces", "suggest_grants: [gmail search]"],
    ["a non-string entry", "suggest_grants: [42]"],
  ])("rejects suggest_grants as %s", (_case, line) => {
    const result = parseTaskFile("weekly-digest", file(`${VALID}\n${line}`));
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining("suggest_grants") });
  });

  it("rejects an unknown key rather than ignoring it", () => {
    const result = parseTaskFile("weekly-digest", file(`${VALID}\ntools: [run_sql]`));
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining("tools") });
  });

  it.each([
    ["name", VALID.replace(/^name:.*$/m, "")],
    ["description", VALID.replace(/^description:.*$/m, "")],
    ["schedule", VALID.replace(/^schedule:.*$/m, "")],
  ])("requires %s", (key, frontmatter) => {
    const result = parseTaskFile("weekly-digest", file(frontmatter));
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining(`\`${key}\``) });
  });

  it("requires the name to match its directory", () => {
    expect(parseTaskFile("digest", file(VALID)).ok).toBe(false);
  });

  it("rejects a name that isn't kebab-case", () => {
    const result = parseTaskFile("Weekly", file(VALID.replace("weekly-digest", "Weekly")));
    expect(result.ok).toBe(false);
  });

  it("rejects an invalid schedule or zone", () => {
    expect(
      parseTaskFile("weekly-digest", file(VALID.replace("0 8 * * MON", "every monday"))).ok,
    ).toBe(false);
    expect(parseTaskFile("weekly-digest", file(`${VALID}\ntimezone: Mars/Base`)).ok).toBe(false);
  });

  it("rejects a non-string value instead of coercing it", () => {
    const result = parseTaskFile("weekly-digest", file(`${VALID}\ntimezone: 42`));
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining("timezone") });
  });

  it("rejects a duplicate key", () => {
    expect(parseTaskFile("weekly-digest", file(`${VALID}\nname: other`)).ok).toBe(false);
  });

  it("rejects an empty body", () => {
    expect(parseTaskFile("weekly-digest", file(VALID, "")).ok).toBe(false);
  });

  it("rejects a file with no frontmatter", () => {
    expect(parseTaskFile("weekly-digest", "Just a brief.").ok).toBe(false);
    expect(parseTaskFile("weekly-digest", "---\nname: x\n").ok).toBe(false);
  });
});

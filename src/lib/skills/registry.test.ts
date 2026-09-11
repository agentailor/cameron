import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The failure policy, pinned in both directions: absence is silent, brokenness is loud.
 *
 * Both halves matter. Warning about an empty directory would train everyone to ignore the log,
 * and staying quiet about an unreadable one hides exactly the packaging regression this guards —
 * the runtime image is assembled by copying files, so "present but unreadable" is how that breaks.
 *
 * `node:fs` is mocked before the import so the module-level read at load time is intercepted too;
 * nothing here touches the real `skills/` directory.
 */

vi.mock("node:fs", () => ({
  readdirSync: vi.fn(),
  readFileSync: vi.fn(),
}));

const fs = await import("node:fs");
const { loadSkills } = await import("./registry");

function dir(name: string) {
  return { name, isDirectory: () => true };
}

function skillFile(name: string, description = "Does a thing.") {
  return `---\nname: ${name}\ndescription: ${description}\n---\n\nInstructions for ${name}.\n`;
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("loadSkills", () => {
  it("loads and returns a valid skill", () => {
    vi.mocked(fs.readdirSync).mockReturnValue([dir("demo")] as never);
    vi.mocked(fs.readFileSync).mockReturnValue(skillFile("demo") as never);

    const { skills, failures } = loadSkills("/skills");

    expect(failures).toEqual([]);
    expect(skills).toHaveLength(1);
    expect(skills[0]).toMatchObject({ name: "demo", description: "Does a thing." });
    expect(skills[0].body).toContain("Instructions for demo.");
  });

  /** A deployment with no skills is legitimate — it must not look like something went wrong. */
  it("treats an absent directory as zero skills, silently", () => {
    vi.mocked(fs.readdirSync).mockImplementation(() => {
      throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    });

    const { skills, failures } = loadSkills("/nope");

    expect(skills).toEqual([]);
    expect(failures).toEqual([]);
    expect(console.error).not.toHaveBeenCalled();
  });

  it("treats an empty directory as zero skills, silently", () => {
    vi.mocked(fs.readdirSync).mockReturnValue([] as never);

    const { skills, failures } = loadSkills("/skills");

    expect(skills).toEqual([]);
    expect(failures).toEqual([]);
    expect(console.error).not.toHaveBeenCalled();
  });

  it("ignores loose files, only reading directories", () => {
    vi.mocked(fs.readdirSync).mockReturnValue([
      { name: "README.md", isDirectory: () => false },
    ] as never);

    const { skills, failures } = loadSkills("/skills");

    expect(skills).toEqual([]);
    expect(failures).toEqual([]);
    expect(fs.readFileSync).not.toHaveBeenCalled();
  });

  it("drops an invalid skill and reports it, keeping the valid ones", () => {
    vi.mocked(fs.readdirSync).mockReturnValue([dir("good"), dir("bad")] as never);
    vi.mocked(fs.readFileSync).mockImplementation((path) =>
      String(path).includes("good")
        ? (skillFile("good") as never)
        : ("---\nname: bad\n---\n\nNo description.\n" as never),
    );

    const { skills, failures } = loadSkills("/skills");

    expect(skills.map((s) => s.name)).toEqual(["good"]);
    expect(failures).toHaveLength(1);
    expect(failures[0].dir).toBe("bad");
    expect(failures[0].error).toMatch(/Missing `description`/);
  });

  /** The packaging case: the directory is there, the file cannot be read. Never silent. */
  it("reports an unreadable SKILL.md instead of throwing", () => {
    vi.mocked(fs.readdirSync).mockReturnValue([dir("demo")] as never);
    vi.mocked(fs.readFileSync).mockImplementation(() => {
      throw new Error("EACCES");
    });

    const { skills, failures } = loadSkills("/skills");

    expect(skills).toEqual([]);
    expect(failures).toEqual([{ dir: "demo", error: "Could not read SKILL.md." }]);
  });

  /**
   * Directory order varies by filesystem. An unsorted list would reorder the skills section of
   * the system prompt between machines, making eval runs incomparable for no visible reason.
   */
  it("sorts skills by name so the prompt is stable across machines", () => {
    vi.mocked(fs.readdirSync).mockReturnValue([dir("zebra"), dir("alpha")] as never);
    vi.mocked(fs.readFileSync).mockImplementation((path) =>
      String(path).includes("zebra")
        ? (skillFile("zebra") as never)
        : (skillFile("alpha") as never),
    );

    const { skills } = loadSkills("/skills");

    expect(skills.map((s) => s.name)).toEqual(["alpha", "zebra"]);
  });
});

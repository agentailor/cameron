import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadTasks } from "./loader";

let dir: string;

function write(name: string, content: string) {
  mkdirSync(join(dir, name), { recursive: true });
  writeFileSync(join(dir, name, "TASK.md"), content);
}

const task = (name: string) =>
  `---\nname: ${name}\ndescription: d\nschedule: "0 8 * * MON"\n---\nbrief\n`;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "agent-tasks-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("loadTasks", () => {
  it("returns nothing, silently, for a missing directory", () => {
    expect(loadTasks(join(dir, "nope"))).toEqual({ tasks: [], failures: [] });
  });

  it("loads valid tasks sorted by name and reports broken ones", () => {
    write("b-task", task("b-task"));
    write("a-task", task("a-task"));
    write("broken", "no frontmatter");
    mkdirSync(join(dir, "empty-dir"));
    writeFileSync(join(dir, "stray.md"), "ignored");

    const { tasks, failures } = loadTasks(dir);
    expect(tasks.map((t) => t.name)).toEqual(["a-task", "b-task"]);
    expect(failures.map((f) => f.dir).sort()).toEqual(["broken", "empty-dir"]);
  });
});

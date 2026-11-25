import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadTasks } from "@agentailor/agent-tasks";

// The committed tasks are product code: a broken one would be dropped at startup with only a log.
describe("shipped tasks", () => {
  it("every task in tasks/ loads", () => {
    const { tasks, failures } = loadTasks(join(process.cwd(), "tasks"));
    expect(failures).toEqual([]);
    expect(tasks.map((t) => t.name)).toContain("weekly-digest");
  });
});

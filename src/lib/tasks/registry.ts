import { join } from "node:path";
import { loadTasks, type TaskDefinition } from "@agentailor/agent-tasks";

/**
 * Task files (`tasks/<name>/TASK.md`), read once at module load like skills: adding or editing a
 * task needs a restart. SERVER ONLY — reads the filesystem.
 */

export const TASKS_DIR = join(process.cwd(), "tasks");

const REGISTRY = loadTasks(TASKS_DIR);

for (const failure of REGISTRY.failures) {
  console.error(`[tasks] Skipped "${failure.dir}": ${failure.error}`);
}

export function listTasks(): TaskDefinition[] {
  return REGISTRY.tasks;
}

export function getTask(name: string): TaskDefinition | undefined {
  return REGISTRY.tasks.find((t) => t.name === name);
}

/** The zone a task without its own is read in: the server's (`TZ`, else the system zone). */
export function defaultTimezone(): string {
  return process.env.TZ || Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

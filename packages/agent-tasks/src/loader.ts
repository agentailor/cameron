import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { TASK_FILE, parseTaskFile } from "./taskFile";
import type { TaskDefinition, TaskFailure } from "./types";

export interface LoadedTasks {
  tasks: TaskDefinition[];
  failures: TaskFailure[];
}

/**
 * Read every `<dir>/<name>/TASK.md`. Absence is fine, brokenness is not: a missing or empty
 * directory yields no tasks silently; a task directory that fails to read or validate is
 * returned in `failures` for the caller to report. Sorted by name.
 */
export function loadTasks(dir: string): LoadedTasks {
  const tasks: TaskDefinition[] = [];
  const failures: TaskFailure[] = [];

  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return { tasks, failures };
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    let source: string;
    try {
      source = readFileSync(join(dir, entry.name, TASK_FILE), "utf8");
    } catch {
      failures.push({ dir: entry.name, error: `Could not read ${TASK_FILE}.` });
      continue;
    }
    const result = parseTaskFile(entry.name, source);
    if (result.ok) tasks.push(result.task);
    else failures.push({ dir: entry.name, error: result.error });
  }

  tasks.sort((a, b) => a.name.localeCompare(b.name));
  return { tasks, failures };
}

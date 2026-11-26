import { parseDocument } from "yaml";
import { validateSchedule } from "./schedule";
import type { TaskFileResult } from "./types";

/** Closed on purpose: an unknown key is a typo, and ignoring it drops the author's intent. */
export const TASK_FRONTMATTER_KEYS = [
  "name",
  "description",
  "schedule",
  "timezone",
  "tools",
] as const;

const STRING_KEYS = ["name", "description", "schedule", "timezone"] as const;
const TOOL_NAME = /^[A-Za-z0-9_-]+$/;

export const TASK_FILE = "TASK.md";
export const MAX_NAME_LENGTH = 64;
export const MAX_DESCRIPTION_LENGTH = 1024;

const FENCE = "---";
const KEBAB_CASE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

function split(source: string): { yaml: string; body: string } | { error: string } {
  const lines = source.split(/\r?\n/);
  let start = 0;
  while (start < lines.length && lines[start].trim() === "") start++;
  if (lines[start]?.trim() !== FENCE) {
    return { error: "Missing frontmatter: the file must open with a `---` fence." };
  }
  const closing = lines.findIndex((line, i) => i > start && line.trim() === FENCE);
  if (closing === -1) return { error: "Unterminated frontmatter: no closing `---` fence." };
  return {
    yaml: lines.slice(start + 1, closing).join("\n"),
    body: lines
      .slice(closing + 1)
      .join("\n")
      .trim(),
  };
}

function stringField(fm: Record<string, unknown>, key: string): string | undefined | Error {
  const value = fm[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") return new Error(`\`${key}\` must be a string.`);
  return value.trim();
}

/** `tools`: a list of tool names, deduplicated. Absent is an empty list. */
function toolList(value: unknown): string[] | Error {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) return new Error("`tools` must be a list of tool names.");
  for (const item of value) {
    if (typeof item !== "string" || !TOOL_NAME.test(item)) {
      return new Error(`\`tools\` has "${String(item)}": a tool name is letters, digits, _ and -.`);
    }
  }
  return [...new Set(value as string[])];
}

/** Parse and validate one `TASK.md`. `dirName` must equal the task's `name`. */
export function parseTaskFile(dirName: string, source: string): TaskFileResult {
  const parts = split(source);
  if ("error" in parts) return { ok: false, error: parts.error };

  const doc = parseDocument(parts.yaml, { uniqueKeys: true });
  if (doc.errors.length > 0) {
    return { ok: false, error: `Invalid frontmatter: ${doc.errors[0].message}` };
  }
  const fm: unknown = doc.toJS();
  if (fm === null || typeof fm !== "object" || Array.isArray(fm)) {
    return { ok: false, error: "Frontmatter must be a mapping of keys to values." };
  }
  const record = fm as Record<string, unknown>;

  const unexpected = Object.keys(record).filter(
    (key) => !(TASK_FRONTMATTER_KEYS as readonly string[]).includes(key),
  );
  if (unexpected.length > 0) {
    return {
      ok: false,
      error: `Unexpected frontmatter key(s): ${unexpected.join(", ")}. Allowed keys are ${TASK_FRONTMATTER_KEYS.join(", ")}.`,
    };
  }

  const fields: Record<string, string | undefined> = {};
  for (const key of STRING_KEYS) {
    const value = stringField(record, key);
    if (value instanceof Error) return { ok: false, error: value.message };
    fields[key] = value === "" ? undefined : value;
  }
  const { name, description, schedule, timezone } = fields;

  if (!name) return { ok: false, error: "Missing `name` in frontmatter." };
  if (!description) return { ok: false, error: "Missing `description` in frontmatter." };
  if (!schedule) return { ok: false, error: "Missing `schedule` in frontmatter." };

  if (!KEBAB_CASE.test(name)) {
    return {
      ok: false,
      error: `Name "${name}" must be kebab-case (lowercase letters, digits, single hyphens).`,
    };
  }
  if (name.length > MAX_NAME_LENGTH) {
    return {
      ok: false,
      error: `Name is ${name.length} characters; the maximum is ${MAX_NAME_LENGTH}.`,
    };
  }
  if (name !== dirName) {
    return { ok: false, error: `Name "${name}" does not match its directory "${dirName}".` };
  }
  if (description.length > MAX_DESCRIPTION_LENGTH) {
    return {
      ok: false,
      error: `Description is ${description.length} characters; the maximum is ${MAX_DESCRIPTION_LENGTH}.`,
    };
  }

  const check = validateSchedule(schedule, timezone);
  if (!check.ok) return { ok: false, error: check.error };

  const tools = toolList(record.tools);
  if (tools instanceof Error) return { ok: false, error: tools.message };

  if (parts.body === "") return { ok: false, error: "Task body is empty: there is no brief." };

  return {
    ok: true,
    task: {
      name,
      description,
      schedule,
      ...(timezone ? { timezone } : {}),
      ...(tools.length > 0 ? { tools } : {}),
      brief: parts.body,
    },
  };
}

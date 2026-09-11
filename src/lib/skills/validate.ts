import {
  ALLOWED_FRONTMATTER_KEYS,
  MAX_DESCRIPTION_LENGTH,
  MAX_NAME_LENGTH,
  type SkillResult,
} from "./types";

/**
 * Parsing and validating a SKILL.md against the AgentSkills spec.
 *
 * Pure and filesystem-free on purpose: this is the half worth testing hard, and keeping `node:fs`
 * out of it means the tests need no fixtures on disk. registry.ts is the thin shell that reads.
 *
 * There is no YAML dependency in this project, and the spec's frontmatter is flat scalars, so the
 * parser below covers exactly that. It REJECTS anything structural (lists, nested maps) rather
 * than mis-parsing it — a skill whose frontmatter silently means something other than what its
 * author wrote is worse than one that fails to load.
 */

const FENCE = "---";
const KEBAB_CASE = /^[a-z0-9-]+$/;

/** Strip one layer of matching quotes, the way a YAML scalar would be read. */
function unquote(raw: string): string {
  const value = raw.trim();
  const first = value[0];
  if ((first === '"' || first === "'") && value.length >= 2 && value.endsWith(first)) {
    return value.slice(1, -1);
  }
  return value;
}

export type FrontmatterResult =
  | { ok: true; frontmatter: Record<string, string>; body: string }
  | { ok: false; error: string };

/**
 * Split a SKILL.md into its frontmatter map and body.
 *
 * Values are returned as raw strings — validation of what they MEAN is validateSkill's job.
 */
export function parseFrontmatter(source: string): FrontmatterResult {
  const lines = source.split(/\r?\n/);

  let start = 0;
  while (start < lines.length && lines[start].trim() === "") start++;
  if (lines[start]?.trim() !== FENCE) {
    return { ok: false, error: "Missing frontmatter: the file must open with a `---` fence." };
  }

  const closing = lines.findIndex((line, i) => i > start && line.trim() === FENCE);
  if (closing === -1) {
    return { ok: false, error: "Unterminated frontmatter: no closing `---` fence." };
  }

  const frontmatter: Record<string, string> = {};
  for (let i = start + 1; i < closing; i++) {
    const line = lines[i];
    if (line.trim() === "") continue;

    // A leading `-` is a YAML list item, and a leading space is a nested mapping. Both mean the
    // value is structured, which this parser does not represent — refuse instead of guessing.
    if (/^\s*-\s/.test(line)) {
      return {
        ok: false,
        error: `Unsupported frontmatter at line ${i + 1}: list values are not supported.`,
      };
    }
    if (/^\s+\S/.test(line)) {
      return {
        ok: false,
        error: `Unsupported frontmatter at line ${i + 1}: nested values are not supported.`,
      };
    }

    const separator = line.indexOf(":");
    if (separator === -1) {
      return {
        ok: false,
        error: `Malformed frontmatter at line ${i + 1}: expected \`key: value\`.`,
      };
    }

    const key = line.slice(0, separator).trim();
    const value = unquote(line.slice(separator + 1));
    if (key === "") {
      return { ok: false, error: `Malformed frontmatter at line ${i + 1}: empty key.` };
    }
    // An empty value followed by an indented line is a nested map opening; the indent check above
    // catches the continuation, so an empty value here is simply an empty scalar.
    frontmatter[key] = value;
  }

  return {
    ok: true,
    frontmatter,
    body: lines
      .slice(closing + 1)
      .join("\n")
      .trim(),
  };
}

/**
 * Validate one skill against the spec.
 *
 * `dirName` is checked against `name` because every real skill on disk follows that convention,
 * and a mismatch means `load_skill` would be called with a name no directory answers to.
 */
export function validateSkill(dirName: string, source: string): SkillResult {
  const parsed = parseFrontmatter(source);
  if (!parsed.ok) return { ok: false, error: parsed.error };

  const { frontmatter, body } = parsed;

  const unexpected = Object.keys(frontmatter).filter(
    (key) => !(ALLOWED_FRONTMATTER_KEYS as readonly string[]).includes(key),
  );
  if (unexpected.length > 0) {
    return {
      ok: false,
      error:
        `Unexpected frontmatter key(s): ${unexpected.join(", ")}. Allowed keys are ` +
        `${ALLOWED_FRONTMATTER_KEYS.join(", ")}.`,
    };
  }

  const name = frontmatter.name;
  if (!name) return { ok: false, error: "Missing `name` in frontmatter." };

  const description = frontmatter.description;
  if (!description) return { ok: false, error: "Missing `description` in frontmatter." };

  if (!KEBAB_CASE.test(name)) {
    return {
      ok: false,
      error: `Name "${name}" must be kebab-case (lowercase letters, digits and hyphens only).`,
    };
  }
  if (name.startsWith("-") || name.endsWith("-") || name.includes("--")) {
    return {
      ok: false,
      error: `Name "${name}" cannot start or end with a hyphen, or contain consecutive hyphens.`,
    };
  }
  if (name.length > MAX_NAME_LENGTH) {
    return {
      ok: false,
      error: `Name is ${name.length} characters; the maximum is ${MAX_NAME_LENGTH}.`,
    };
  }
  if (name !== dirName) {
    return {
      ok: false,
      error: `Name "${name}" does not match its directory "${dirName}". They must be identical.`,
    };
  }

  if (description.length > MAX_DESCRIPTION_LENGTH) {
    return {
      ok: false,
      error: `Description is ${description.length} characters; the maximum is ${MAX_DESCRIPTION_LENGTH}.`,
    };
  }
  if (description.includes("<") || description.includes(">")) {
    return { ok: false, error: "Description cannot contain angle brackets (< or >)." };
  }

  if (body === "") {
    return { ok: false, error: "Skill body is empty: there are no instructions to load." };
  }

  return { ok: true, skill: { name, description, body } };
}

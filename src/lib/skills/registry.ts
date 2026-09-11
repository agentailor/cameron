import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { validateSkill } from "./validate";
import type { Skill, SkillFailure, SkillMetadata } from "./types";

/**
 * The skill registry: read once at module load, cached for the process.
 *
 * SERVER ONLY — this touches `node:fs`. Import it from the agent, never from a client component.
 *
 * Skills are read at startup rather than per request: a fresh agent is built for every turn, so a
 * per-request read would hit the disk on every message to produce the same answer.
 *
 * Failure policy — absence is fine, brokenness is not:
 *   - no `skills/` directory, or an empty one  -> zero skills, SILENTLY. A deployment that ships
 *     no skills is legitimate, and warning about it would train everyone to ignore the warning.
 *   - a skill directory that exists but cannot be read or fails validation -> logged LOUDLY and
 *     dropped, keeping the valid ones. This is the case that must never pass unnoticed: the
 *     runtime image is built by copying files, so "the files are there but unreadable" is exactly
 *     how a packaging regression shows up.
 */

export const SKILLS_DIR = join(process.cwd(), "skills");
const SKILL_FILE = "SKILL.md";

export interface LoadedSkills {
  skills: Skill[];
  failures: SkillFailure[];
}

/** Read and validate every skill directory. Exported for tests; the app uses the cache below. */
export function loadSkills(dir: string = SKILLS_DIR): LoadedSkills {
  const skills: Skill[] = [];
  const failures: SkillFailure[] = [];

  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    // No skills directory at all — the legitimate empty case, not an error.
    return { skills, failures };
  }
  // Defensive: a non-array here means the directory could not be enumerated as expected. Treat it
  // as empty rather than throwing at module load, which would take the whole server down.
  if (!Array.isArray(entries)) return { skills, failures };

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    let source: string;
    try {
      source = readFileSync(join(dir, entry.name, SKILL_FILE), "utf8");
    } catch {
      failures.push({
        dir: entry.name,
        error: `Could not read ${SKILL_FILE}.`,
      });
      continue;
    }

    const result = validateSkill(entry.name, source);
    if (!result.ok) {
      failures.push({ dir: entry.name, error: result.error });
      continue;
    }
    skills.push(result.skill);
  }

  // Sorted so the system prompt is byte-identical across machines. Directory order varies by
  // filesystem, and a prompt that differs between dev and CI makes eval runs incomparable.
  skills.sort((a, b) => a.name.localeCompare(b.name));
  return { skills, failures };
}

const REGISTRY = loadSkills();

for (const failure of REGISTRY.failures) {
  console.error(`[skills] Skipped "${failure.dir}": ${failure.error}`);
}

/** Name + description for every valid skill — what goes into the system prompt. */
export function listSkills(): SkillMetadata[] {
  return REGISTRY.skills.map(({ name, description }) => ({ name, description }));
}

/** Full instructions for one skill, or undefined if no skill answers to that name. */
export function getSkill(name: string): Skill | undefined {
  return REGISTRY.skills.find((s) => s.name === name);
}

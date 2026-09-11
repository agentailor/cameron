/**
 * Skill shapes and the closed set of frontmatter keys the spec allows.
 *
 * A ZERO-IMPORT leaf, for the same reason as lib/config/catalog.ts: loading skills touches
 * `node:fs`, so anything that merely needs to NAME a skill (a page, a client component, a test)
 * must be able to reach these types without dragging the filesystem into the bundle.
 */

/** What sits permanently in the system prompt — cheap enough to advertise every request. */
export interface SkillMetadata {
  name: string;
  description: string;
}

/** A loaded skill: its metadata plus the instructions `load_skill` hands back. */
export interface Skill extends SkillMetadata {
  body: string;
}

/**
 * Frontmatter keys the AgentSkills spec permits. Closed on purpose — an unrecognized key is a
 * typo or a misunderstanding of the format, and silently ignoring it means the author's intent
 * never takes effect. Note there is NO top-level `version`: the spec puts versioning under
 * `metadata`, so a plausible-looking `version:` must be rejected rather than quietly accepted.
 */
export const ALLOWED_FRONTMATTER_KEYS = [
  "name",
  "description",
  "license",
  "allowed-tools",
  "metadata",
  "compatibility",
] as const;

export type AllowedFrontmatterKey = (typeof ALLOWED_FRONTMATTER_KEYS)[number];

/** Spec limits, mirrored from the reference validator so a skill valid here is valid elsewhere. */
export const MAX_NAME_LENGTH = 64;
export const MAX_DESCRIPTION_LENGTH = 1024;

/** Validation outcome. Mirrors the `{ ok, error }` payload shape the tools already return. */
export type SkillResult = { ok: true; skill: Skill } | { ok: false; error: string };

/** A skill directory that exists on disk but could not be loaded. Always reported loudly. */
export interface SkillFailure {
  dir: string;
  error: string;
}

# Skills

Skills are **instructions loaded on demand** — the [AgentSkills](https://agentskills.io/specification)
`SKILL.md` format, with progressive disclosure as the point. No bash, no sandbox, no runtime
filesystem access from the agent: it is a registry plus one read-only tool.

A skill that is pure instructions is a legitimate skill under the spec. Bundled executable scripts
are an optional part of the format, and this implementation deliberately covers the half that needs
no runtime — see [What's not here](#whats-not-here).

## How a skill reaches the agent

Two steps, and the split between them is the whole idea:

1. **Always in context.** Every valid skill's name + description is appended to the system prompt at
   startup by `buildSystemPrompt()` (`src/lib/agent/prompt.ts`). A line per skill, so the agent
   always knows what exists.
2. **Loaded on demand.** The agent calls `load_skill` with a name; the full body comes back as the
   tool result. The instructions only occupy context when they are actually being used.

With no skills the prompt is returned **untouched** — an empty "Available skills:" heading would
advertise a capability that isn't there.

`load_skill` is read-only, so it auto-approves and never reaches the HITL gate. The instructions it
returns may well lead to a mutating tool, and that tool is gated exactly as always: **the approval
boundary does not move because the agent read something first.**

### Why `name` is a plain string, not an enum

The skill names are already in the system prompt verbatim, on every request. A wrong name means the
agent mistyped something it could see — rare — and the `unknown_skill` payload lists
`availableSkills`, which corrects it in one turn.

An enum would cost three things: it breaks the legitimate zero-skills case (`z.enum([])` is invalid
in Zod); it makes the tool's schema depend on what happens to be on disk, which then flows through
`sanitizeTool`'s provider-specific rewriting; and it converts a correctable payload into a schema
throw the agent has _less_ to recover from. Same reasoning as `set_config`'s `key`.

## Where skills live

|                      | Path              | Tracked?   | What it is                                                                  |
| -------------------- | ----------------- | ---------- | --------------------------------------------------------------------------- |
| **Cameron's skills** | `skills/`         | committed  | Product code. Ships in releases, copied into the runtime image.             |
| **Dev tooling**      | `.agents/skills/` | gitignored | Skills that shape how _this repo's code_ gets written (e.g. `tool-design`). |

The gitignore is what enforces the split — don't rely on a naming convention. Two different things
share the word "skill", and conflating them is the mistake to avoid.

Reinstall the dev tooling with:

```bash
npx skills add agentailor/skills --skill tool-design
```

## Loading (`src/lib/skills/`)

```
src/lib/skills/
├── types.ts        # ZERO-IMPORT leaf: Skill, SkillMetadata, allowed keys, limits
├── validate.ts     # frontmatter parser + spec validation (imports only ./types)
├── registry.ts     # fs read at module load, caches the map (SERVER ONLY)
└── *.test.ts
```

- **`types.ts` is a zero-import leaf**, for the same reason as `src/lib/config/catalog.ts`: loading
  skills touches `node:fs`, so anything that merely needs to _name_ a skill must reach the types
  without dragging the filesystem into the bundle.
- **`validate.ts` is pure and fs-free**, so its tests need no fixtures on disk. This is the half
  worth testing hard.
- **`registry.ts` reads once at module load** and caches for the process, so adding or editing a
  skill needs a restart. A fresh agent is built per turn, so a per-request read would hit the disk on
  every message to produce the same answer.
- **Results are sorted by name.** Directory order varies by filesystem, and an unsorted prompt
  differs between dev and CI — which would make eval runs incomparable for no visible reason.

## Validation

Mirrored from the spec's reference validator, so a skill valid here is valid to the wider tooling:

| Field         | Rule                                                                                                                                   |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `name`        | **Required.** Kebab-case (`^[a-z0-9-]+$`), ≤64 chars, no leading/trailing or doubled hyphens, and **identical to its directory name**. |
| `description` | **Required.** ≤1024 chars, no angle brackets.                                                                                          |
| Optional keys | `license`, `allowed-tools`, `metadata`, `compatibility`.                                                                               |
| Body          | Must be non-empty.                                                                                                                     |

Two rules that look arbitrary and aren't:

- **`name` must match the directory.** `load_skill` is called with the name, so a mismatch is a skill
  nothing can address.
- **There is no top-level `version`.** The spec puts versioning under `metadata`. A plausible-looking
  `version:` is therefore _rejected_ rather than silently stored somewhere nothing reads it.

**No YAML dependency.** The spec's frontmatter is flat scalars, so the parser covers exactly that —
and **rejects** structured values (lists, nested maps) rather than mis-parsing them. Frontmatter that
silently means something other than what its author wrote is worse than a skill that fails to load.

## Failure policy: absence is fine, brokenness is not

| State                                        | Behavior                                                                                                      |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `skills/` absent, or present and empty       | **Silent.** Zero skills is legitimate — a fresh clone, or a deployment that ships none. No warning, no throw. |
| A skill exists but its `SKILL.md` is invalid | **Loud.** Logged with the directory and the specific rule broken, then dropped. Valid skills still load.      |
| A skill exists but `SKILL.md` is unreadable  | **Loud.** Same treatment.                                                                                     |

Both halves earn their place. Warning about an empty directory trains everyone to ignore the log;
staying quiet about an unreadable one hides a packaging regression. `registry.test.ts` pins both,
including that `console.error` is **not** called on the empty case.

## Production packaging (the trap)

`output: "standalone"` traces _imports_, and skills are read from _disk_, so nothing infers them.
Two things carry `skills/` into the runtime image:

- `COPY --from=build /app/skills ./skills` in the Dockerfile's runtime stage, next to `public`
  (which carries the same "served from disk, not traced" caveat).
- `outputFileTracingIncludes` in `next.config.ts`.

Without them the image runs with **zero skills and says nothing** — which is exactly why the failure
policy distinguishes unreadable from absent. Verify with `docker compose --profile full up` and ask
the agent what skills it has.

## Adding a skill

Create `skills/<name>/SKILL.md`; the frontmatter `name` must match the directory.

```markdown
---
name: my-skill
description: What it does, and when the agent should reach for it.
---

# My Skill

Instructions…
```

The `description` is the **only** thing the agent sees when deciding whether to load the skill, so
say _when_ to use it, not just what it is. Don't put a "When to use this skill" section in the body —
the body is only read after the skill has already been chosen.

Restart the server; the skill appears in the prompt and at `/capabilities`.

## Testing

- `validate.test.ts` — the contract with the spec. Every rejection path, since a hand-rolled parser
  makes mis-parsing cheap.
- `registry.test.ts` — the failure policy in both directions, with `node:fs` mocked.
- `shipped.test.ts` — runs the **real committed** `SKILL.md` files through the real validator. The
  other tests prove the rules work; this proves the shipped files obey them. A failing skill is
  dropped at startup and the app still boots, so nothing else would catch it.
- `src/lib/agent/tools/skills.test.ts` — the `load_skill` payload, registry stubbed.
- `src/lib/agent/prompt.test.ts` — that an empty skill list leaves the prompt untouched.

## What's not here

Deliberate omissions, not oversights:

- **No bash, no sandbox, no filesystem access for the agent.** Progressive disclosure needs none of
  them.
- **No bundled resources.** The loader reads `SKILL.md` only; `references/`, `scripts/` and
  `assets/` are not resolved. A skill that ships a `render.py` cannot run it. This is where the
  missing runtime starts, and it is the natural next increment.
- **Skills are not listed as capabilities.** `/capabilities` lists the `load_skill` _tool_, not the
  skills themselves — `Capability.mutating` is a boolean with no meaningful value for a skill.

## Notes for evals

`load_skill` is a real tool call, so skill activation is gradeable on the existing harness with no
new machinery: `toolCalled("load_skill")`, `toolCalledWith("load_skill", …)` for which skill, and
`toolCalledBefore("load_skill", "run_sql")` for whether the agent consulted the skill _before_ doing
the work rather than after. That ordering is the behavior worth asserting — set membership alone
can't distinguish the two.

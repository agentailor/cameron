# Skills

Cameron's own skills, in the [AgentSkills](https://agentskills.io/specification) format: one
directory per skill, each holding a `SKILL.md` with `name` + `description` frontmatter.

**This directory is product code.** It is committed, it ships in tagged releases, and it is copied
into the runtime Docker image. That is the difference between it and `.agents/skills/`, which is
gitignored developer tooling installed with `npx skills add` (the `tool-design` skill that shapes
how the code here is written). Do not conflate the two: a skill that belongs to Cameron goes here,
a skill that helps you author Cameron goes in `.agents/`.

## How a skill reaches the agent

Progressive disclosure, in two steps:

1. Every valid skill's **name and description** are appended to the system prompt at startup, so
   the agent always knows what exists. This is the cheap part — a line per skill.
2. The agent calls **`load_skill`** with a name when it decides a skill is relevant, and the full
   body comes back as the tool result. The instructions only ever occupy context when they are
   actually being used.

Skills are read **once at server startup**. Adding or editing one requires a restart.

## Adding a skill

Create `skills/<name>/SKILL.md`. The `name` in the frontmatter must match the directory name.

```markdown
---
name: my-skill
description: What it does, and when the agent should reach for it.
---

# My Skill

Instructions…
```

The `description` is the only thing the agent sees when deciding whether to load the skill, so say
**when** to use it, not just what it is.

An invalid skill is **dropped and logged** at startup; the valid ones still load. An empty or
absent `skills/` directory is not an error.

The full validation rules, the failure policy, and how skills are packaged for production live in
[../docs/SKILLS.md](../docs/SKILLS.md) — kept there rather than duplicated here so the limits have
one home.

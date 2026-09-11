import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { getSkill, listSkills } from "@/lib/skills/registry";

/**
 * Progressive disclosure for skills.
 *
 * Every skill's name and description already sit in the system prompt, so the agent knows what
 * exists without spending anything. This tool is the second half: it pulls ONE skill's full
 * instructions into context, and only when the agent has decided it needs them.
 *
 * Read-only — it returns text and touches nothing, so it is not gated. The instructions it returns
 * may well lead to a mutating tool, and that tool is gated exactly as it always was: the approval
 * boundary does not move just because the agent read something first.
 */

export const loadSkill = tool(
  async (input) => {
    const skill = getSkill(input.name);

    // A plain string (not an enum) so a near-miss returns a correctable payload listing the real
    // names, instead of a schema throw the agent can only retry blindly.
    if (!skill) {
      const available = listSkills();
      return JSON.stringify({
        ok: false,
        error: "unknown_skill",
        message:
          available.length === 0
            ? `No skill named "${input.name}" is loaded. No skills are available at all.`
            : `No skill named "${input.name}" is loaded. See \`availableSkills\` for the real names.`,
        availableSkills: available,
      });
    }

    return JSON.stringify({
      ok: true,
      name: skill.name,
      description: skill.description,
      content: skill.body,
    });
  },
  {
    name: "load_skill",
    description:
      "Load a skill's full instructions by name. The skills available to you are listed in your " +
      "system prompt with a short description each; call this when one of them matches what the " +
      "user is asking for, BEFORE you start the task, and then follow the instructions it " +
      "returns. Read-only — runs without approval, and reading a skill does not approve anything " +
      "it tells you to do.",
    schema: z.object({
      name: z
        .string()
        .min(1)
        .describe(
          "The skill's name, exactly as listed in your system prompt (e.g. 'expense-reporter')",
        ),
    }),
  },
);

/** Skill tools, registered into the agent in agent/index.ts. Read-only — nothing here is gated. */
export const skillTools = [loadSkill];

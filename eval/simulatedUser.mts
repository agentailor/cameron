import { createLLMSimulatedUser, runMultiturnSimulation } from "openevals";
import { createChatModel } from "../src/lib/agent/util.ts";
import { DEFAULT_MAX_TURNS, SIMULATOR_MODEL } from "./config.mts";
import { buildUserPrompt, CANNOT_ANSWER, DONE } from "./simulatedUser.prompt.mts";
import type { ConversationTurn, Inconclusive, SimulatedUser } from "./types.mts";

/**
 * The ONLY file in the eval suite that imports `openevals`. Keep it that way: the agent is reached
 * through the `send` hook, so nothing here knows about LangGraph or the approval gate, and swapping
 * the library later means rewriting this file only.
 *
 * See "Simulated users" in eval/README.md for the design.
 */

/** How the adapter reaches the agent. `runner.mts` owns the implementation. */
export interface SimulatedRunHooks {
  /** Send one user message, settle any approval interrupts, return the agent's reply text. */
  send: (text: string) => Promise<string>;
}

export interface SimulatedRunResult {
  conversation: ConversationTurn[];
  /** Set when the conversation produced nothing gradeable. */
  inconclusive?: Inconclusive;
}

/** A trailing sentinel is protocol, not dialogue — strip it before anyone reads the transcript. */
function stripSentinels(text: string): string {
  return text.replaceAll(DONE, "").replaceAll(CANNOT_ANSWER, "").trim();
}

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter((b): b is { type: string; text: string } => (b as { type?: string })?.type === "text")
      .map((b) => b.text)
      .join("");
  }
  return "";
}

/**
 * Run a conversation between the agent and a simulated user.
 *
 * `opening` replays verbatim as openevals `fixedResponses` — which counts the opening user message
 * as turn 0, so a case's existing `prompt` maps over unchanged.
 */
export async function runSimulatedConversation(opts: {
  user: SimulatedUser;
  opening: string[];
  hooks: SimulatedRunHooks;
  threadId: string;
}): Promise<SimulatedRunResult> {
  const { user, opening, hooks, threadId } = opts;

  const conversation: ConversationTurn[] = [];
  let inconclusive: Inconclusive | undefined;
  let turnsTaken = 0;
  // The agent's most recent reply, so `simulator-cannot-answer` can name the question it declined.
  let lastAgentText = "";

  const client = createChatModel({
    provider: SIMULATOR_MODEL.provider,
    model: SIMULATOR_MODEL.name,
    temperature: SIMULATOR_MODEL.temperature,
  });

  const simulatedUser = createLLMSimulatedUser({
    system: buildUserPrompt(user),
    // `openevals` is ESM-only, so its .d.ts resolves `BaseChatModel` through the ESM path while
    // this .mts gets the CJS twin of the same class — nominally incompatible, identical at runtime.
    client: client as unknown as Parameters<typeof createLLMSimulatedUser>[0]["client"],
    fixedResponses: opening,
  });

  const maxTurns = user.maxTurns ?? DEFAULT_MAX_TURNS;

  await runMultiturnSimulation({
    threadId,
    maxTurns,
    user: async (params) => {
      const message = await simulatedUser(params);
      const raw = textOf(message.content);
      const fixed = params.turnCounter < opening.length;

      if (!fixed && raw.trim() === "") {
        inconclusive = {
          reason: "simulator-silent",
          detail: "the simulated user returned nothing",
        };
      } else if (!fixed && raw.includes(CANNOT_ANSWER)) {
        inconclusive = {
          reason: "simulator-cannot-answer",
          // The verbatim question is the repair instruction — see eval/README.md.
          detail: `the agent asked for something outside the fact sheet: "${lastAgentText.slice(0, 300)}"`,
        };
      } else if (!fixed) {
        const invented = user.facts
          .flatMap((f) => f.contradicts ?? [])
          .find((bad) => raw.includes(bad));
        if (invented) {
          inconclusive = {
            reason: "simulator-invented",
            detail: `the simulated user asserted "${invented}", which no fact supports`,
          };
        }
      }

      const text = stripSentinels(raw);
      if (text) {
        conversation.push({ role: "user", text, source: fixed ? "fixed" : "simulated" });
      }
      return message;
    },
    app: async ({ inputs }) => {
      turnsTaken += 1;
      // A sentinel turn is protocol — never send it to the agent.
      const text = stripSentinels(textOf(inputs.content));
      const reply = text ? await hooks.send(text) : "";
      lastAgentText = reply || lastAgentText;
      if (reply) conversation.push({ role: "assistant", text: reply });
      return { role: "assistant", content: reply };
    },
    stoppingCondition: async ({ trajectory }) => {
      if (inconclusive) return true;

      const lastUser = [...trajectory].reverse().find((m) => m.role === "user");
      if (lastUser && textOf(lastUser.content).includes(DONE)) return true;

      // Safe to read the DB only because `send` has driven the turn to quiescence. If `send` ever
      // streams, this could fire mid-turn and truncate the conversation.
      return user.until ? await user.until() : false;
    },
  });

  // Ran out of turns with nothing else to say why.
  if (!inconclusive && turnsTaken >= maxTurns) {
    inconclusive = {
      reason: "max-turns",
      detail: `hit maxTurns (${maxTurns}) with the conversation still going`,
    };
  }

  return { conversation, inconclusive };
}

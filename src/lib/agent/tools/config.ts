import { tool } from "@langchain/core/tools";
import { z } from "zod";
import * as configRepo from "@/lib/repositories/configRepository";
import {
  CONFIG_KEYS,
  CONFIG_KEY_NAMES,
  getConfigKeyDef,
  isConfigKey,
  type ConfigKey,
} from "@/lib/config/catalog";

/**
 * Owner-level settings the agent establishes once and reuses.
 *
 * The catalog of keys is CLOSED (see lib/config/catalog.ts), and each key carries its own
 * validator, so a value relayed in the user's words ('euros', '€') is refused correctably.
 *
 * `get_config` always reports a value — stored or fallback — and says which via `isSet`. That
 * distinction is the point: "the owner uses dollars" and "nobody has said" are not the same fact.
 */

const keyEnum = z.enum(CONFIG_KEY_NAMES as [ConfigKey, ...ConfigKey[]]);

function describeKeys(): { key: string; description: string }[] {
  return CONFIG_KEY_NAMES.map((k) => ({
    key: k,
    description: CONFIG_KEYS[k].description,
  }));
}

export const getConfig = tool(
  async (input) => {
    // No key given: report every setting at once, so establishing context costs one call.
    if (!input.key) {
      const stored = new Map((await configRepo.list()).map((e) => [e.key, e.value]));
      return JSON.stringify({
        settings: CONFIG_KEY_NAMES.map((k) => {
          const def = getConfigKeyDef(k);
          const value = stored.get(k);
          return {
            key: k,
            value: value ?? def.fallback,
            isSet: value !== undefined,
            fallback: def.fallback,
            description: def.description,
          };
        }),
      });
    }

    const def = getConfigKeyDef(input.key);
    const entry = await configRepo.get(input.key);
    return JSON.stringify({
      key: input.key,
      value: entry?.value ?? def.fallback,
      isSet: entry !== null,
      fallback: def.fallback,
      description: def.description,
    });
  },
  {
    name: "get_config",
    description:
      "Read the owner's settings (e.g. their default currency). Read-only — runs without " +
      "approval. Omit `key` to get every setting at once. Each result reports `isSet`: when it " +
      "is false NOBODY has chosen a value and you are seeing a fallback, so ASK the user rather " +
      "than treating it as their answer. Once set, reuse it instead of asking again.",
    schema: z.object({
      key: keyEnum.optional().describe("Which setting to read. Omit to read all of them."),
    }),
  },
);

export const setConfig = tool(
  async (input) => {
    // The catalog is closed. A key outside it would be a row nothing ever reads.
    if (!isConfigKey(input.key)) {
      return JSON.stringify({
        ok: false,
        error: "unknown_key",
        message:
          `"${input.key}" is not a setting Cameron stores. Nothing was written. Valid keys are ` +
          `listed in \`validKeys\`.`,
        validKeys: describeKeys(),
      });
    }

    const def = getConfigKeyDef(input.key);
    const parsed = def.parse(input.value);
    if (!parsed.ok) {
      return JSON.stringify({
        ok: false,
        error: "invalid_value",
        key: input.key,
        message: `${parsed.error} Nothing was written.`,
      });
    }

    const entry = await configRepo.set(input.key, parsed.value);
    // Echo the STORED value, not the input — it may have been normalized (e.g. 'eur' -> 'EUR').
    return JSON.stringify({ ok: true, key: entry.key, value: entry.value });
  },
  {
    name: "set_config",
    description:
      "Save one of the owner's settings, such as their default currency. Only use a value the " +
      "user has actually told you — never infer a setting from context (a merchant's country, a " +
      "file's language) and never guess. Values are validated and normalized, so an invalid one " +
      "is rejected with an explanation and nothing is written. This changes stored settings and " +
      "requires the user's approval.",
    schema: z.object({
      key: z
        .string()
        .min(1)
        .describe(`Which setting to save. One of: ${CONFIG_KEY_NAMES.join(", ")}`),
      value: z
        .string()
        .min(1)
        .describe("The value to store, as the user gave it (e.g. 'EUR' for the currency setting)"),
    }),
  },
);

/** Owner-settings tools, registered into the agent in agent/index.ts. set_config is gated. */
export const configTools = [getConfig, setConfig];

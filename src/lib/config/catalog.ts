/**
 * The closed catalog of owner-level settings.
 *
 * The `config` table holds only `(key, value, updated_at)`: meaning and validation live here, where
 * they typecheck and can't go stale in a row nobody reads. `set_config` rejects any key not listed
 * below, so an agent-invented key never becomes a row the application ignores.
 *
 * A ZERO-IMPORT leaf — every caller reaches DEFAULT_CURRENCY through it, so the literal exists once.
 */

/** Last-resort currency when the owner has not set one. */
export const DEFAULT_CURRENCY = "USD";

export interface ConfigKeyDef {
  key: string;
  /** Shown to the agent by `get_config` so it knows what the key is for. */
  description: string;
  fallback: string;
  /**
   * Normalize + validate a proposed value. Returns the value to store, or an error string
   * explaining the rejection in terms the agent can act on.
   */
  parse: (raw: string) => { ok: true; value: string } | { ok: false; error: string };
}

const ISO_CURRENCY = /^[A-Za-z]{3}$/;

export const CONFIG_KEYS = {
  currency: {
    key: "currency",
    description:
      "The owner's default ISO 4217 currency code, used for transactions that don't specify one " +
      "(e.g. 'EUR', 'USD', 'GBP').",
    fallback: DEFAULT_CURRENCY,
    parse: (raw: string) => {
      const trimmed = raw.trim();
      if (!ISO_CURRENCY.test(trimmed)) {
        return {
          ok: false,
          // A symbol or a word is what an agent relaying the user's phrasing actually sends.
          error:
            `"${raw}" is not an ISO 4217 currency code. Use the three-letter code, not a symbol ` +
            `or a name (e.g. 'EUR' for euros/€, 'USD' for dollars/$, 'GBP' for pounds/£).`,
        };
      }
      return { ok: true, value: trimmed.toUpperCase() };
    },
  },
} as const satisfies Record<string, ConfigKeyDef>;

export type ConfigKey = keyof typeof CONFIG_KEYS;

export const CONFIG_KEY_NAMES = Object.keys(CONFIG_KEYS) as ConfigKey[];

export function isConfigKey(key: string): key is ConfigKey {
  return Object.prototype.hasOwnProperty.call(CONFIG_KEYS, key);
}

export function getConfigKeyDef(key: ConfigKey): ConfigKeyDef {
  return CONFIG_KEYS[key];
}

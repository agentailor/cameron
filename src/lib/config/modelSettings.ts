export const MODEL_PROVIDER_KEY = "model_provider";
export const MODEL_NAME_KEY = "model_name";
export const OPENAI_COMPATIBLE_BASE_URL_KEY = "openai_compatible_base_url";

export const OPENAI_COMPATIBLE_PROVIDER = "openai-compatible";

export interface ProviderDef {
  id: string;
  label: string;
  apiKeyEnvVar: string;
  apiKeyRequired: boolean;
  requiresBaseUrl: boolean;
  envNote: string;
}

export const PROVIDERS = [
  {
    id: "anthropic",
    label: "Anthropic",
    apiKeyEnvVar: "ANTHROPIC_API_KEY",
    apiKeyRequired: true,
    requiresBaseUrl: false,
    envNote: "Create a key at console.anthropic.com.",
  },
  {
    id: "openai",
    label: "OpenAI",
    apiKeyEnvVar: "OPENAI_API_KEY",
    apiKeyRequired: true,
    requiresBaseUrl: false,
    envNote: "Create a key at platform.openai.com.",
  },
  {
    id: "google",
    label: "Google",
    apiKeyEnvVar: "GOOGLE_API_KEY",
    apiKeyRequired: true,
    requiresBaseUrl: false,
    envNote: "Create a key at aistudio.google.com.",
  },
  {
    id: OPENAI_COMPATIBLE_PROVIDER,
    label: "OpenAI Compatible",
    apiKeyEnvVar: "OPENAI_COMPATIBLE_API_KEY",
    apiKeyRequired: false,
    requiresBaseUrl: true,
    envNote:
      "Any endpoint speaking the OpenAI chat-completions API — Ollama, vLLM, LM Studio, Groq, " +
      "OpenRouter, DeepSeek. Local servers usually need no key.",
  },
] as const satisfies readonly ProviderDef[];

export type ProviderId = (typeof PROVIDERS)[number]["id"];

export function isSupportedProvider(id: string): id is ProviderId {
  return PROVIDERS.some((p) => p.id === id);
}

export function getProviderDef(id: ProviderId): ProviderDef {
  return PROVIDERS.find((p) => p.id === id) as ProviderDef;
}

export function providerRequiresBaseUrl(id: string): boolean {
  return isSupportedProvider(id) && getProviderDef(id).requiresBaseUrl;
}

export type ValidationResult<T> = { ok: true; value: T } | { ok: false; error: string };

export function parseProvider(raw: string): ValidationResult<ProviderId> {
  const trimmed = raw.trim();
  if (!isSupportedProvider(trimmed)) {
    return {
      ok: false,
      error: `"${raw}" is not a supported provider. Choose one of: ${PROVIDERS.map((p) => p.id).join(", ")}.`,
    };
  }
  return { ok: true, value: trimmed };
}

export function parseModelName(raw: string): ValidationResult<string> {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { ok: false, error: "Enter a model name." };
  }
  return { ok: true, value: trimmed };
}

export function parseBaseUrl(raw: string): ValidationResult<string> {
  const trimmed = raw.trim().replace(/\/+$/, "");
  if (!trimmed) {
    return { ok: false, error: "Enter the endpoint's base URL (e.g. http://localhost:11434/v1)." };
  }
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { ok: false, error: `"${raw}" is not a valid URL.` };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { ok: false, error: "The base URL must start with http:// or https://." };
  }
  return { ok: true, value: trimmed };
}

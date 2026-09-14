import * as configRepo from "@/lib/repositories/configRepository";
import {
  MODEL_NAME_KEY,
  MODEL_PROVIDER_KEY,
  OPENAI_COMPATIBLE_BASE_URL_KEY,
  parseBaseUrl,
  parseModelName,
  parseProvider,
  providerRequiresBaseUrl,
  type ProviderId,
} from "@/lib/config/modelSettings";

export interface ModelSettings {
  provider: ProviderId;
  model: string;
  baseUrl: string | null;
}

export class ModelSettingsError extends Error {
  readonly field: string;
  constructor(field: string, message: string) {
    super(message);
    this.name = "ModelSettingsError";
    this.field = field;
  }
}

export class ModelNotConfiguredError extends Error {
  constructor() {
    super("No model provider is configured. Choose one in Settings.");
    this.name = "ModelNotConfiguredError";
  }
}

// These keys are deliberately absent from the agent's config catalog, so `set_config` cannot
// reach them and the agent cannot change which model it runs on.
export async function readModelSettings(): Promise<ModelSettings | null> {
  const [providerRow, modelRow, baseUrlRow] = await Promise.all([
    configRepo.get(MODEL_PROVIDER_KEY),
    configRepo.get(MODEL_NAME_KEY),
    configRepo.get(OPENAI_COMPATIBLE_BASE_URL_KEY),
  ]);

  const provider = parseProvider(providerRow?.value ?? "");
  if (!provider.ok) return null;

  const model = parseModelName(modelRow?.value ?? "");
  if (!model.ok) return null;

  const baseUrl = baseUrlRow?.value ?? null;
  if (providerRequiresBaseUrl(provider.value) && !baseUrl) return null;

  return { provider: provider.value, model: model.value, baseUrl };
}

export async function writeModelSettings(input: {
  provider: string;
  model: string;
  baseUrl?: string | null;
}): Promise<ModelSettings> {
  const provider = parseProvider(input.provider);
  if (!provider.ok) throw new ModelSettingsError("provider", provider.error);

  const model = parseModelName(input.model);
  if (!model.ok) throw new ModelSettingsError("model", model.error);

  let baseUrl: string | null = null;
  if (providerRequiresBaseUrl(provider.value)) {
    const parsed = parseBaseUrl(input.baseUrl ?? "");
    if (!parsed.ok) throw new ModelSettingsError("baseUrl", parsed.error);
    baseUrl = parsed.value;
  }

  await configRepo.set(MODEL_PROVIDER_KEY, provider.value);
  await configRepo.set(MODEL_NAME_KEY, model.value);
  if (baseUrl) await configRepo.set(OPENAI_COMPATIBLE_BASE_URL_KEY, baseUrl);

  return { provider: provider.value, model: model.value, baseUrl };
}

import { ChatOpenAI } from "@langchain/openai";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { ChatAnthropic } from "@langchain/anthropic";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { OPENAI_COMPATIBLE_PROVIDER, PROVIDERS } from "@/lib/config/modelSettings";

export { OPENAI_COMPATIBLE_PROVIDER };

export interface CreateChatModelOptions {
  provider: string;
  model: string;
  temperature?: number;
  baseUrl?: string | null;
}

const NO_API_KEY_NEEDED = "not-needed";

export function createChatModel({
  provider,
  model,
  temperature = 1,
  baseUrl,
}: CreateChatModelOptions): BaseChatModel {
  switch (provider) {
    case "openai":
      return new ChatOpenAI({ model, temperature });
    case "anthropic":
      return new ChatAnthropic({ model, temperature });
    case "google":
      return new ChatGoogleGenerativeAI({ model, temperature });
    case OPENAI_COMPATIBLE_PROVIDER:
      return createOpenAICompatibleModel({ model, temperature, baseUrl });
    default:
      throw new Error(
        `Unknown model provider "${provider}". Expected one of: ${PROVIDERS.map((p) => p.id).join(", ")}.`,
      );
  }
}

function createOpenAICompatibleModel({
  model,
  temperature,
  baseUrl,
}: {
  model: string;
  temperature: number;
  baseUrl?: string | null;
}): BaseChatModel {
  if (!baseUrl) {
    throw new Error(
      `Provider "${OPENAI_COMPATIBLE_PROVIDER}" requires a base URL. Set one in Settings.`,
    );
  }
  if (!model) {
    throw new Error(`Provider "${OPENAI_COMPATIBLE_PROVIDER}" requires a model name.`);
  }

  return new ChatOpenAI({
    model,
    temperature,
    // Explicit: left undefined, ChatOpenAI would send OPENAI_API_KEY to this third-party URL.
    apiKey: process.env.OPENAI_COMPATIBLE_API_KEY || NO_API_KEY_NEEDED,
    configuration: { baseURL: baseUrl },
  });
}

export function needsSchemaSanitizing(provider: string): boolean {
  if (provider === "google") return true;
  if (provider === OPENAI_COMPATIBLE_PROVIDER) {
    return process.env.OPENAI_COMPATIBLE_SANITIZE_SCHEMA === "true";
  }
  return false;
}

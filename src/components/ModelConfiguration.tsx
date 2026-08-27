import { useState } from "react";
import { BrainCog } from "lucide-react";
import Image from "next/image";

interface ModelConfigurationProps {
  provider: string;
  setProvider: (provider: string) => void;
  model: string;
  setModel: (model: string) => void;
}

const PROVIDER_DEFAULT_MODEL: Record<string, string> = {
  google: "gemini-3-flash-preview",
  openai: "gpt-4o",
  anthropic: "claude-haiku-4-5",
};

export const ModelConfiguration = ({
  provider,
  setProvider,
  model,
  setModel,
}: ModelConfigurationProps) => {
  const [imgError, setImgError] = useState(false);

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <label className="text-muted-foreground block font-mono text-[10px] tracking-[0.12em]">
          PROVIDER
        </label>
        <div className="flex items-center gap-2.5">
          <span className="bg-muted inline-flex h-6 w-6 items-center justify-center overflow-hidden rounded">
            {!imgError && (
              <Image
                src={`/${provider.toLowerCase()}.svg`}
                alt={provider}
                width={24}
                height={24}
                className="object-contain p-0.5"
                onError={() => setImgError(true)}
              />
            )}
            {imgError && <BrainCog className="h-4 w-4" />}
          </span>
          <select
            value={provider}
            onChange={(e) => {
              const newProvider = e.target.value;
              setImgError(false);
              setProvider(newProvider);
              setModel(PROVIDER_DEFAULT_MODEL[newProvider] ?? "");
            }}
            className="border-border bg-background focus:border-brand focus:ring-brand flex-1 rounded-md border px-3 py-1.5 text-sm focus:ring-1 focus:outline-none"
          >
            <option value="google">Google</option>
            <option value="openai">OpenAI</option>
            <option value="anthropic">Anthropic</option>
          </select>
        </div>
      </div>

      <div className="space-y-1.5">
        <label className="text-muted-foreground block font-mono text-[10px] tracking-[0.12em]">
          MODEL
        </label>
        <input
          value={model}
          onChange={(e) => setModel(e.target.value)}
          placeholder="Enter model name"
          className="border-border bg-background focus:border-brand focus:ring-brand w-full rounded-md border px-3 py-1.5 font-mono text-sm focus:ring-1 focus:outline-none"
        />
      </div>
    </div>
  );
};

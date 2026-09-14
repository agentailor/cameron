"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Loader2 } from "lucide-react";
import { useModelSettings } from "@/hooks/useModelSettings";
import type { ProviderInfo } from "@/services/chatService";

const field =
  "border-border bg-background focus:border-brand focus:ring-brand w-full rounded-md border px-3 py-1.5 text-sm focus:ring-1 focus:outline-none";
const label = "text-muted-foreground block font-mono text-[10px] tracking-[0.12em]";

export const ModelSettingsForm = () => {
  const { settings, isLoading, save, isSaving, saveError } = useModelSettings();

  const [provider, setProvider] = useState("");
  const [model, setModel] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [saved, setSaved] = useState(false);
  const seeded = useRef(false);

  // Seed once: a refetch after saving would otherwise overwrite what the owner is editing.
  useEffect(() => {
    if (!settings || seeded.current) return;
    seeded.current = true;
    setProvider(settings.provider ?? "");
    setModel(settings.model ?? "");
    setBaseUrl(settings.baseUrl ?? "");
  }, [settings]);

  const providers: ProviderInfo[] = settings?.providers ?? [];
  const selected = providers.find((p) => p.id === provider);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaved(false);
    try {
      await save({ provider, model, baseUrl: baseUrl || null });
      setSaved(true);
    } catch {
      // Surfaced through saveError.
    }
  };

  if (isLoading) {
    return <p className="text-muted-foreground text-sm">Loading…</p>;
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-1.5">
        <label htmlFor="provider" className={label}>
          PROVIDER
        </label>
        <select
          id="provider"
          value={provider}
          onChange={(e) => {
            const next = e.target.value;
            setProvider(next);
            // A model name from the previous provider would be silently wrong for the new one.
            const restoring = next === settings?.provider;
            setModel(restoring ? (settings?.model ?? "") : "");
            setBaseUrl(restoring ? (settings?.baseUrl ?? "") : "");
            setSaved(false);
          }}
          className={field}
        >
          <option value="">Select a provider…</option>
          {providers.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
      </div>

      <div className="space-y-1.5">
        <label htmlFor="model" className={label}>
          MODEL
        </label>
        <input
          id="model"
          value={model}
          onChange={(e) => {
            setModel(e.target.value);
            setSaved(false);
          }}
          placeholder="e.g. claude-haiku-4-5"
          className={`${field} font-mono`}
        />
      </div>

      {selected?.requiresBaseUrl && (
        <div className="space-y-1.5">
          <label htmlFor="baseUrl" className={label}>
            BASE URL
          </label>
          <input
            id="baseUrl"
            value={baseUrl}
            onChange={(e) => {
              setBaseUrl(e.target.value);
              setSaved(false);
            }}
            placeholder="http://localhost:11434/v1"
            className={`${field} font-mono`}
          />
        </div>
      )}

      {selected && (
        <div className="border-border bg-muted/40 rounded-lg border p-3">
          <p className="text-muted-foreground text-xs leading-relaxed">{selected.envNote}</p>
          <p className="text-muted-foreground mt-2 text-xs leading-relaxed">
            Set the API key as an environment variable — Cameron never stores it:
          </p>
          <pre className="text-foreground mt-2 overflow-x-auto font-mono text-xs">
            {selected.apiKeyEnvVar}=your_key_here
            {!selected.apiKeyRequired && "   # optional for local endpoints"}
          </pre>
          <p className="text-muted-foreground mt-2 text-xs leading-relaxed">
            Add it to <code className="font-mono">.env.local</code> and restart the server. If a
            message fails, check this key and the base URL.
          </p>
        </div>
      )}

      {saveError && <p className="text-sm text-red-600">{saveError}</p>}

      {saved && !isSaving && (
        <div className="border-term-green/40 bg-term-green/10 flex items-center gap-2 rounded-md border px-3 py-2">
          <Check className="text-term-green h-4 w-4 shrink-0" />
          <p className="text-foreground text-sm font-medium">
            Settings saved — Cameron now uses {model}.
          </p>
        </div>
      )}

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={isSaving}
          className="bg-brand text-brand-foreground hover:bg-brand-bright inline-flex cursor-pointer items-center gap-2 rounded-md px-3 py-1.5 text-sm disabled:opacity-60"
        >
          {isSaving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          Save
        </button>
      </div>
    </form>
  );
};

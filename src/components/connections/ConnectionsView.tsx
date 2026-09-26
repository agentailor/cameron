"use client";

import { useEffect, useState } from "react";
import { Check, Loader2, Plus } from "lucide-react";
import { useMCPServers } from "@/hooks/useMCPServers";
import { ServerCard } from "./ServerCard";
import { ServerForm } from "./ServerForm";
import { primaryButton } from "./styles";

const sectionLabel = "text-muted-foreground text-xs font-semibold tracking-wide uppercase";

export function ConnectionsView() {
  const { servers, isLoading, loadError, create, update, setEnabled, remove, refresh } =
    useMCPServers();
  const [adding, setAdding] = useState(false);
  const [added, setAdded] = useState<string | null>(null);

  const names = servers?.map((s) => s.name) ?? [];
  const empty = servers?.length === 0;

  // With nothing connected, adding is the only thing to do. Latched in state rather than derived
  // from `empty`, so the first server of a multi-server paste doesn't close the form mid-batch.
  useEffect(() => {
    if (empty) setAdding(true);
  }, [empty]);

  const finish = (message: string) => {
    setAdding(false);
    setAdded(message);
  };

  return (
    <section className="mt-10">
      <div className="flex min-h-8 items-center justify-between gap-3">
        <h2 className={sectionLabel}>MCP servers{servers?.length ? ` · ${servers.length}` : ""}</h2>
        {!adding && !isLoading && !loadError && (
          <button
            type="button"
            onClick={() => {
              setAdded(null);
              setAdding(true);
            }}
            className={primaryButton}
          >
            <Plus className="h-3.5 w-3.5" />
            Add server
          </button>
        )}
      </div>

      {added && (
        <div className="border-term-green/40 bg-term-green/10 mt-3 flex items-center gap-2 rounded-md border px-3 py-2">
          <Check className="text-term-green h-4 w-4 shrink-0" />
          <p className="text-foreground text-sm">{added}</p>
        </div>
      )}

      {adding && (
        <div className="border-border mt-3 rounded-lg border bg-white p-4">
          {empty && (
            <p className="text-muted-foreground mb-4 text-sm leading-relaxed">
              Nothing connected yet. The quickest way to add a server is to paste the config from
              its README.
            </p>
          )}
          <ServerForm
            existingNames={names}
            submitLabel="Add server"
            onSave={async (input) => {
              await create(input);
            }}
            onSaved={(input) => finish(`Added ${input.name}. Open its tools to check it connects.`)}
            onBatchDone={(count) =>
              finish(
                `Added ${count} server${count === 1 ? "" : "s"}. Open their tools to check they connect.`,
              )
            }
            onCancel={empty ? undefined : () => setAdding(false)}
          />
        </div>
      )}

      {isLoading ? (
        <p className="text-muted-foreground mt-3 inline-flex items-center gap-2 text-sm">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading…
        </p>
      ) : loadError ? (
        <p className="text-destructive mt-3 text-sm">Couldn&apos;t load servers: {loadError}</p>
      ) : servers?.length ? (
        <ul className="mt-3 space-y-3">
          {servers.map((server) => (
            <ServerCard
              key={server.id}
              server={server}
              otherNames={names.filter((n) => n !== server.name)}
              onUpdate={(input) => update(server.id, input)}
              onToggle={(enabled) => setEnabled(server.id, enabled)}
              onDelete={() => remove(server.id)}
              onOAuthChecked={refresh}
            />
          ))}
        </ul>
      ) : null}
    </section>
  );
}

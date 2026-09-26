"use client";

import { useState } from "react";
import { Check, Loader2, Plug } from "lucide-react";
import { useMCPServers } from "@/hooks/useMCPServers";
import { ServerCard } from "./ServerCard";
import { ServerForm } from "./ServerForm";

const sectionLabel = "text-muted-foreground text-xs font-semibold tracking-wide uppercase";

export function ConnectionsView() {
  const { servers, isLoading, loadError, create, update, setEnabled, remove, refresh } =
    useMCPServers();
  const [added, setAdded] = useState<string | null>(null);

  const names = servers?.map((s) => s.name) ?? [];

  return (
    <>
      <section className="mt-10">
        <h2 className={sectionLabel}>MCP servers{servers?.length ? ` · ${servers.length}` : ""}</h2>

        {isLoading ? (
          <p className="text-muted-foreground mt-3 inline-flex items-center gap-2 text-sm">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading…
          </p>
        ) : loadError ? (
          <p className="text-destructive mt-3 text-sm">Couldn&apos;t load servers: {loadError}</p>
        ) : !servers?.length ? (
          <div className="border-border mt-3 flex items-start gap-3 rounded-lg border border-dashed p-4">
            <Plug className="text-muted-foreground mt-0.5 h-4 w-4 shrink-0" />
            <p className="text-muted-foreground text-sm leading-relaxed">
              Nothing connected yet. Add a server below. The quickest way is to paste the config
              from the server&apos;s README.
            </p>
          </div>
        ) : (
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
        )}
      </section>

      <section className="mt-10">
        <h2 className={sectionLabel}>Add a server</h2>
        <div className="border-border mt-3 rounded-lg border bg-white p-4">
          <ServerForm
            existingNames={names}
            submitLabel="Add server"
            onSave={async (input) => {
              setAdded(null);
              await create(input);
            }}
            onSaved={(input) =>
              setAdded(`Added ${input.name}. Open its tools to check it connects.`)
            }
            onBatchDone={(count) =>
              setAdded(
                `Added ${count} server${count === 1 ? "" : "s"}. Open their tools to check they connect.`,
              )
            }
          />
          {added && (
            <div className="border-term-green/40 bg-term-green/10 mt-4 flex items-center gap-2 rounded-md border px-3 py-2">
              <Check className="text-term-green h-4 w-4 shrink-0" />
              <p className="text-foreground text-sm">{added}</p>
            </div>
          )}
        </div>
      </section>
    </>
  );
}

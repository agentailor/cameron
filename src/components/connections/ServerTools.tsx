"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight, Loader2, RotateCw } from "lucide-react";
import { useServerTools } from "@/hooks/useMCPServers";
import { ServerToolsError, type ServerToolsErrorCode } from "@/services/mcpService";
import { linkButton } from "./styles";

const FAILURE: Record<ServerToolsErrorCode, string> = {
  not_found: "This server no longer exists.",
  auth_required: "Connect with OAuth first, then list its tools.",
  invalid_config: "The configuration is incomplete.",
  timeout: "The server didn't respond in time.",
  connect_failed: "Couldn't connect to the server.",
};

/**
 * The server's tools, fetched only when opened: listing them means connecting to the server
 * (for stdio, starting its process), so nothing connects just because the page loaded.
 */
export function ServerTools({ serverId, enabled }: { serverId: string; enabled: boolean }) {
  const [open, setOpen] = useState(false);
  const { data: tools, error, isFetching, refetch } = useServerTools(serverId, open);

  const failure = error instanceof ServerToolsError ? error : null;

  return (
    <div>
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className={linkButton}
        >
          {open ? (
            <ChevronDown className="h-3.5 w-3.5" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5" />
          )}
          tools
          {open && tools && !isFetching && <span>· {tools.length}</span>}
        </button>
        {open && !isFetching && (tools || error) && (
          <button type="button" onClick={() => refetch()} className={linkButton}>
            <RotateCw className="h-3 w-3" />
            reload
          </button>
        )}
      </div>

      {open && (
        <div className="mt-2.5">
          {isFetching ? (
            <p className="text-muted-foreground inline-flex items-center gap-2 font-mono text-[11px]">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              connecting…
            </p>
          ) : error ? (
            <div className="border-destructive/30 bg-destructive/5 rounded-md border px-3 py-2">
              <p className="text-destructive text-sm">
                {failure ? FAILURE[failure.code] : "Couldn't list the tools."}
              </p>
              <p className="text-muted-foreground mt-1 font-mono text-[11px] break-words">
                {error.message}
              </p>
            </div>
          ) : tools && tools.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              Connected, but this server offers no tools.
            </p>
          ) : tools ? (
            <>
              {!enabled && (
                <p className="text-muted-foreground mb-2 text-xs">
                  This server is off — Cameron isn&apos;t using these yet.
                </p>
              )}
              <ul className="border-border divide-border divide-y rounded-md border">
                {tools.map((tool) => (
                  <li key={tool.name} className="px-3 py-2">
                    <code className="text-foreground font-mono text-xs">{tool.name}</code>
                    {tool.description && (
                      <p className="text-muted-foreground mt-0.5 line-clamp-2 text-xs leading-relaxed">
                        {tool.description}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </div>
      )}
    </div>
  );
}

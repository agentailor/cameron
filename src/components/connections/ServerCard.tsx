"use client";

import { useState } from "react";
import { Link2, Loader2, Pencil, Trash2 } from "lucide-react";
import { OAuthStatusBadge } from "@/components/OAuthStatusBadge";
import type { ServerInput } from "@/lib/mcp/configParse";
import { OAuthStatus } from "@/lib/mcp/oauth-status";
import { checkOAuth, inputFromServer, type MCPServerView } from "@/services/mcpService";
import { ServerForm } from "./ServerForm";
import { ServerTools } from "./ServerTools";
import { chip, iconButton, secondaryButton } from "./styles";

interface ServerCardProps {
  server: MCPServerView;
  otherNames: string[];
  onUpdate: (input: ServerInput) => Promise<unknown>;
  onToggle: (enabled: boolean) => void;
  onDelete: () => Promise<unknown>;
  onOAuthChecked: () => void;
}

type Mode = "view" | "edit" | "confirm-delete";

const NEEDS_CONNECT = new Set<string>([
  OAuthStatus.REQUIRED,
  OAuthStatus.EXPIRED,
  OAuthStatus.UNKNOWN,
]);

export function ServerCard({
  server,
  otherNames,
  onUpdate,
  onToggle,
  onDelete,
  onOAuthChecked,
}: ServerCardProps) {
  const [mode, setMode] = useState<Mode>("view");
  const [busy, setBusy] = useState<"delete" | "oauth" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const input = inputFromServer(server);
  const target = server.type === "stdio" ? [input.command, ...input.args].join(" ") : input.url;
  const secrets = countLabel(
    Object.keys(server.type === "stdio" ? input.env : input.headers).length,
    server.type === "stdio" ? "env var" : "header",
  );

  const remove = async () => {
    setBusy("delete");
    setError(null);
    try {
      await onDelete();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete");
      setBusy(null);
    }
  };

  const connect = async () => {
    setBusy("oauth");
    setError(null);
    try {
      const result = await checkOAuth(server.id);
      if (result.authorizationUrl) {
        // Read by OAuthToast when the provider redirects back.
        sessionStorage.setItem("oauth_return_path", "/connections");
        window.location.href = result.authorizationUrl;
        return;
      }
      if (result.error) setError(result.error);
      onOAuthChecked();
    } catch (e) {
      setError(e instanceof Error ? e.message : "OAuth check failed");
    }
    setBusy(null);
  };

  return (
    <li className="border-border rounded-lg border bg-white">
      <div className="flex items-center gap-3 px-4 pt-3.5">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
          <span
            className={`font-mono text-sm font-medium ${server.enabled ? "text-foreground" : "text-muted-foreground"}`}
          >
            {server.name}
          </span>
          <span className={chip}>{server.type}</span>
          {server.type === "http" && <OAuthStatusBadge status={server.oauthStatus} />}
        </div>

        {server.type === "http" && server.oauthStatus && NEEDS_CONNECT.has(server.oauthStatus) && (
          <button
            type="button"
            onClick={connect}
            disabled={busy !== null}
            className={`${secondaryButton} px-2.5 py-1 text-xs`}
          >
            {busy === "oauth" ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Link2 className="h-3.5 w-3.5" />
            )}
            {server.oauthStatus === OAuthStatus.UNKNOWN ? "Check auth" : "Connect"}
          </button>
        )}

        <label className="text-muted-foreground inline-flex cursor-pointer items-center gap-2 font-mono text-[10px]">
          {server.enabled ? "on" : "off"}
          <button
            type="button"
            role="switch"
            aria-checked={server.enabled}
            aria-label={`${server.enabled ? "Disable" : "Enable"} ${server.name}`}
            onClick={() => onToggle(!server.enabled)}
            className={`focus-visible:ring-brand relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full transition-colors focus-visible:ring-2 focus-visible:outline-none ${
              server.enabled ? "bg-foreground" : "bg-border"
            }`}
          >
            <span
              className={`bg-card block h-4 w-4 rounded-full shadow-sm transition-transform ${
                server.enabled ? "translate-x-[18px]" : "translate-x-0.5"
              }`}
            />
          </button>
        </label>

        <div className="flex items-center">
          <button
            type="button"
            onClick={() => setMode(mode === "edit" ? "view" : "edit")}
            aria-pressed={mode === "edit"}
            className={iconButton}
            aria-label={`Edit ${server.name}`}
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => setMode("confirm-delete")}
            className={`${iconButton} hover:text-destructive`}
            aria-label={`Delete ${server.name}`}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <div className="px-4 pt-1 pb-3.5">
        {mode === "edit" ? (
          <div className="border-border mt-3 border-t pt-4">
            <ServerForm
              initial={input}
              existingNames={otherNames}
              submitLabel="Save changes"
              onSave={async (next) => {
                await onUpdate(next);
                setMode("view");
              }}
              onCancel={() => setMode("view")}
            />
          </div>
        ) : (
          <>
            <p className="text-muted-foreground truncate font-mono text-xs" title={target}>
              {target}
            </p>
            {secrets && <p className="text-muted-foreground mt-0.5 text-xs">{secrets}</p>}

            {mode === "confirm-delete" && (
              <div className="border-destructive/30 bg-destructive/5 mt-3 flex flex-wrap items-center gap-3 rounded-md border px-3 py-2">
                <p className="text-foreground flex-1 text-sm">
                  Delete <span className="font-mono">{server.name}</span>? Cameron loses its tools
                  from the next message.
                </p>
                <button
                  type="button"
                  onClick={() => setMode("view")}
                  disabled={busy === "delete"}
                  className={`${secondaryButton} px-2.5 py-1 text-xs`}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={remove}
                  disabled={busy === "delete"}
                  className="bg-destructive inline-flex cursor-pointer items-center gap-1.5 rounded-md px-2.5 py-1 text-xs text-white transition-opacity hover:opacity-90 disabled:opacity-60"
                >
                  {busy === "delete" && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  Delete
                </button>
              </div>
            )}

            <div className="mt-3">
              <ServerTools serverId={server.id} enabled={server.enabled} />
            </div>
          </>
        )}

        {error && <p className="text-destructive mt-2 text-sm">{error}</p>}
      </div>
    </li>
  );
}

function countLabel(count: number, noun: string): string | null {
  return count ? `${count} ${noun}${count === 1 ? "" : "s"}` : null;
}

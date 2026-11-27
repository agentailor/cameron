"use client";

import { useState } from "react";
import { ChevronRight } from "lucide-react";
import type { OAuthDraft } from "@/lib/mcp/configParse";
import { CallbackUrl } from "./CallbackUrl";
import { KeyValueEditor } from "./KeyValueEditor";
import { field, fieldError, fieldLabel, linkButton } from "./styles";

interface OAuthClientFieldsProps {
  id: string;
  value: OAuthDraft;
  onChange: (value: OAuthDraft) => void;
  callbackUrl: string | null;
  error?: string;
}

/**
 * An optional pre-registered OAuth client for a remote server. Empty keeps dynamic client
 * registration. Collapsed unless a client is set.
 */
export function OAuthClientFields({
  id,
  value,
  onChange,
  callbackUrl,
  error,
}: OAuthClientFieldsProps) {
  const [open, setOpen] = useState(() => !!value.clientId);
  const set = (patch: Partial<OAuthDraft>) => onChange({ ...value, ...patch });

  return (
    <div className="border-border rounded-md border">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-left"
      >
        <ChevronRight
          className={`text-muted-foreground h-3.5 w-3.5 transition-transform ${open ? "rotate-90" : ""}`}
        />
        <span className={fieldLabel}>OAUTH CLIENT</span>
        <span className="text-muted-foreground text-xs">
          {value.clientId ? (
            <span className="font-mono">{value.clientId}</span>
          ) : (
            "optional · for servers that can't register Cameron themselves"
          )}
        </span>
      </button>

      {open && (
        <div className="border-border space-y-4 border-t px-3 pt-3 pb-3.5">
          <p className="text-muted-foreground text-xs leading-relaxed">
            Most servers register Cameron on their own: leave this empty for them. Servers whose
            authorization server has no dynamic registration need a client you create on their side;
            enter its details here.
          </p>

          <div className="space-y-1.5">
            <span className={fieldLabel}>CALLBACK URL</span>
            <CallbackUrl url={callbackUrl} />
            <p className="text-muted-foreground text-xs">
              Add this exact URL as an authorized redirect URI on your OAuth client. It is the same
              for every server.
            </p>
          </div>

          <div className="space-y-1.5">
            <label htmlFor={`${id}-client-id`} className={fieldLabel}>
              CLIENT ID
            </label>
            <input
              id={`${id}-client-id`}
              value={value.clientId}
              onChange={(e) => set({ clientId: e.target.value })}
              placeholder="your-client-id"
              autoComplete="off"
              className={`${field} font-mono`}
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor={`${id}-client-secret`} className={fieldLabel}>
              CLIENT SECRET
            </label>
            <input
              id={`${id}-client-secret`}
              type="password"
              value={value.clientSecret}
              onChange={(e) => set({ clientSecret: e.target.value, removeSecret: false })}
              placeholder={
                value.secretStored && !value.removeSecret
                  ? "Stored · leave empty to keep it"
                  : "Leave empty for a public client"
              }
              autoComplete="new-password"
              className={`${field} font-mono`}
            />
            {value.secretStored && !value.clientSecret && (
              <p className="text-muted-foreground text-xs">
                {value.removeSecret ? (
                  <>
                    The stored secret will be removed on save.{" "}
                    <button
                      type="button"
                      className={linkButton}
                      onClick={() => set({ removeSecret: false })}
                    >
                      keep it
                    </button>
                  </>
                ) : (
                  <>
                    Encrypted in your database; never shown again.{" "}
                    <button
                      type="button"
                      className={linkButton}
                      onClick={() => set({ removeSecret: true })}
                    >
                      remove it
                    </button>
                  </>
                )}
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <label htmlFor={`${id}-scope`} className={fieldLabel}>
              SCOPES
            </label>
            <input
              id={`${id}-scope`}
              value={value.scope}
              onChange={(e) => set({ scope: e.target.value })}
              placeholder="scope-a scope-b"
              autoComplete="off"
              className={`${field} font-mono`}
            />
            <p className="text-muted-foreground text-xs">
              Space-separated. Empty lets the server choose, which can mean every scope it offers.
            </p>
          </div>

          <div className="space-y-1.5">
            <label htmlFor={`${id}-params`} className={fieldLabel}>
              AUTHORIZATION PARAMETERS
            </label>
            <KeyValueEditor
              id={`${id}-params`}
              rows={value.params}
              onChange={(params) => set({ params })}
              keyPlaceholder="access_type"
              valuePlaceholder="offline"
              addLabel="add parameter"
              masked={false}
            />
            <p className="text-muted-foreground text-xs">
              Extra query parameters for the sign-in URL, if the authorization server documents any
              (e.g. to issue a refresh token).
            </p>
          </div>

          {error && <p className={fieldError}>{error}</p>}
        </div>
      )}
      {!open && error && <p className={`${fieldError} px-3 pb-2`}>{error}</p>}
    </div>
  );
}

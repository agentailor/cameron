"use client";

import { useEffect, useId, useState } from "react";
import { Globe, Loader2, Terminal } from "lucide-react";
import {
  draftFromInput,
  emptyDraft,
  inputFromDraft,
  looksLikeJson,
  parseServerConfig,
  serializeServers,
  splitCommandLine,
  validateDraft,
  type ParsedEntry,
  type ServerDraft,
  type ServerInput,
  type ServerTransport,
} from "@/lib/mcp/configParse";
import { ArgsEditor } from "./ArgsEditor";
import { BatchReview } from "./BatchReview";
import { JsonEditor, type JsonStatus } from "./JsonEditor";
import { KeyValueEditor } from "./KeyValueEditor";
import { field, fieldError, fieldLabel, primaryButton, secondaryButton } from "./styles";

interface ServerFormProps {
  /** The server being edited; omit to add a new one. */
  initial?: ServerInput;
  /** Names taken by OTHER servers. */
  existingNames: string[];
  submitLabel: string;
  onSave: (input: ServerInput) => Promise<void>;
  /** After a single save from the form (not per server of a batch). */
  onSaved?: (input: ServerInput) => void;
  onCancel?: () => void;
  /** Enables multi-server pastes (adding only). */
  onBatchDone?: (added: number) => void;
}

type Tab = "form" | "json";
type Notice = { tone: "info" | "error"; text: string } | null;

const TRANSPORTS: { id: ServerTransport; label: string; hint: string; Icon: typeof Terminal }[] = [
  {
    id: "stdio",
    label: "Local command",
    hint: "Cameron starts it on this machine",
    Icon: Terminal,
  },
  { id: "http", label: "Remote URL", hint: "Cameron connects to a running server", Icon: Globe },
];

const isPristine = (draft: ServerDraft) => JSON.stringify(draft) === JSON.stringify(emptyDraft());

export function ServerForm({
  initial,
  existingNames,
  submitLabel,
  onSave,
  onSaved,
  onCancel,
  onBatchDone,
}: ServerFormProps) {
  const uid = useId();
  const editing = !!initial;
  const [tab, setTab] = useState<Tab>("form");
  const [draft, setDraft] = useState<ServerDraft>(() =>
    initial ? draftFromInput(initial) : emptyDraft(),
  );
  const [json, setJson] = useState("");
  const [jsonStatus, setJsonStatus] = useState<JsonStatus>(null);
  const [showErrors, setShowErrors] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [batch, setBatch] = useState<ParsedEntry[] | null>(null);

  const errors = validateDraft(draft, existingNames);
  const shown = showErrors ? errors : {};

  const update = (patch: Partial<ServerDraft>) => {
    setDraft((d) => ({ ...d, ...patch }));
    setSaveError(null);
  };

  useEffect(() => {
    if (tab !== "json") return;
    const timer = setTimeout(() => setJsonStatus(describeJson(json, editing || !onBatchDone)), 250);
    return () => clearTimeout(timer);
  }, [json, tab, editing, onBatchDone]);

  const reset = () => {
    setDraft(emptyDraft());
    setJson("");
    setJsonStatus(null);
    setShowErrors(false);
    setNotice(null);
  };

  /** Loads parsed servers: one fills the form, several open the review. */
  const accept = (entries: ParsedEntry[]): boolean => {
    if (entries.length > 1) {
      if (editing || !onBatchDone) {
        setNotice({
          tone: "error",
          text: `That holds ${entries.length} servers — edit one at a time.`,
        });
        return false;
      }
      setNotice(null);
      setBatch(entries);
      return true;
    }
    const [entry] = entries;
    if ("error" in entry) {
      setNotice({ tone: "error", text: `Couldn't read that server: ${entry.error}` });
      return false;
    }
    // A bare server object has no name; keep the one already typed.
    setDraft(draftFromInput({ ...entry.input, name: entry.input.name || draft.name }));
    setTab("form");
    return true;
  };

  const switchTab = (next: Tab) => {
    if (next === tab) return;
    setNotice(null);
    if (next === "json") {
      setJson(isPristine(draft) ? "" : serializeServers([inputFromDraft(draft)]));
      setTab("json");
      return;
    }
    if (!json.trim()) {
      setTab("form");
      return;
    }
    const result = parseServerConfig(json);
    if (!result.ok) {
      setJsonStatus({ tone: "error", text: result.error });
      setNotice({ tone: "error", text: "Fix the JSON to switch back to the form." });
      return;
    }
    accept(result.entries);
  };

  const handleFormPaste = (e: React.ClipboardEvent) => {
    if (tab !== "form") return;
    const text = e.clipboardData.getData("text");
    if (!looksLikeJson(text)) return;
    const result = parseServerConfig(text);
    if (!result.ok) return;
    e.preventDefault();
    if (accept(result.entries) && result.entries.length === 1) {
      setNotice({ tone: "info", text: "Filled in from the pasted config. Check it, then save." });
    }
  };

  // A whole command line pasted into the command field fills the arguments too.
  const handleCommandPaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    const text = e.clipboardData.getData("text");
    if (looksLikeJson(text) || !/\s/.test(text.trim())) return;
    e.preventDefault();
    const [command = "", ...args] = splitCommandLine(text);
    update({ command, args });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    let target = draft;

    if (tab === "json") {
      const result = parseServerConfig(json);
      if (!result.ok) {
        setJsonStatus({ tone: "error", text: result.error });
        return;
      }
      if (result.entries.length > 1) {
        accept(result.entries);
        return;
      }
      const [entry] = result.entries;
      if ("error" in entry) {
        setJsonStatus({ tone: "error", text: entry.error });
        return;
      }
      target = draftFromInput({ ...entry.input, name: entry.input.name || draft.name });
      if (Object.keys(validateDraft(target, existingNames)).length) {
        // Field-level errors read better on the form than as one JSON status line.
        setDraft(target);
        setTab("form");
        setShowErrors(true);
        setNotice({ tone: "error", text: "A few fields need fixing before this can be saved." });
        return;
      }
    } else if (Object.keys(errors).length) {
      setShowErrors(true);
      return;
    }

    setSaving(true);
    setSaveError(null);
    try {
      const input = inputFromDraft(target);
      await onSave(input);
      if (!editing) reset();
      onSaved?.(input);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  if (batch) {
    return (
      <BatchReview
        entries={batch}
        existingNames={existingNames}
        onSave={onSave}
        onBack={() => setBatch(null)}
        onDone={(added) => {
          setBatch(null);
          reset();
          onBatchDone?.(added);
        }}
      />
    );
  }

  return (
    <form onSubmit={handleSubmit} onPaste={handleFormPaste} className="space-y-5" noValidate>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div role="tablist" aria-label="Edit as" className="bg-muted inline-flex rounded-md p-0.5">
          {(["form", "json"] as const).map((id) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              onClick={() => switchTab(id)}
              className={`cursor-pointer rounded px-3 py-1 font-mono text-[11px] transition-colors ${
                tab === id
                  ? "bg-card text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {id === "form" ? "form" : "json"}
            </button>
          ))}
        </div>
        {!editing && tab === "form" && (
          <p className="text-muted-foreground text-xs">
            Have a config from a README? Paste it anywhere here.
          </p>
        )}
        {tab === "json" && (
          <p className="text-muted-foreground text-xs">Values show in plain text here.</p>
        )}
      </div>

      {notice && (
        <p
          role="status"
          className={`rounded-md border px-3 py-2 text-sm ${
            notice.tone === "error"
              ? "border-destructive/30 text-destructive bg-destructive/5"
              : "border-border bg-surface-warm text-foreground"
          }`}
        >
          {notice.text}
        </p>
      )}

      {tab === "json" ? (
        <JsonEditor
          value={json}
          onChange={(value) => {
            setJson(value);
            setSaveError(null);
            setNotice(null);
          }}
          status={jsonStatus}
        />
      ) : (
        <div className="space-y-5">
          <div className="space-y-1.5">
            <label htmlFor={`${uid}-name`} className={fieldLabel}>
              NAME
            </label>
            <input
              id={`${uid}-name`}
              value={draft.name}
              onChange={(e) => update({ name: e.target.value })}
              placeholder="filesystem"
              autoComplete="off"
              className={`${field} font-mono`}
            />
            {shown.name ? (
              <p className={fieldError}>{shown.name}</p>
            ) : (
              <p className="text-muted-foreground text-xs">
                Cameron sees its tools as{" "}
                <code className="font-mono">{draft.name.trim() || "name"}__tool</code>.
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <span className={fieldLabel}>TRANSPORT</span>
            <div role="radiogroup" aria-label="Transport" className="grid gap-2 sm:grid-cols-2">
              {TRANSPORTS.map(({ id, label, hint, Icon }) => {
                const active = draft.type === id;
                return (
                  <button
                    key={id}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => update({ type: id })}
                    className={`flex cursor-pointer items-start gap-2.5 rounded-md border px-3 py-2 text-left transition-colors ${
                      active
                        ? "border-foreground bg-card"
                        : "border-border hover:bg-accent text-muted-foreground"
                    }`}
                  >
                    <Icon className="mt-0.5 h-4 w-4 shrink-0" />
                    <span>
                      <span className="text-foreground block text-sm">{label}</span>
                      <span className="text-muted-foreground block text-xs">
                        {hint} · <span className="font-mono">{id}</span>
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {draft.type === "stdio" ? (
            <>
              <div className="space-y-1.5">
                <label htmlFor={`${uid}-command`} className={fieldLabel}>
                  COMMAND
                </label>
                <input
                  id={`${uid}-command`}
                  value={draft.command}
                  onChange={(e) => update({ command: e.target.value })}
                  onPaste={handleCommandPaste}
                  placeholder="npx"
                  autoComplete="off"
                  className={`${field} font-mono`}
                />
                {shown.command ? (
                  <p className={fieldError}>{shown.command}</p>
                ) : (
                  <p className="text-muted-foreground text-xs">
                    Paste a full command line to fill the arguments too.
                  </p>
                )}
              </div>

              <div className="space-y-1.5">
                <label htmlFor={`${uid}-args`} className={fieldLabel}>
                  ARGUMENTS
                </label>
                <ArgsEditor
                  id={`${uid}-args`}
                  args={draft.args}
                  onChange={(args) => update({ args })}
                />
              </div>

              <div className="space-y-1.5">
                <label htmlFor={`${uid}-env`} className={fieldLabel}>
                  ENVIRONMENT
                </label>
                <KeyValueEditor
                  id={`${uid}-env`}
                  rows={draft.env}
                  onChange={(env) => update({ env })}
                  keyPlaceholder="API_KEY"
                  addLabel="add variable"
                />
                {shown.env && <p className={fieldError}>{shown.env}</p>}
              </div>
            </>
          ) : (
            <>
              <div className="space-y-1.5">
                <label htmlFor={`${uid}-url`} className={fieldLabel}>
                  URL
                </label>
                <input
                  id={`${uid}-url`}
                  type="url"
                  value={draft.url}
                  onChange={(e) => update({ url: e.target.value })}
                  placeholder="https://example.com/mcp"
                  autoComplete="off"
                  className={`${field} font-mono`}
                />
                {shown.url && <p className={fieldError}>{shown.url}</p>}
              </div>

              <div className="space-y-1.5">
                <label htmlFor={`${uid}-headers`} className={fieldLabel}>
                  HEADERS
                </label>
                <KeyValueEditor
                  id={`${uid}-headers`}
                  rows={draft.headers}
                  onChange={(headers) => update({ headers })}
                  keyPlaceholder="Authorization"
                  addLabel="add header"
                />
                {shown.headers && <p className={fieldError}>{shown.headers}</p>}
              </div>
            </>
          )}

          {(draft.env.length > 0 || draft.headers.length > 0) && (
            <p className="text-muted-foreground text-xs">
              Values are hidden on screen but stored unencrypted in your database.
            </p>
          )}
        </div>
      )}

      {saveError && <p className="text-destructive text-sm">{saveError}</p>}

      <div className="flex items-center gap-2">
        <button type="submit" disabled={saving} className={primaryButton}>
          {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          {submitLabel}
        </button>
        {onCancel && (
          <button type="button" onClick={onCancel} disabled={saving} className={secondaryButton}>
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}

function describeJson(json: string, singleOnly: boolean): JsonStatus {
  if (!json.trim()) return null;
  const result = parseServerConfig(json);
  if (!result.ok) return { tone: "error", text: result.error };

  const { entries } = result;
  if (entries.length === 1) {
    const [entry] = entries;
    if ("error" in entry) return { tone: "error", text: entry.error };
    const name = entry.input.name || "unnamed";
    return { tone: "ok", text: `1 server · ${name} (${entry.input.type})` };
  }
  if (singleOnly) {
    return { tone: "error", text: `${entries.length} servers — edit one at a time.` };
  }
  const bad = entries.filter((e) => "error" in e).length;
  return bad
    ? {
        tone: "warn",
        text: `${entries.length} servers, ${bad} with a problem — review before adding.`,
      }
    : { tone: "ok", text: `${entries.length} servers — you'll choose which to add.` };
}

"use client";

import React, { useState } from "react";
import { ExternalLink, MessageSquareWarning } from "lucide-react";
import type { ElicitationCallbacks } from "@/types/message";
import {
  answerProblem,
  fieldKind,
  isUrlRequest,
  type ElicitationAnswer,
  type ElicitationProperty,
  type ElicitationRequest,
  type ElicitationValue,
  type FormRequest,
  type PendingElicitation,
} from "@/lib/mcp/elicitation";
import { field as inputClass, primaryButton } from "@/components/ui/formStyles";
import { secondaryButton } from "@/components/connections/styles";

/**
 * A connected server's question in the middle of a tool call (MCP elicitation). The call already
 * passed Cameron's approval; this one is the server's own, so the card says whose it is.
 * Its message is the server's text and may quote untrusted content (an email subject, say), so
 * only `**bold**` is rendered — never links, images or HTML.
 */

function ServerText({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return (
    <p className="text-foreground text-sm break-words whitespace-pre-wrap">
      {parts.map((part, i) =>
        /^\*\*[^*]+\*\*$/.test(part) ? (
          <strong key={i}>{part.slice(2, -2)}</strong>
        ) : (
          <React.Fragment key={i}>{part}</React.Fragment>
        ),
      )}
    </p>
  );
}

/** A form whose only field is one choice: each choice is a button that answers at once. */
function singleChoice(request: FormRequest) {
  const entries = Object.entries(request.requestedSchema.properties ?? {});
  if (entries.length !== 1) return null;
  const [key, property] = entries[0];
  const field = fieldKind(property);
  return field.kind === "choice" ? { key, property, choices: field.choices } : null;
}

function initialValue(property: ElicitationProperty): ElicitationValue | undefined {
  const d = property.default;
  if (typeof d === "string" || typeof d === "number" || typeof d === "boolean") return d;
  if (Array.isArray(d)) return d.map(String);
  return fieldKind(property).kind === "boolean" ? false : undefined;
}

function Field({
  name,
  property,
  value,
  onChange,
}: {
  name: string;
  property: ElicitationProperty;
  value: ElicitationValue | undefined;
  onChange: (v: ElicitationValue | undefined) => void;
}) {
  const field = fieldKind(property);
  const label = property.title ?? name;
  return (
    <label className="block space-y-1">
      <span className="text-foreground text-xs font-medium">{label}</span>
      {property.description && (
        <span className="text-muted-foreground block text-xs">{property.description}</span>
      )}
      {field.kind === "choice" && (
        <select
          className={inputClass}
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onChange(e.target.value || undefined)}
        >
          <option value="">Choose…</option>
          {field.choices.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
      )}
      {field.kind === "multi" && (
        <span className="flex flex-wrap gap-3">
          {field.choices.map((c) => {
            const list = Array.isArray(value) ? value : [];
            return (
              <span key={c.value} className="flex items-center gap-1.5 text-sm">
                <input
                  type="checkbox"
                  checked={list.includes(c.value)}
                  onChange={(e) =>
                    onChange(
                      e.target.checked ? [...list, c.value] : list.filter((v) => v !== c.value),
                    )
                  }
                />
                {c.label}
              </span>
            );
          })}
        </span>
      )}
      {field.kind === "boolean" && (
        <input
          type="checkbox"
          checked={value === true}
          onChange={(e) => onChange(e.target.checked)}
        />
      )}
      {field.kind === "number" && (
        <input
          type="number"
          className={inputClass}
          value={typeof value === "number" ? value : ""}
          step={field.integer ? 1 : "any"}
          onChange={(e) => onChange(e.target.value === "" ? undefined : Number(e.target.value))}
        />
      )}
      {field.kind === "text" && (
        <input
          type={property.format === "email" ? "email" : "text"}
          className={inputClass}
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </label>
  );
}

type Draft = Record<string, Record<string, ElicitationValue | undefined>>;

function contentOf(values: Record<string, ElicitationValue | undefined> = {}) {
  return Object.fromEntries(
    Object.entries(values).filter((e): e is [string, ElicitationValue] => e[1] !== undefined),
  );
}

export function ElicitationCard({
  elicitation,
  callbacks,
}: {
  elicitation: PendingElicitation;
  callbacks: ElicitationCallbacks;
}) {
  const requests = Object.entries(elicitation.requests);
  const [draft, setDraft] = useState<Draft>(() =>
    Object.fromEntries(
      requests.map(([key, r]) => [
        key,
        isUrlRequest(r)
          ? {}
          : Object.fromEntries(
              Object.entries(r.requestedSchema.properties ?? {}).map(([k, p]) => [
                k,
                initialValue(p),
              ]),
            ),
      ]),
    ),
  );
  const [problem, setProblem] = useState<string | null>(null);
  const recorded = callbacks.answered[elicitation.interruptId];
  const disabled = !!recorded || callbacks.busy;

  const send = (answers: Record<string, ElicitationAnswer>) => {
    for (const [key, request] of requests) {
      const p = answerProblem(request, answers[key]);
      if (p) return setProblem(p);
    }
    setProblem(null);
    callbacks.onAnswer(elicitation.interruptId, answers);
  };
  const all = (answer: (key: string, r: ElicitationRequest) => ElicitationAnswer) =>
    send(Object.fromEntries(requests.map(([key, r]) => [key, answer(key, r)])));

  const only = requests.length === 1 ? requests[0] : null;
  const quick = only && !isUrlRequest(only[1]) ? singleChoice(only[1]) : null;

  return (
    <div className="border-brand bg-card overflow-hidden rounded-lg border shadow-[0_0_0_4px_var(--brand-soft)]">
      <div className="border-brand/30 bg-brand/[0.07] flex items-center gap-2 border-b px-3.5 py-2.5">
        <MessageSquareWarning className="text-brand-dim h-4 w-4 shrink-0" />
        <span className="text-brand-dim font-mono text-[11px] font-semibold tracking-[0.14em]">
          SERVER REQUEST
        </span>
        <span className="text-brand-dim bg-brand/15 ml-auto rounded px-2 py-0.5 font-mono text-[11px]">
          {elicitation.server}
        </span>
      </div>

      <div className="space-y-4 px-4 py-4">
        <p className="text-muted-foreground text-sm">
          <span className="text-foreground font-medium">{elicitation.server}</span> is asking before
          it finishes <span className="font-mono text-xs">{elicitation.tool}</span>. This question
          comes from the server, not from Cameron; your answer goes only to it.
        </p>

        {requests.map(([key, request]) => (
          <div key={key} className="border-border space-y-3 rounded-md border px-3.5 py-3">
            <ServerText text={request.message} />
            {isUrlRequest(request) ? (
              <a
                href={request.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-foreground flex items-center gap-1.5 font-mono text-xs break-all underline underline-offset-2"
              >
                <ExternalLink className="h-3.5 w-3.5 shrink-0" />
                {request.url}
              </a>
            ) : (
              !quick &&
              Object.entries(request.requestedSchema.properties ?? {}).map(([name, property]) => (
                <Field
                  key={name}
                  name={name}
                  property={property}
                  value={draft[key]?.[name]}
                  onChange={(v) => setDraft((d) => ({ ...d, [key]: { ...d[key], [name]: v } }))}
                />
              ))
            )}
          </div>
        ))}

        {recorded ? (
          <p className="text-muted-foreground font-mono text-[11px]">
            {recorded.sent
              ? "answer sent"
              : `answer recorded · waiting for ${callbacks.unanswered} more`}
          </p>
        ) : (
          <div className="flex flex-wrap items-center gap-2.5">
            {quick ? (
              quick.choices.map((c) => (
                <button
                  key={c.value}
                  disabled={disabled}
                  className={`${secondaryButton} text-xs`}
                  onClick={() =>
                    all(() => ({ action: "accept", content: { [quick.key]: c.value } }))
                  }
                >
                  {c.label}
                </button>
              ))
            ) : (
              <button
                disabled={disabled}
                className={`${primaryButton} text-xs`}
                onClick={() =>
                  all((key, r) =>
                    isUrlRequest(r)
                      ? { action: "accept" }
                      : { action: "accept", content: contentOf(draft[key]) },
                  )
                }
              >
                {requests.some(([, r]) => isUrlRequest(r)) ? "Done" : "Send"}
              </button>
            )}
            <button
              disabled={disabled}
              className="text-muted-foreground hover:text-foreground cursor-pointer font-mono text-[11px] underline underline-offset-2"
              onClick={() => all(() => ({ action: "decline" }))}
            >
              decline
            </button>
            <button
              disabled={disabled}
              className="text-muted-foreground hover:text-foreground cursor-pointer font-mono text-[11px] underline underline-offset-2"
              onClick={() => all(() => ({ action: "cancel" }))}
            >
              dismiss
            </button>
          </div>
        )}
        {problem && <p className="text-destructive text-xs">{problem}</p>}
        {quick && !recorded && (
          <p className="text-muted-foreground text-[11px]">
            A choice that always allows the tool is kept by {elicitation.server}, not Cameron: it
            lets a scheduled task use it without stopping. Cameron&apos;s own approval still applies
            to every call.
          </p>
        )}
      </div>
    </div>
  );
}

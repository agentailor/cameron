"use client";
import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRound } from "lucide-react";
import { TASKS_QUERY_KEY, fetchGrants, grantsQueryKey, saveGrants } from "@/lib/tasks/client";
import { linkButton, secondaryButton } from "@/components/connections/styles";
import type { GrantsView, TaskView } from "@/types/task";

const RISK_NOTE = {
  adds: "adds records you can delete",
  changes: "changes records in place",
  bulk: "adds many records at once",
} as const;

const Suggested = () => (
  <span className="bg-muted text-muted-foreground rounded px-1 font-mono text-[10px]">
    suggested
  </span>
);

const Row = ({
  id,
  label,
  note,
  warn = false,
  checked,
  disabled = false,
  suggested,
  onToggle,
}: {
  id: string;
  label: string;
  note: string;
  warn?: boolean;
  checked: boolean;
  disabled?: boolean;
  suggested: boolean;
  onToggle: () => void;
}) => (
  <li className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
    <input
      id={id}
      type="checkbox"
      checked={checked}
      disabled={disabled}
      onChange={onToggle}
      className="accent-foreground h-3.5 w-3.5 cursor-pointer disabled:cursor-default"
    />
    <label htmlFor={id} className="text-foreground font-mono text-xs">
      {label}
    </label>
    {suggested && <Suggested />}
    <span className={`font-mono text-[11px] ${warn ? "text-brand" : "text-muted-foreground"}`}>
      {note}
    </span>
  </li>
);

/** A server's checkbox for all its tools listed now; a tool it adds later starts unchecked. */
const SelectAll = ({
  all,
  some,
  onChange,
}: {
  all: boolean;
  some: boolean;
  onChange: () => void;
}) => {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = some && !all;
  }, [all, some]);
  return (
    <label className="text-muted-foreground inline-flex cursor-pointer items-center gap-1.5 font-mono text-[11px]">
      <input
        ref={ref}
        type="checkbox"
        checked={all}
        onChange={onChange}
        className="accent-foreground h-3.5 w-3.5"
      />
      all tools listed now
    </label>
  );
};

const Editor = ({ view, onDone }: { view: GrantsView; onDone: () => void }) => {
  const queryClient = useQueryClient();
  const initial = [
    ...view.builtIn.filter((t) => t.granted).map((t) => t.tool),
    ...view.servers.flatMap((s) => s.tools.filter((t) => t.granted).map((t) => t.tool)),
    ...view.missing.filter((t) => t.granted).map((t) => t.tool),
  ];
  const [checked, setChecked] = useState<Set<string>>(() => new Set(initial));
  const [state, setState] = useState<{ busy: boolean; error: string | null }>({
    busy: false,
    error: null,
  });
  const changed = checked.size !== initial.length || initial.some((t) => !checked.has(t));

  const toggle = (tools: string[], on: boolean) =>
    setChecked((current) => {
      const next = new Set(current);
      for (const t of tools) {
        if (on) next.add(t);
        else next.delete(t);
      }
      return next;
    });

  async function save() {
    setState({ busy: true, error: null });
    const result = await saveGrants(view.task, [...checked]);
    if (!result.ok) return setState({ busy: false, error: result.error });
    queryClient.setQueryData(grantsQueryKey(view.task), result.value);
    await queryClient.invalidateQueries({ queryKey: TASKS_QUERY_KEY });
    onDone();
  }

  return (
    <div className="space-y-3">
      <section>
        <div className="text-muted-foreground font-mono text-[10px] tracking-[0.12em]">
          CAMERON&apos;S TOOLS
        </div>
        <ul className="mt-1.5 space-y-1.5">
          {view.builtIn.map((t) => (
            <Row
              key={t.tool}
              id={`${view.task}-grant-${t.tool}`}
              label={t.tool}
              note={t.risk ? RISK_NOTE[t.risk] : "a hard delete: always asks"}
              checked={t.grantable && checked.has(t.tool)}
              disabled={!t.grantable}
              suggested={t.suggested}
              onToggle={() => toggle([t.tool], !checked.has(t.tool))}
            />
          ))}
        </ul>
      </section>

      {view.servers.map((s) => {
        const tools = s.tools.map((t) => t.tool);
        const all = tools.length > 0 && tools.every((t) => checked.has(t));
        const some = tools.some((t) => checked.has(t));
        const open = s.tools.some((t) => t.granted || t.suggested);
        return (
          <details key={s.server} open={open} className="group">
            <summary className="flex cursor-pointer list-none items-center gap-3">
              <span className="text-muted-foreground font-mono text-[10px] tracking-[0.12em] uppercase">
                {s.server}
              </span>
              <span className="text-muted-foreground font-mono text-[10px]">
                {tools.filter((t) => checked.has(t)).length}/{tools.length}
              </span>
              <span onClick={(e) => e.stopPropagation()}>
                <SelectAll all={all} some={some} onChange={() => toggle(tools, !all)} />
              </span>
            </summary>
            <ul className="mt-1.5 space-y-1.5 pl-1">
              {s.tools.map((t) => (
                <Row
                  key={t.tool}
                  id={`${view.task}-grant-${t.tool}`}
                  label={t.name}
                  note={t.readOnly ? "read-only, says its server" : "not marked read-only"}
                  warn={!t.readOnly}
                  checked={checked.has(t.tool)}
                  suggested={t.suggested}
                  onToggle={() => toggle([t.tool], !checked.has(t.tool))}
                />
              ))}
            </ul>
          </details>
        );
      })}

      {view.missing.length > 0 && (
        <section>
          <div className="text-muted-foreground font-mono text-[10px] tracking-[0.12em]">
            NOT FOUND NOW
          </div>
          <ul className="mt-1.5 space-y-1.5">
            {view.missing.map((t) => (
              <Row
                key={t.tool}
                id={`${view.task}-grant-${t.tool}`}
                label={t.tool}
                note="no connected server lists it"
                warn
                checked={checked.has(t.tool)}
                // A missing tool can be revoked, not newly granted.
                disabled={!t.granted}
                suggested={t.suggested}
                onToggle={() => toggle([t.tool], !checked.has(t.tool))}
              />
            ))}
          </ul>
        </section>
      )}

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={save}
          disabled={state.busy || !changed}
          className={`${secondaryButton} px-2.5 py-1 text-xs`}
        >
          {state.busy ? "Saving…" : "Save grants"}
        </button>
        <button type="button" onClick={onDone} className={linkButton}>
          close
        </button>
        {state.error && <span className="text-destructive text-xs">{state.error}</span>}
      </div>
    </div>
  );
};

/**
 * The tools this task runs without stopping for approval. Granted per task, from its next run;
 * Cameron's own writes included, except the hard delete. See docs/GRANTS.md.
 */
export const TaskGrants = ({ task }: { task: TaskView }) => {
  const [open, setOpen] = useState(false);
  const { data, isPending, isError } = useQuery({
    queryKey: grantsQueryKey(task.name),
    queryFn: () => fetchGrants(task.name),
    enabled: open,
  });
  const pendingSuggestions = task.suggestedGrants.filter((t) => !task.grantedTools.includes(t));
  const count = task.grantedTools.length;

  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className={linkButton}
      >
        <KeyRound className="h-3 w-3" />
        {count === 0
          ? "every write and server tool asks first"
          : `${count} tool${count === 1 ? "" : "s"} run without asking`}
        {pendingSuggestions.length > 0 && ` · ${pendingSuggestions.length} suggested`}
      </button>
      {open && (
        <div className="border-border mt-3 space-y-2 border-t pt-3">
          <p className="text-muted-foreground text-xs leading-relaxed">
            Tools this task may use without stopping for your approval, from its next run. Grant
            only what you trust it to do while you&apos;re away. A server&apos;s tools are granted
            one by one: one it adds later asks first until you grant it.
          </p>
          {isPending && <p className="text-muted-foreground text-xs">Loading…</p>}
          {isError && <p className="text-destructive text-xs">Couldn&apos;t load the tools.</p>}
          {data && <Editor key={JSON.stringify(data)} view={data} onDone={() => setOpen(false)} />}
        </div>
      )}
    </div>
  );
};

"use client";
import { useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Play, SlidersHorizontal } from "lucide-react";
import {
  TASKS_QUERY_KEY,
  fetchTasks,
  runTaskNow,
  saveTaskLimits,
  updateTask,
} from "@/lib/tasks/client";
import { chip, linkButton, secondaryButton } from "@/components/connections/styles";
import { primaryButton } from "@/components/ui/formStyles";
import type { TaskLimitsView, TaskRunView, TaskView } from "@/types/task";
import { LimitInputs, toRequest, useDrafts } from "./LimitInputs";

/** The global value, else the default: what a task inherits when it sets nothing. */
function inheritedOf(limits: TaskLimitsView, field: "timeoutMinutes" | "maxRetries"): number {
  return limits.set[field] ?? limits.defaults[field];
}

const retries = (n: number) => (n === 1 ? "1 retry" : `${n} retries`);

/** A task's own timeout and retries; empty inherits the value for all tasks. */
const TaskLimitsEditor = ({
  task,
  limits,
  onDone,
}: {
  task: TaskView;
  limits: TaskLimitsView;
  onDone: () => void;
}) => {
  const queryClient = useQueryClient();
  const { drafts, set } = useDrafts(task.limits);
  const [state, setState] = useState<{ busy: boolean; error: string | null }>({
    busy: false,
    error: null,
  });

  async function save() {
    setState({ busy: true, error: null });
    const result = await updateTask(task.name, toRequest(["timeoutMinutes", "maxRetries"], drafts));
    if (!result.ok) return setState({ busy: false, error: result.error });
    await queryClient.invalidateQueries({ queryKey: TASKS_QUERY_KEY });
    onDone();
  }

  return (
    <div className="border-border mt-3 space-y-3 border-t pt-3">
      <LimitInputs
        idPrefix={task.name}
        drafts={drafts}
        onChange={set}
        inputs={[
          {
            field: "timeoutMinutes",
            label: "Timeout, minutes",
            inherited: `${inheritedOf(limits, "timeoutMinutes")} (all tasks)`,
          },
          {
            field: "maxRetries",
            label: "Retries",
            inherited: `${inheritedOf(limits, "maxRetries")} (all tasks)`,
          },
        ]}
      />
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={save}
          disabled={state.busy}
          className={`${secondaryButton} px-2.5 py-1 text-xs`}
        >
          {state.busy ? "Saving…" : "Save"}
        </button>
        <button type="button" onClick={onDone} className={linkButton}>
          cancel
        </button>
        {state.error && <span className="text-destructive text-xs">{state.error}</span>}
      </div>
    </div>
  );
};

/** Limits for every task: how many run at once, and the timeout and retries a task inherits. */
const GlobalLimits = ({ limits }: { limits: TaskLimitsView }) => {
  const queryClient = useQueryClient();
  const { drafts, set } = useDrafts(limits.set);
  const [state, setState] = useState<{ busy: boolean; message: string | null; error: boolean }>({
    busy: false,
    message: null,
    error: false,
  });

  async function save() {
    setState({ busy: true, message: null, error: false });
    const result = await saveTaskLimits(
      toRequest(["maxConcurrentRuns", "timeoutMinutes", "maxRetries"], drafts),
    );
    if (!result.ok) return setState({ busy: false, message: result.error, error: true });
    await queryClient.invalidateQueries({ queryKey: TASKS_QUERY_KEY });
    setState({ busy: false, message: "Saved. Applies from the next run.", error: false });
  }

  return (
    <section className="mt-10">
      <h2 className="text-foreground text-sm font-medium">Limits</h2>
      <p className="text-muted-foreground mt-1 text-sm leading-relaxed">
        For every task, unless a task sets its own. A run past its timeout is stopped. Retries are
        for errors that may pass, like a provider being briefly down. Leave a field empty for the
        default.
      </p>
      <div className="border-border mt-3 space-y-3 rounded-lg border bg-white p-4">
        <LimitInputs
          idPrefix="global"
          drafts={drafts}
          onChange={set}
          inputs={[
            {
              field: "maxConcurrentRuns",
              label: "Runs at once",
              inherited: `${limits.defaults.maxConcurrentRuns} (default)`,
            },
            {
              field: "timeoutMinutes",
              label: "Timeout, minutes",
              inherited: `${limits.defaults.timeoutMinutes} (default)`,
            },
            {
              field: "maxRetries",
              label: "Retries",
              inherited: `${limits.defaults.maxRetries} (default)`,
            },
          ]}
        />
        <div className="flex items-center gap-3">
          <button type="button" onClick={save} disabled={state.busy} className={primaryButton}>
            {state.busy ? "Saving…" : "Save"}
          </button>
          {state.message && (
            <span
              className={state.error ? "text-destructive text-xs" : "text-muted-foreground text-xs"}
            >
              {state.message}
            </span>
          )}
        </div>
      </div>
    </section>
  );
};

const when = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

const STATUS_LABEL: Record<TaskRunView["status"], string> = {
  running: "running",
  paused: "waiting for you",
  done: "done",
  failed: "failed",
};

const ThreadLink = ({ run, children }: { run: TaskRunView; children: React.ReactNode }) =>
  run.threadId ? (
    <Link
      href={`/thread/${run.threadId}`}
      className="hover:text-foreground underline-offset-2 hover:underline"
    >
      {children}
    </Link>
  ) : (
    <span>{children}</span>
  );

/** Runs paused on the approval gate: the one thing on this page that needs the owner. */
const WaitingForYou = ({ runs }: { runs: TaskRunView[] }) => {
  if (runs.length === 0) return null;
  return (
    <section className="mt-8">
      <h2 className="text-foreground text-sm font-medium">Waiting for you</h2>
      <ul className="mt-3 space-y-2">
        {runs.map((run) => (
          <li
            key={run.id}
            className="border-brand/40 bg-brand/5 flex items-center gap-3 rounded-lg border p-3"
          >
            <div className="min-w-0 flex-1">
              <div className="text-foreground text-sm font-medium">{run.taskName}</div>
              <div className="text-muted-foreground font-mono text-[11px]">
                started {when(run.startedAt)}
                {run.pauseReason === "approval" ? " · an action needs your approval" : ""}
              </div>
            </div>
            {run.threadId && (
              <Link href={`/thread/${run.threadId}`} className={`${secondaryButton} text-xs`}>
                Review
              </Link>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
};

const TaskItem = ({
  task,
  lastRun,
  limits,
}: {
  task: TaskView;
  lastRun?: TaskRunView;
  limits: TaskLimitsView;
}) => {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState<"toggle" | "run" | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const timeout = task.limits.timeoutMinutes ?? inheritedOf(limits, "timeoutMinutes");
  const maxRetries = task.limits.maxRetries ?? inheritedOf(limits, "maxRetries");
  const ownLimits = task.limits.timeoutMinutes !== null || task.limits.maxRetries !== null;

  async function act(kind: "toggle" | "run") {
    setBusy(kind);
    setFailed(null);
    const result =
      kind === "toggle"
        ? await updateTask(task.name, { enabled: !task.enabled })
        : await runTaskNow(task.name);
    if (!result.ok) setFailed(result.error);
    await queryClient.invalidateQueries({ queryKey: TASKS_QUERY_KEY });
    setBusy(null);
  }

  return (
    <li className="border-border rounded-lg border bg-white p-4">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1 space-y-1">
          <div className="text-foreground font-mono text-sm font-medium">{task.name}</div>
          <p className="text-foreground/80 text-sm leading-relaxed">{task.description}</p>
          <div className="text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[11px]">
            <span className={chip}>{task.schedule}</span>
            <span>{task.timezone}</span>
            {task.nextRunAt && <span>next {when(task.nextRunAt)}</span>}
            {lastRun && (
              <ThreadLink run={lastRun}>
                last: {STATUS_LABEL[lastRun.status]} {when(lastRun.startedAt)}
              </ThreadLink>
            )}
            <button
              type="button"
              onClick={() => setEditing((e) => !e)}
              aria-expanded={editing}
              className={linkButton}
            >
              <SlidersHorizontal className="h-3 w-3" />
              {timeout} min · {retries(maxRetries)}
              {ownLimits ? "" : " (all tasks)"}
            </button>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <button
            type="button"
            onClick={() => act("run")}
            disabled={busy !== null}
            className={`${secondaryButton} px-2.5 py-1 text-xs`}
          >
            {busy === "run" ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Play className="h-3.5 w-3.5" />
            )}
            Run now
          </button>
          <label className="text-muted-foreground inline-flex cursor-pointer items-center gap-2 font-mono text-[10px]">
            {task.enabled ? "on" : "off"}
            <button
              type="button"
              role="switch"
              aria-checked={task.enabled}
              aria-label={`${task.enabled ? "Disable" : "Enable"} ${task.name}`}
              onClick={() => act("toggle")}
              disabled={busy !== null}
              className={`focus-visible:ring-brand relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full transition-colors focus-visible:ring-2 focus-visible:outline-none disabled:opacity-60 ${
                task.enabled ? "bg-foreground" : "bg-border"
              }`}
            >
              <span
                className={`bg-card block h-4 w-4 rounded-full shadow-sm transition-transform ${
                  task.enabled ? "translate-x-[18px]" : "translate-x-0.5"
                }`}
              />
            </button>
          </label>
        </div>
      </div>
      {failed && <p className="text-destructive mt-2 text-xs">{failed}</p>}
      {editing && <TaskLimitsEditor task={task} limits={limits} onDone={() => setEditing(false)} />}
    </li>
  );
};

const RecentRuns = ({ runs }: { runs: TaskRunView[] }) => {
  if (runs.length === 0) return null;
  return (
    <section className="mt-10">
      <h2 className="text-foreground text-sm font-medium">Recent runs</h2>
      <ul className="border-border mt-3 divide-y rounded-lg border bg-white">
        {runs.map((run) => (
          <li key={run.id} className="flex flex-wrap items-baseline gap-x-3 px-4 py-2.5 text-sm">
            <span className="text-foreground font-mono">{run.taskName}</span>
            <span
              className={`font-mono text-[11px] ${
                run.status === "failed" ? "text-destructive" : "text-muted-foreground"
              }`}
            >
              {STATUS_LABEL[run.status]}
              {run.trigger === "manual" ? " · manual" : ""}
              {run.attempts > 1 ? ` · attempt ${run.attempts}` : ""}
            </span>
            <span className="text-muted-foreground ml-auto font-mono text-[11px]">
              <ThreadLink run={run}>{when(run.startedAt)}</ThreadLink>
            </span>
            {run.error && (
              <p className="text-destructive w-full font-mono text-[11px] break-words">
                {run.error}
              </p>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
};

export const TasksView = () => {
  const { data, isPending, isError } = useQuery({
    queryKey: TASKS_QUERY_KEY,
    queryFn: fetchTasks,
    // Runs finish in the background; poll while one is still going.
    refetchInterval: (query) =>
      query.state.data?.runs.some((r) => r.status === "running") ? 3000 : false,
  });

  if (isPending) return <p className="text-muted-foreground mt-8 text-sm">Loading…</p>;
  if (isError) return <p className="text-destructive mt-8 text-sm">Couldn&apos;t load tasks.</p>;

  const lastRun = new Map<string, TaskRunView>();
  for (const run of data.runs) if (!lastRun.has(run.taskName)) lastRun.set(run.taskName, run);

  return (
    <>
      <WaitingForYou runs={data.runs.filter((r) => r.status === "paused")} />
      {data.tasks.length === 0 ? (
        <p className="text-muted-foreground mt-8 text-sm leading-relaxed">
          No tasks yet. Add a <code className="font-mono">tasks/&lt;name&gt;/TASK.md</code> file and
          restart Cameron.
        </p>
      ) : (
        <ul className="mt-8 space-y-3">
          {data.tasks.map((t) => (
            <TaskItem key={t.name} task={t} lastRun={lastRun.get(t.name)} limits={data.limits} />
          ))}
        </ul>
      )}
      <GlobalLimits limits={data.limits} />
      <RecentRuns runs={data.runs} />
    </>
  );
};

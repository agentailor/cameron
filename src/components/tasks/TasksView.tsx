"use client";
import { useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Play } from "lucide-react";
import { TASKS_QUERY_KEY, fetchTasks, runTaskNow, setTaskEnabled } from "@/lib/tasks/client";
import { chip, secondaryButton } from "@/components/connections/styles";
import type { TaskRunView, TaskView } from "@/types/task";

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

const TaskItem = ({ task, lastRun }: { task: TaskView; lastRun?: TaskRunView }) => {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState<"toggle" | "run" | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  async function act(kind: "toggle" | "run") {
    setBusy(kind);
    setFailed(null);
    const ok =
      kind === "toggle"
        ? await setTaskEnabled(task.name, !task.enabled)
        : await runTaskNow(task.name);
    if (!ok) setFailed(kind === "toggle" ? "Couldn't change it." : "Couldn't start it.");
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
      {failed && <p className="text-destructive mt-2 text-xs">{failed} Try again.</p>}
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
            <TaskItem key={t.name} task={t} lastRun={lastRun.get(t.name)} />
          ))}
        </ul>
      )}
      <RecentRuns runs={data.runs} />
    </>
  );
};

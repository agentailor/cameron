import { nextSlot, type TaskDefinition, type TaskRun } from "@agentailor/agent-tasks";
import type { TaskSetting } from "@/lib/repositories/taskRepository";
import type { TaskLimitsView, TaskRunView, TaskView } from "@/types/task";
import { LIMIT_DEFAULTS, type Limits } from "./limits";

/** Pure projections from the package's types to the `/api/tasks` payload. */

export function toTaskView(
  task: TaskDefinition,
  setting: TaskSetting | undefined,
  timezone: string,
  now: Date,
): TaskView {
  const enabled = setting?.enabled ?? false;
  const zone = task.timezone ?? timezone;
  return {
    name: task.name,
    description: task.description,
    schedule: task.schedule,
    timezone: zone,
    enabled,
    nextRunAt: enabled ? nextSlot(task.schedule, { now, timezone: zone }).toISOString() : null,
    limits: {
      timeoutMinutes: setting?.limits.timeoutMinutes ?? null,
      maxRetries: setting?.limits.maxRetries ?? null,
    },
  };
}

export function toLimitsView(global: Limits): TaskLimitsView {
  return {
    set: {
      maxConcurrentRuns: global.maxConcurrentRuns ?? null,
      timeoutMinutes: global.timeoutMinutes ?? null,
      maxRetries: global.maxRetries ?? null,
    },
    defaults: { ...LIMIT_DEFAULTS },
  };
}

export function toRunView(run: TaskRun): TaskRunView {
  return {
    id: run.id,
    taskName: run.taskName,
    slot: run.slot.toISOString(),
    trigger: run.trigger,
    status: run.status,
    attempts: run.attempts,
    pauseReason: run.pauseReason ?? null,
    error: run.error ?? null,
    threadId: run.ref ?? null,
    startedAt: run.startedAt.toISOString(),
    finishedAt: run.finishedAt?.toISOString() ?? null,
  };
}

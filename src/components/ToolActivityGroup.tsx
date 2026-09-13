"use client";

import React, { useState } from "react";
import { ChevronDown, ChevronRight, Check, X, Lock } from "lucide-react";
import type { ToolApprovalCallbacks } from "@/types/message";
import type { ToolActivity } from "@/services/toolActivity";
import { summarizeActivities, summarizeResult } from "@/services/toolSummary";
import { ToolArgs, ToolResult, renderersFor } from "./toolRenderers";
import { Chart } from "./charts/Chart";
import type { ChartPayload } from "./charts/types";

/**
 * One card for a run of tool calls. A call and its result are ONE operation, so they render
 * together — the split across two components was inherited from the template and cost two
 * full-width cards per call.
 *
 * Collapsed by default: for most tools the arguments and the payload are machinery, not answers.
 * Two things are never hidden, because hiding them would hide the product:
 *   - a GATED call's arguments — you cannot approve what you cannot read;
 *   - a CHART — it is the answer itself, not a detail of one.
 */

const isChartPayload = (v: unknown): v is ChartPayload => {
  const p = v as ChartPayload | undefined;
  return !!p && typeof p === "object" && !!p.spec && Array.isArray(p.rows);
};

const contentOf = (activity: ToolActivity): string => {
  const content = activity.result?.data?.content;
  if (!content) return "";
  return typeof content === "string" ? content : JSON.stringify(content, null, 2);
};

/** The chart an activity should draw outside the collapse, if any. */
function chartOf(activity: ToolActivity): ChartPayload | null {
  if (renderersFor(activity.name).result !== "chart") return null;
  const artifact = (activity.result?.data as { artifact?: unknown } | undefined)?.artifact;
  return isChartPayload(artifact) ? artifact : null;
}

/** The amber approval gate. The one place amber appears: it means "this touches money". */
const ApprovalGate = ({
  activity,
  callbacks,
}: {
  activity: ToolActivity;
  callbacks: ToolApprovalCallbacks;
}) => {
  const [responded, setResponded] = useState(false);

  return (
    <div className="border-brand bg-card overflow-hidden rounded-lg border shadow-[0_0_0_4px_var(--brand-soft)]">
      <div className="border-brand/30 bg-brand/[0.07] flex items-center gap-2 border-b px-3.5 py-2.5">
        <Lock className="text-brand-dim h-4 w-4 shrink-0" />
        <span className="text-brand-dim font-mono text-[11px] font-semibold tracking-[0.14em]">
          APPROVAL REQUIRED
        </span>
        <span className="text-brand-dim bg-brand/15 ml-auto rounded px-2 py-0.5 font-mono text-[11px]">
          {activity.name}
        </span>
      </div>

      <div className="px-4 py-4">
        <div className="text-muted-foreground mb-3 text-sm">
          Cameron wants to run a tool that{" "}
          <span className="text-brand-dim font-medium">writes</span> to your data.
        </div>

        {/* Never collapsed — the arguments ARE the thing being approved. */}
        <ToolArgs toolName={activity.name} args={activity.args} />

        <div className="mt-4 flex items-center gap-2.5">
          <button
            disabled={responded}
            onClick={() => {
              setResponded(true);
              callbacks.onApprove(activity.callId);
            }}
            className="bg-brand text-brand-foreground hover:bg-brand-bright flex cursor-pointer items-center gap-1.5 rounded-md px-5 py-2 font-mono text-xs font-semibold tracking-wide transition-colors disabled:cursor-default disabled:opacity-50"
          >
            <Check className="h-3.5 w-3.5" />
            APPROVE
          </button>
          <button
            disabled={responded}
            onClick={() => {
              setResponded(true);
              callbacks.onDeny(activity.callId);
            }}
            className="border-border text-muted-foreground hover:bg-accent hover:text-foreground flex cursor-pointer items-center gap-1.5 rounded-md border px-4 py-2 font-mono text-xs font-medium tracking-wide transition-colors disabled:cursor-default disabled:opacity-50"
          >
            <X className="h-3.5 w-3.5" />
            DENY
          </button>
          <span className="text-muted-foreground ml-auto font-mono text-[10px]">
            nothing is written until you approve
          </span>
        </div>
      </div>
    </div>
  );
};

/** The expanded detail for one call: its arguments, then whatever came back. */
const ActivityDetail = ({ activity }: { activity: ToolActivity }) => {
  const content = contentOf(activity);
  const gist = activity.result ? summarizeResult(content, activity.name) : null;

  return (
    <div className="min-w-0 space-y-2.5">
      <div className="flex items-baseline gap-2">
        <span className="text-foreground font-mono text-xs font-medium">{activity.name}</span>
        {gist && <span className="text-muted-foreground font-mono text-[11px]">· {gist}</span>}
      </div>

      <ToolArgs toolName={activity.name} args={activity.args} />

      {activity.result ? (
        <ToolResult toolName={activity.name} content={content} />
      ) : (
        <span className="text-muted-foreground font-mono text-[11px]">
          {activity.isPending ? "awaiting approval" : "running…"}
        </span>
      )}
    </div>
  );
};

interface ToolActivityGroupProps {
  activities: ToolActivity[];
  approvalCallbacks?: ToolApprovalCallbacks;
}

export const ToolActivityGroupCard = ({
  activities,
  approvalCallbacks,
}: ToolActivityGroupProps) => {
  const [open, setOpen] = useState(false);

  // Charts and gates escape the collapse; everything else lives behind the toggle. A drawn chart
  // leaves the collapsed list entirely — showing "render_chart · 5 rows" above its own chart is
  // the duplication this refactor removes.
  const charts = activities
    .map((activity) => ({ activity, chart: chartOf(activity) }))
    .filter((c): c is { activity: ToolActivity; chart: ChartPayload } => c.chart !== null);
  const drawn = new Set(charts.map((c) => c.activity.callId));
  const isGated = (a: ToolActivity) => a.isPending && a.isMutating;
  const gated = approvalCallbacks ? activities.filter(isGated) : [];
  const collapsible = activities.filter((a) => !isGated(a) && !drawn.has(a.callId));

  return (
    // w-full + min-w-0: the card is a direct child of the message list now (it used to sit inside
    // AIMessage's flex column), so nothing else constrains it — without this a wide payload widens
    // the whole thread column.
    <div className="w-full min-w-0 space-y-2">
      {collapsible.length > 0 && (
        <div className="border-border bg-muted/30 rounded-lg border">
          <button
            type="button"
            aria-expanded={open}
            className="focus:ring-brand flex w-full cursor-pointer items-center gap-2 px-4 py-2.5 text-left focus:ring-2 focus:outline-none focus:ring-inset"
            onClick={() => setOpen((o) => !o)}
          >
            {open ? (
              <ChevronDown className="text-muted-foreground h-3.5 w-3.5 shrink-0" />
            ) : (
              <ChevronRight className="text-muted-foreground h-3.5 w-3.5 shrink-0" />
            )}
            <span className="text-muted-foreground truncate font-mono text-xs">
              {summarizeActivities(collapsible)}
            </span>
          </button>

          {/* min-w-0 + overflow-hidden: without them a wide SQL block or JSON dump stretches the
              card and scrolls the whole PAGE sideways instead of scrolling inside its own box. */}
          {open && (
            <div className="border-border min-w-0 space-y-4 overflow-hidden border-t px-4 py-3.5">
              {collapsible.map((activity) => (
                <ActivityDetail key={activity.callId} activity={activity} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* A chart is the answer — always visible, never behind the toggle, and with no JSON
          receipt underneath it. */}
      {charts.map(({ activity, chart }) => (
        <Chart key={`chart-${activity.callId}`} payload={chart} />
      ))}

      {gated.map((activity) => (
        <ApprovalGate key={activity.callId} activity={activity} callbacks={approvalCallbacks!} />
      ))}
    </div>
  );
};

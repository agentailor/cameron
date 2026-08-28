import React, { useState } from "react";
import { ChevronDown, ChevronRight, Check, X, Lock } from "lucide-react";
import type { ToolCall, FunctionCall, ToolApprovalCallbacks } from "@/types/message";
import { isMutatingTool } from "@/lib/agent/mutatingTools";
import { ToolArgs } from "./toolRenderers";

interface ToolCallDisplayProps {
  toolCalls?: ToolCall[];
  functionCalls?: FunctionCall[];
  approvalCallbacks?: ToolApprovalCallbacks;
  showApprovalButtons?: boolean;
}

const renderArgs = (name: string, args: Record<string, unknown> | string) => {
  const parsed = typeof args === "string" ? (JSON.parse(args) as Record<string, unknown>) : args;
  return <ToolArgs toolName={name} args={parsed} />;
};

const ToolCallItem: React.FC<{
  name: string;
  args: Record<string, unknown>;
  id?: string;
  approvalCallbacks?: ToolApprovalCallbacks;
  showApprovalButtons?: boolean;
}> = ({ name, args, id, approvalCallbacks, showApprovalButtons }) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [responded, setResponded] = useState(false);

  const isPendingApproval = Boolean(showApprovalButtons && id && approvalCallbacks && !responded);

  // A gate awaiting a decision is the one place amber appears: it means "this touches money".
  if (isPendingApproval) {
    return (
      <div className="border-brand bg-card overflow-hidden rounded-lg border shadow-[0_0_0_4px_var(--brand-soft)]">
        <div className="border-brand/30 bg-brand/[0.07] flex items-center gap-2 border-b px-3.5 py-2.5">
          <Lock className="text-brand-dim h-4 w-4 shrink-0" />
          <span className="text-brand-dim font-mono text-[11px] font-semibold tracking-[0.14em]">
            APPROVAL REQUIRED
          </span>
          <span className="text-brand-dim bg-brand/15 ml-auto rounded px-2 py-0.5 font-mono text-[11px]">
            {name}
          </span>
        </div>

        <div className="px-4 py-4">
          <div className="text-muted-foreground mb-3 text-sm">
            Cameron wants to run a tool that{" "}
            <span className="text-brand-dim font-medium">writes</span> to your data.
          </div>

          {renderArgs(name, args)}

          <div className="mt-4 flex items-center gap-2.5">
            <button
              onClick={() => {
                setResponded(true);
                approvalCallbacks!.onApprove(id!);
              }}
              className="bg-brand text-brand-foreground hover:bg-brand-bright flex cursor-pointer items-center gap-1.5 rounded-md px-5 py-2 font-mono text-xs font-semibold tracking-wide transition-colors"
            >
              <Check className="h-3.5 w-3.5" />
              APPROVE
            </button>
            <button
              onClick={() => {
                setResponded(true);
                approvalCallbacks!.onDeny(id!);
              }}
              className="border-border text-muted-foreground hover:bg-accent hover:text-foreground flex cursor-pointer items-center gap-1.5 rounded-md border px-4 py-2 font-mono text-xs font-medium tracking-wide transition-colors"
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
  }

  const isMutating = isMutatingTool(name);

  return (
    /* Same shell as ToolMessage: a call and its result are one operation and should read
       as one family, even though they arrive as two messages. */
    <div className="border-border bg-muted/30 rounded-lg border">
      <button
        className="focus:ring-brand flex w-full cursor-pointer items-center justify-between gap-3 px-4 py-3 text-left focus:ring-2 focus:outline-none focus:ring-inset"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="flex min-w-0 items-center gap-2">
          {isExpanded ? (
            <ChevronDown className="text-muted-foreground h-4 w-4 shrink-0" />
          ) : (
            <ChevronRight className="text-muted-foreground h-4 w-4 shrink-0" />
          )}
          <span className="text-foreground truncate font-mono text-sm font-medium">{name}</span>
          <span className="text-muted-foreground truncate font-mono text-xs">call</span>
        </div>
        {isMutating && (
          <span className="text-muted-foreground shrink-0 font-mono text-[10px] tracking-wider">
            approved
          </span>
        )}
      </button>

      {isExpanded && (
        <div className="border-border border-t px-4 py-3.5">{renderArgs(name, args)}</div>
      )}
    </div>
  );
};

export const ToolCallDisplay: React.FC<ToolCallDisplayProps> = ({
  toolCalls = [],
  functionCalls = [],
  approvalCallbacks,
  showApprovalButtons = false,
}) => {
  const hasToolCalls = toolCalls.length > 0;
  const hasFunctionCalls = functionCalls.length > 0;

  if (!hasToolCalls && !hasFunctionCalls) {
    return null;
  }

  return (
    <div className="space-y-2">
      {hasToolCalls && (
        <div className="space-y-2">
          {toolCalls.map((toolCall, index) => (
            <ToolCallItem
              key={toolCall.id || index}
              name={toolCall.name}
              args={toolCall.args}
              id={toolCall.id}
              approvalCallbacks={approvalCallbacks}
              showApprovalButtons={showApprovalButtons}
            />
          ))}
        </div>
      )}

      {hasFunctionCalls && (
        <div className="space-y-2">
          {functionCalls.map((functionCall, index) => (
            <ToolCallItem
              key={index}
              name={functionCall.name}
              args={functionCall.args}
              approvalCallbacks={approvalCallbacks}
              showApprovalButtons={showApprovalButtons}
            />
          ))}
        </div>
      )}
    </div>
  );
};

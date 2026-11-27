import type { ElicitationCallbacks, MessageResponse, ToolApprovalCallbacks } from "@/types/message";
import type { PendingElicitation } from "@/lib/mcp/elicitation";
import { HumanMessage } from "./HumanMessage";
import { AIMessage } from "./AIMessage";
import { ErrorMessage } from "./ErrorMessage";
import { useEffect, useMemo, useRef } from "react";
import { buildThreadItems } from "@/services/toolActivity";
import dynamic from "next/dynamic";

const ElicitationCard = dynamic(() => import("./ElicitationCard").then((m) => m.ElicitationCard), {
  ssr: false,
});

const ToolActivityGroupCard = dynamic(
  () => import("./ToolActivityGroup").then((m) => m.ToolActivityGroupCard),
  {
    ssr: false,
    loading: () => (
      <div className="border-border bg-muted/30 text-muted-foreground rounded-lg border px-4 py-2.5 font-mono text-xs">
        loading tools…
      </div>
    ),
  },
);

interface MessageListProps {
  messages: MessageResponse[];
  approvalCallbacks?: ToolApprovalCallbacks;
  elicitationCallbacks?: ElicitationCallbacks;
  /** Every waiting server question; one not matched to a call renders after the thread. */
  elicitations?: PendingElicitation[];
  /** A response is streaming: a call without a result may still be running. */
  isSending?: boolean;
}

const MessageList = ({
  messages,
  approvalCallbacks,
  elicitationCallbacks,
  elicitations = [],
  isSending = false,
}: MessageListProps) => {
  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Dedup, plus pairing of each call with its result; see services/toolActivity.ts.
  const items = useMemo(
    () => buildThreadItems(messages, { settled: !isSending }),
    [messages, isSending],
  );

  return (
    <div className="mx-auto w-full max-w-3xl min-w-0 space-y-6">
      {items.map((item) => {
        if (item.kind === "tools") {
          return (
            <ToolActivityGroupCard
              key={item.id}
              activities={item.activities}
              approvalCallbacks={approvalCallbacks}
              elicitationCallbacks={elicitationCallbacks}
            />
          );
        }

        const { message } = item;
        if (message.type === "human") {
          return <HumanMessage key={item.id} message={message} />;
        } else if (message.type === "ai") {
          return <AIMessage key={item.id} message={message} />;
        } else if (message.type === "error") {
          return <ErrorMessage key={item.id} message={message} />;
        }
        return null;
      })}
      {elicitationCallbacks &&
        elicitations
          .filter((e) => !e.toolCallId)
          .map((e) => (
            <ElicitationCard
              key={`ask-${e.interruptId}`}
              elicitation={e}
              callbacks={elicitationCallbacks}
            />
          ))}
      <div ref={bottomRef} className="h-px" />
    </div>
  );
};

export default MessageList;

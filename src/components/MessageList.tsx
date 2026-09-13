import type { MessageResponse, ToolApprovalCallbacks } from "@/types/message";
import { HumanMessage } from "./HumanMessage";
import { AIMessage } from "./AIMessage";
import { ErrorMessage } from "./ErrorMessage";
import { useEffect, useMemo, useRef } from "react";
import { buildThreadItems } from "@/services/toolActivity";
import dynamic from "next/dynamic";

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
  approveToolExecution?: (toolCallId: string, action: "allow" | "deny") => Promise<void>;
}

const MessageList = ({ messages, approveToolExecution }: MessageListProps) => {
  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Create approval callbacks for tool execution
  const approvalCallbacks: ToolApprovalCallbacks | undefined = approveToolExecution
    ? {
        onApprove: (toolCallId: string) => approveToolExecution(toolCallId, "allow"),
        onDeny: (toolCallId: string) => approveToolExecution(toolCallId, "deny"),
      }
    : undefined;

  // Dedup, plus pairing of each call with its result; see services/toolActivity.ts.
  const items = useMemo(() => buildThreadItems(messages), [messages]);

  return (
    <div className="mx-auto w-full max-w-3xl min-w-0 space-y-6">
      {items.map((item) => {
        if (item.kind === "tools") {
          return (
            <ToolActivityGroupCard
              key={item.id}
              activities={item.activities}
              approvalCallbacks={approvalCallbacks}
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
      <div ref={bottomRef} className="h-px" />
    </div>
  );
};

export default MessageList;

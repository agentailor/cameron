import type { MessageResponse, ToolApprovalCallbacks } from "@/types/message";
import { HumanMessage } from "./HumanMessage";
import { AIMessage } from "./AIMessage";
import { ErrorMessage } from "./ErrorMessage";
import { useEffect, useRef } from "react";
import { getMessageId } from "@/services/messageUtils";
import dynamic from "next/dynamic";
import { useUISettings } from "@/contexts/UISettingsContext";

const ToolMessage = dynamic(() => import("./ToolMessage").then((m) => m.ToolMessage), {
  ssr: false,
  loading: () => (
    <div className="bg-muted/40 text-muted-foreground rounded p-4 text-sm">
      Loading tool output…
    </div>
  ),
});

interface MessageListProps {
  messages: MessageResponse[];
  approveToolExecution?: (toolCallId: string, action: "allow" | "deny") => Promise<void>;
}

const MessageList = ({ messages, approveToolExecution }: MessageListProps) => {
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const { hideToolMessages } = useUISettings();

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
  // Deduplicate by type+id: ids are only unique WITHIN a type (an AI message's synthetic id and a
  // tool message's call id come from different namespaces), so keying on id alone can drop a
  // distinct message. Messages without an id are always kept — they cannot be compared.
  const seen = new Set<string>();
  const uniqueMessages = messages.filter((message) => {
    const id = message.data?.id;
    if (!id) return true;
    const key = `${message.type}:${id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6">
      {uniqueMessages.map((message, index) => {
        // Key by type+id for the same reason the dedup does; index backs up an id-less message.
        const key = `${message.type}:${getMessageId(message) || index}`;
        if (message.type === "human") {
          return <HumanMessage key={key} message={message} />;
        } else if (message.type === "ai") {
          return <AIMessage key={key} message={message} approvalCallbacks={approvalCallbacks} />;
        } else if (message.type === "tool" && !hideToolMessages) {
          return <ToolMessage key={key} message={message} />;
        } else if (message.type === "error") {
          return <ErrorMessage key={key} message={message} />;
        }
        return null;
      })}
      <div ref={bottomRef} className="h-px" />
    </div>
  );
};

export default MessageList;

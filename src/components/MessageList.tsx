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
    <div className="rounded bg-gray-50 p-4 text-sm text-gray-500">Loading tool output…</div>
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
  // Deduplicate messages by ID
  const uniqueMessages = messages.reduce((acc: MessageResponse[], message) => {
    const isDuplicate = acc.some((m) => m.data?.id === message.data?.id);
    if (!isDuplicate) {
      acc.push(message);
    }
    return acc;
  }, []);

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6">
      {uniqueMessages.map((message, index) => {
        if (message.type === "human") {
          return <HumanMessage key={getMessageId(message)} message={message} />;
        } else if (message.type === "ai") {
          return (
            <AIMessage
              key={getMessageId(message)}
              message={message}
              showApprovalButtons={index === messages.length - 1} // Show buttons only on the latest AI message
              approvalCallbacks={approvalCallbacks}
            />
          );
        } else if (message.type === "tool" && !hideToolMessages) {
          return <ToolMessage key={getMessageId(message)} message={message} />;
        } else if (message.type === "error") {
          return <ErrorMessage key={getMessageId(message)} message={message} />;
        }
        return null;
      })}
      <div ref={bottomRef} className="h-px" />
    </div>
  );
};

export default MessageList;

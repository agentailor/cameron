import type { MessageResponse, ToolApprovalCallbacks } from "@/types/message";
import { Bot } from "lucide-react";
import rehypeKatex from "rehype-katex";
import { cn } from "@/lib/utils";
import { getMessageContent, hasToolCalls, getToolCalls } from "@/services/messageUtils";
import { ToolCallDisplay } from "./ToolCallDisplay";
import { useUISettings } from "@/contexts/UISettingsContext";
import MDEditor from "@uiw/react-md-editor";

interface AIMessageProps {
  message: MessageResponse;
  approvalCallbacks?: ToolApprovalCallbacks;
  showApprovalButtons?: boolean;
}

export const AIMessage = ({
  message,
  approvalCallbacks,
  showApprovalButtons = false,
}: AIMessageProps) => {
  const messageContent = getMessageContent(message);
  const hasTools = hasToolCalls(message);
  const toolCalls = getToolCalls(message);
  const { hideToolMessages } = useUISettings();

  // If tool messages are hidden and there's no text content, don't render anything
  const shouldShowTools = hasTools && !hideToolMessages;
  const hasVisibleContent = messageContent || shouldShowTools;

  if (!hasVisibleContent) {
    return null;
  }

  return (
    <div className="flex gap-3">
      <div className="bg-brand/15 flex h-8 w-8 shrink-0 items-center justify-center rounded-full">
        <Bot className="text-brand-dim h-5 w-5" />
      </div>
      {/* Prose stays in a readable column; tool cards run full width so a call lines up with
          the result card that follows it as a sibling message. */}
      <div className="min-w-0 flex-1 space-y-3">
        {messageContent && (
          <div className={cn("text-foreground max-w-[80%] py-1")}>
            <div
              data-color-mode="light"
              className="cameron-md [&_li]:my-1 [&_ol]:ml-6 [&_ol]:list-decimal [&_ul]:ml-6 [&_ul]:list-disc"
            >
              <MDEditor.Markdown
                source={messageContent}
                style={{
                  backgroundColor: "transparent",
                  color: "inherit",
                  padding: 0,
                  fontSize: "1rem",
                }}
                rehypePlugins={[rehypeKatex]}
              />
            </div>
          </div>
        )}

        {shouldShowTools && (
          <div className="space-y-2">
            <ToolCallDisplay
              toolCalls={toolCalls}
              approvalCallbacks={approvalCallbacks}
              showApprovalButtons={showApprovalButtons}
            />
          </div>
        )}
      </div>
    </div>
  );
};

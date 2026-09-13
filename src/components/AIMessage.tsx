import type { MessageResponse } from "@/types/message";
import { Bot } from "lucide-react";
import rehypeKatex from "rehype-katex";
import { cn } from "@/lib/utils";
import { getMessageContent } from "@/services/messageUtils";
import MDEditor from "@uiw/react-md-editor";

interface AIMessageProps {
  message: MessageResponse;
}

/**
 * The agent's prose. Tool calls ride along on these messages but are NOT rendered here — they are
 * paired with their results and drawn by ToolActivityGroup, so one operation is one card.
 */
export const AIMessage = ({ message }: AIMessageProps) => {
  const messageContent = getMessageContent(message);

  if (!messageContent) {
    return null;
  }

  return (
    <div className="flex gap-3">
      <div className="bg-brand/15 flex h-8 w-8 shrink-0 items-center justify-center rounded-full">
        <Bot className="text-brand-dim h-5 w-5" />
      </div>
      <div className="min-w-0 flex-1 space-y-3">
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
      </div>
    </div>
  );
};

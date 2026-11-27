import type { MessageResponse, BasicMessageData } from "@/types/message";
import { CircleAlert } from "lucide-react";
import { getMessageContent } from "@/services/messageUtils";

interface ErrorMessageProps {
  message: MessageResponse;
}

/**
 * Why a reply stopped. Laid out like an agent message, so it reads as the turn's outcome; red is
 * only the rule and the label, and the raw error waits behind "details".
 */
export const ErrorMessage = ({ message }: ErrorMessageProps) => {
  const { detail } = message.data as BasicMessageData;
  const text = getMessageContent(message);

  return (
    <div className="flex gap-3" role="alert">
      <div className="border-border flex h-8 w-8 shrink-0 items-center justify-center rounded-full border">
        <CircleAlert className="text-destructive h-4 w-4" />
      </div>
      <div className="border-destructive/60 min-w-0 flex-1 space-y-1.5 border-l-2 py-1 pl-3">
        <p className="text-destructive m-0 font-mono text-[11px] font-semibold tracking-[0.14em] uppercase">
          Reply stopped
        </p>
        <p className="text-foreground m-0 max-w-[80%] text-sm leading-relaxed">{text}</p>
        {detail && detail !== text && (
          <details className="group max-w-[80%]">
            <summary className="text-muted-foreground hover:text-foreground cursor-pointer font-mono text-[11px] select-none">
              details
            </summary>
            <pre className="bg-muted/50 text-muted-foreground mt-1.5 overflow-x-auto rounded-md px-3 py-2 font-mono text-xs whitespace-pre-wrap">
              {detail}
            </pre>
          </details>
        )}
      </div>
    </div>
  );
};

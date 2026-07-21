import type { MessageResponse } from "@/types/message";
import { AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { getMessageContent } from "@/services/messageUtils";

interface ErrorMessageProps {
  message: MessageResponse;
}

export const ErrorMessage = ({ message }: ErrorMessageProps) => {
  return (
    <div className="flex gap-3">
      <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-red-500/10">
        <AlertTriangle className="h-5 w-5 text-red-600" />
      </div>
      <div className="max-w-[80%]">
        <div
          className={cn(
            "rounded-2xl border border-red-400/40 bg-red-500/15 px-4 py-2 text-red-700 dark:text-red-300",
          )}
        >
          <p className="m-0 text-sm whitespace-pre-wrap">{getMessageContent(message)}</p>
        </div>
      </div>
    </div>
  );
};

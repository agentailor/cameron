"use client";
import { MessageInput } from "./MessageInput";
import MessageList from "./MessageList";
import { useChatThread } from "@/hooks/useChatThread";
import { Loader2 } from "lucide-react";
import { ScrollArea } from "./ui/scroll-area";
import { useEffect, useRef, useState } from "react";
import { MessageOptions } from "@/types/message";

interface ThreadProps {
  threadId: string;
  onFirstMessageSent?: (threadId: string) => void;
}

export const Thread = ({ threadId, onFirstMessageSent }: ThreadProps) => {
  const { messages, isLoadingHistory, isSending, sendMessage, approveToolExecution } =
    useChatThread({ threadId });
  const firstMessageInitiatedRef = useRef(false);
  const [awaitingFirstResponse, setAwaitingFirstResponse] = useState(false);

  const handleSendMessage = async (message: string, opts?: MessageOptions) => {
    const wasEmpty = messages.length === 0;
    await sendMessage(message, opts);
    if (wasEmpty) {
      firstMessageInitiatedRef.current = true;
      setAwaitingFirstResponse(true);
    }
  };

  // Detect first AI/tool/error message arrival after initial user message to trigger redirect
  useEffect(() => {
    if (awaitingFirstResponse && !isSending) {
      const hasNonHuman = messages.some((m) => m.type !== "human");
      if (hasNonHuman) {
        setAwaitingFirstResponse(false);
        if (onFirstMessageSent) onFirstMessageSent(threadId);
      }
    }
  }, [awaitingFirstResponse, isSending, messages, onFirstMessageSent, threadId]);

  if (isLoadingHistory) {
    return (
      <div className="bg-background/95 supports-[backdrop-filter]:bg-background/60 absolute inset-0 flex items-center justify-center backdrop-blur">
        <Loader2 className="text-primary h-8 w-8 animate-spin" />
        <p className="text-muted-foreground mt-2">Loading conversation history...</p>
      </div>
    );
  }

  return (
    <div className="absolute inset-0 flex flex-col">
      {messages.length > 0 ? (
        <>
          <div className="min-h-0 flex-1">
            <ScrollArea className="h-full">
              <div className="space-y-4 px-4 py-4">
                <MessageList messages={messages} approveToolExecution={approveToolExecution} />
              </div>
            </ScrollArea>
          </div>
          <div className="flex-shrink-0">
            <div className="w-full p-4 pb-6">
              <div className="mx-auto max-w-3xl">
                <MessageInput onSendMessage={handleSendMessage} isLoading={isSending} />
              </div>
            </div>
          </div>
        </>
      ) : (
        <div className="flex flex-1 items-center justify-center">
          <div className="w-full max-w-3xl px-4">
            <div className="mb-5 text-center">
              <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
                Chat with your Agent
              </h1>
              <p className="text-muted-foreground mt-2">
                Start a new conversation by sending a message
              </p>
            </div>
            <MessageInput onSendMessage={handleSendMessage} isLoading={isSending} />
          </div>
        </div>
      )}
    </div>
  );
};

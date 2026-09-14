"use client";
import { MessageInput } from "./MessageInput";
import MessageList from "./MessageList";
import { useChatThread } from "@/hooks/useChatThread";
import { useThreads } from "@/hooks/useThreads";
import { Loader2 } from "lucide-react";
import { ScrollArea } from "./ui/scroll-area";
import { useEffect, useRef, useState } from "react";
import { MessageOptions } from "@/types/message";
import { useModelSettings } from "@/hooks/useModelSettings";
import { NotConfiguredNotice } from "./NotConfiguredNotice";
import { deriveThreadTitle } from "@/lib/format/threadTitle";

interface ThreadProps {
  /** null on the new-chat screen: no thread exists until the first message is sent. */
  threadId: string | null;
}

export const Thread = ({ threadId }: ThreadProps) => {
  // The thread this screen is showing. On `/` it starts null and is adopted at send time.
  const [activeId, setActiveId] = useState<string | null>(threadId);
  useEffect(() => setActiveId(threadId), [threadId]);

  const { messages, isLoadingHistory, isSending, sendMessage, approveToolExecution } =
    useChatThread({ threadId: activeId });
  const { createThread } = useThreads();
  const { settings } = useModelSettings();
  const isConfigured = settings?.configured ?? true;
  // Guards against a double-send racing two thread creations before the URL has been adopted.
  const creatingRef = useRef<Promise<string> | null>(null);

  const handleSendMessage = async (message: string, opts?: MessageOptions) => {
    if (activeId) {
      await sendMessage(message, opts);
      return;
    }

    // Created at send time, so an abandoned visit to `/` leaves no empty row behind.
    if (!creatingRef.current) {
      creatingRef.current = createThread(deriveThreadTitle(message)).then((t) => t.id);
    }
    const newId = await creatingRef.current;

    // replaceState, not a router navigation: navigating would remount this subtree and tear
    // down the EventSource mid-stream.
    window.history.replaceState(null, "", `/thread/${newId}`);
    setActiveId(newId);

    await sendMessage(message, { ...opts, targetThreadId: newId });
  };

  if (isLoadingHistory) {
    return (
      <div className="bg-background/95 supports-backdrop-filter:bg-background/60 absolute inset-0 flex items-center justify-center backdrop-blur">
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
            {/* Radix renders its viewport as `display: table; min-width: 100%`, and a table sizes
                to its widest content — so a wide tool payload stretches the whole thread column
                instead of scrolling inside its own box. Forcing the inner table to `block` keeps
                the column at the viewport width. */}
            <ScrollArea className="h-full [&>[data-slot=scroll-area-viewport]>div]:block!">
              <div className="min-w-0 space-y-4 px-4 py-4">
                <MessageList messages={messages} approveToolExecution={approveToolExecution} />
              </div>
            </ScrollArea>
          </div>
          <div className="shrink-0">
            <div className="w-full p-4 pb-6">
              <div className="mx-auto max-w-3xl">
                {isConfigured ? (
                  <MessageInput onSendMessage={handleSendMessage} isLoading={isSending} />
                ) : (
                  <NotConfiguredNotice />
                )}
              </div>
            </div>
          </div>
        </>
      ) : (
        <div className="flex flex-1 items-center justify-center">
          <div className="w-full max-w-3xl px-4">
            <div className="mb-6">
              <p className="text-brand-dim mb-2 font-mono text-[11px] tracking-[0.2em] uppercase">
                Cameron
              </p>
              <h1 className="text-foreground text-3xl font-bold tracking-tight">
                Ask anything about your money.
              </h1>
              <p className="text-muted-foreground mt-2.5 leading-relaxed">
                Log expenses, import a bank export, or dig into where it all went. Nothing is
                written without your approval, and your data never leaves this machine.
              </p>
            </div>
            {isConfigured ? (
              <>
                <MessageInput onSendMessage={handleSendMessage} isLoading={isSending} />
                <div className="mt-4 flex flex-wrap gap-2">
                  {[
                    "What did I spend on dining last month?",
                    "Log a €12 coffee at Blue Bottle",
                    "Top 5 merchants this year",
                  ].map((example) => (
                    <button
                      key={example}
                      type="button"
                      onClick={() => handleSendMessage(example, { tools: [] })}
                      className="border-border text-muted-foreground hover:border-brand hover:text-foreground cursor-pointer rounded-full border px-3 py-1.5 text-[13px] transition-colors"
                    >
                      {example}
                    </button>
                  ))}
                </div>
              </>
            ) : (
              <NotConfiguredNotice />
            )}
          </div>
        </div>
      )}
    </div>
  );
};

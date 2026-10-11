import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  MessageOptions,
  MessageResponse,
  AIMessageData,
  ApprovalDecision,
  RecordedDecision,
} from "@/types/message";
import { createMessageStream, fetchMessageHistory } from "@/services/chatService";
import { pendingApprovalIds } from "@/services/toolActivity";

interface UseChatThreadOptions {
  threadId: string | null;
}

export interface UseChatThreadReturn {
  messages: MessageResponse[];
  isLoadingHistory: boolean;
  isSending: boolean;
  historyError: Error | null;
  sendError: Error | null;
  sendMessage: (text: string, opts?: MessageOptions) => Promise<void>;
  refetchMessages: () => Promise<unknown>;
  /** Record one call's decision; the batch resumes once every pending call has one. */
  decideToolCall: (toolCallId: string, action: ApprovalDecision) => void;
  undoToolDecision: (toolCallId: string) => void;
  decisions: Record<string, RecordedDecision>;
  /** The gated calls in the batch still to be sent, decided or not. */
  batchIds: string[];
}

export function useChatThread({ threadId }: UseChatThreadOptions): UseChatThreadReturn {
  const queryClient = useQueryClient();
  const streamRef = useRef<EventSource | null>(null);
  const currentMessageRef = useRef<MessageResponse | null>(null);
  const [sendError, setSendError] = useState<Error | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [decisions, setDecisions] = useState<Record<string, RecordedDecision>>({});

  const {
    data: messages = [],
    isLoading: isLoadingHistory,
    error: historyError,
    refetch: refetchMessagesQuery,
  } = useQuery<MessageResponse[]>({
    queryKey: ["messages", threadId],
    enabled: !!threadId,
    queryFn: () => (threadId ? fetchMessageHistory(threadId) : Promise.resolve([])),
  });

  // Fetch once the threadId becomes available. Skipped mid-stream: the new-chat screen adopts
  // its thread id during a send, where a refetch would clobber the optimistic messages.
  useEffect(() => {
    if (threadId && !isSending) {
      void refetchMessagesQuery();
    }
    // `isSending` is deliberately not a dependency: fire on thread changes, not on send state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threadId, refetchMessagesQuery]);

  // Shared function to handle SSE streaming for both sendMessage and decideToolCall
  const handleStreamResponse = useCallback(
    async (streamParams: {
      threadId: string;
      text?: string;
      opts?: MessageOptions;
      onError?: () => void;
    }) => {
      const { threadId, text = "", opts, onError } = streamParams;

      setIsSending(true);
      setSendError(null);

      // If another stream is active, close it before starting a new one
      if (streamRef.current) {
        try {
          streamRef.current.close();
        } catch {}
      }

      try {
        // Open SSE stream to generate the assistant response
        const stream = createMessageStream(threadId, text, opts);
        streamRef.current = stream;

        stream.onmessage = (event: MessageEvent) => {
          try {
            // Parse streaming data - it comes as a complete MessageResponse object
            const messageResponse = JSON.parse(event.data) as MessageResponse;

            // Extract the data from the MessageResponse
            const data = messageResponse.data as AIMessageData;

            // First chunk for this response id: create a new message entry
            if (!currentMessageRef.current || currentMessageRef.current.data.id !== data.id) {
              currentMessageRef.current = messageResponse;
              queryClient.setQueryData(["messages", threadId], (old: MessageResponse[] = []) => [
                ...old,
                currentMessageRef.current!,
              ]);
            } else {
              // Subsequent chunks: append content if it's a string, otherwise replace
              const currentData = currentMessageRef.current.data as AIMessageData;
              const newContent =
                typeof data.content === "string" && typeof currentData.content === "string"
                  ? currentData.content + data.content
                  : data.content;

              currentMessageRef.current = {
                ...currentMessageRef.current,
                data: {
                  ...currentData,
                  content: newContent,
                  // Update tool call data if present
                  ...(data.tool_calls && { tool_calls: data.tool_calls }),
                  ...(data.pendingToolCallIds && {
                    pendingToolCallIds: data.pendingToolCallIds,
                  }),
                  ...(data.additional_kwargs && { additional_kwargs: data.additional_kwargs }),
                  ...(data.response_metadata && { response_metadata: data.response_metadata }),
                },
              };
              queryClient.setQueryData(["messages", threadId], (old: MessageResponse[] = []) => {
                // Find the in-flight assistant message by its stable response id
                const idx = old.findIndex((m) => m.data?.id === currentMessageRef.current!.data.id);
                // If it's not in the cache (race or refresh), keep existing state
                if (idx === -1) return old;
                // Immutable update so React Query subscribers are notified
                const clone = [...old];
                // Replace only the updated message entry with the latest accumulated content
                clone[idx] = currentMessageRef.current!;
                return clone;
              });
            }
          } catch {
            // Ignore malformed chunks to keep the stream alive
          }
        };

        stream.addEventListener("done", async () => {
          // Stream finished: clear flags and close
          setIsSending(false);
          currentMessageRef.current = null;
          stream.close();
          streamRef.current = null;
        });

        stream.addEventListener("error", async (ev: Event) => {
          try {
            // Try to extract a meaningful error message from the event payload
            const dataText = (ev as MessageEvent<string>)?.data;
            const message = (() => {
              try {
                const parsed = dataText ? JSON.parse(dataText) : null;
                return parsed?.message || "An error occurred while generating a response.";
              } catch {
                return "An error occurred while generating a response.";
              }
            })();
            // Surface the error in the chat as a message
            const errorMsg: MessageResponse = {
              type: "error",
              data: { id: `err-${Date.now()}`, content: `⚠️ ${message}` },
            };
            queryClient.setQueryData(["messages", threadId], (old: MessageResponse[] = []) => [
              ...old,
              errorMsg,
            ]);
          } finally {
            // Always clean up the stream and flags on error
            onError?.();
            setIsSending(false);
            currentMessageRef.current = null;
            stream.close();
            streamRef.current = null;
          }
        });
      } catch (err: unknown) {
        // Network/setup failure before the stream started: capture and expose the error
        setSendError(err as Error);
        onError?.();
        setIsSending(false);
        currentMessageRef.current = null;
      }
    },
    [queryClient],
  );

  const sendMessage = useCallback(
    async (text: string, opts?: MessageOptions) => {
      const target = opts?.targetThreadId ?? threadId;
      // Guard: require a thread to target
      if (!target) return;

      // Optimistic UI: append the user's message immediately
      const tempId = `temp-${Date.now()}`;
      const userMessage: MessageResponse = {
        type: "human",
        data: {
          id: tempId,
          content: text,
          attachments: opts?.attachments,
        },
      };
      queryClient.setQueryData(["messages", target], (old: MessageResponse[] = []) => [
        ...old,
        userMessage,
      ]);

      // Handle the streaming response
      await handleStreamResponse({ threadId: target, text, opts });
    },
    [threadId, queryClient, handleStreamResponse],
  );

  // A sent decision stays recorded: a denied call gets no live result, so its id stays in the
  // pending marker until the next history load, and must not count toward a new batch.
  const batchIds = useMemo(
    () => pendingApprovalIds(messages).filter((id) => !decisions[id]?.sent),
    [messages, decisions],
  );

  const decideToolCall = useCallback(
    (toolCallId: string, action: ApprovalDecision) => {
      if (!threadId || isSending || !batchIds.includes(toolCallId)) return;

      const next = { ...decisions, [toolCallId]: { decision: action, sent: false } };
      if (!batchIds.every((id) => next[id])) {
        setDecisions(next);
        return;
      }

      // Every call in the batch is decided: send them together, one decision per call id.
      const batch = Object.fromEntries(batchIds.map((id) => [id, next[id].decision]));
      const anyDenied = Object.values(batch).includes("deny");
      const sent = Object.fromEntries(
        batchIds.map((id) => [
          id,
          { decision: batch[id], sent: true, heldBack: anyDenied && batch[id] === "allow" },
        ]),
      );
      setDecisions({ ...next, ...sent });

      void handleStreamResponse({
        threadId,
        text: "",
        opts: { decisions: batch },
        // Refused or failed: nothing resumed, so the batch is undecided again.
        onError: () =>
          setDecisions((d) =>
            Object.fromEntries(Object.entries(d).filter(([id]) => !batchIds.includes(id))),
          ),
      });
    },
    [threadId, isSending, batchIds, decisions, handleStreamResponse],
  );

  const undoToolDecision = useCallback((toolCallId: string) => {
    setDecisions((d) => {
      if (!d[toolCallId] || d[toolCallId].sent) return d;
      const rest = { ...d };
      delete rest[toolCallId];
      return rest;
    });
  }, []);

  useEffect(
    () => () => {
      if (streamRef.current) {
        try {
          streamRef.current.close();
        } catch {}
      }
    },
    [],
  );

  return {
    messages,
    isLoadingHistory,
    isSending,
    historyError: historyError as Error | null,
    sendError,
    sendMessage,
    refetchMessages: refetchMessagesQuery,
    decideToolCall,
    undoToolDecision,
    decisions,
    batchIds,
  };
}

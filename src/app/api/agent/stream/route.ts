import { NextRequest } from "next/server";
import { streamResponse } from "@/services/agentService";
import type { MessageResponse, FileAttachment, ApprovalDecision } from "@/types/message";
import { ApprovalDecisions } from "./schema";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * SSE endpoint that streams incremental AI response chunks produced by the LangGraph React agent.
 * Query params:
 *  - content: user message text
 *  - threadId: (currently unused for history; placeholder for future multi-turn support)
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const userContent = searchParams.get("content") || "";
  const threadId = searchParams.get("threadId") || "unknown";
  const model = searchParams.get("model") || undefined;
  const provider = searchParams.get("provider") || undefined;
  const decisionsParam = searchParams.get("decisions");
  const toolsParam = searchParams.get("tools") || "";
  const attachmentsParam = searchParams.get("attachments") || "";

  const tools = toolsParam
    ? toolsParam
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean)
    : undefined;

  // Parse attachments from JSON
  let attachments: FileAttachment[] | undefined;
  if (attachmentsParam) {
    try {
      attachments = JSON.parse(attachmentsParam);
    } catch (error) {
      console.error("Failed to parse attachments:", error);
    }
  }

  // A malformed decision set is refused inside the stream, so the client sees why.
  let decisions: Record<string, ApprovalDecision> | undefined;
  let decisionsError: string | undefined;
  if (decisionsParam !== null) {
    let raw: unknown;
    try {
      raw = JSON.parse(decisionsParam);
    } catch {
      raw = undefined;
    }
    const parsed = ApprovalDecisions.safeParse(raw);
    if (parsed.success) decisions = parsed.data;
    else decisionsError = "Invalid approval decisions; nothing was resumed.";
  }

  // Thread existence handled in service.

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (data: MessageResponse) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      };

      // Initial comment to establish stream
      controller.enqueue(encoder.encode(": connected\n\n"));

      // Run the agent streaming in the background
      (async () => {
        try {
          if (decisionsError) throw new Error(decisionsError);
          const iterable = await streamResponse({
            threadId,
            userText: userContent,
            opts: {
              model,
              provider,
              tools,
              decisions,
              attachments,
            },
          });
          for await (const chunk of iterable) {
            // Only forward AI/tool chunks; ignore human/system
            if (chunk.type === "ai" || chunk.type === "tool") {
              send(chunk);
            }
          }

          // Signal completion
          controller.enqueue(encoder.encode("event: done\n"));
          controller.enqueue(encoder.encode("data: {}\n\n"));
        } catch (err: unknown) {
          // Emit an error event (client onerror will capture general network; providing data for diagnostics)
          controller.enqueue(encoder.encode("event: error\n"));
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ message: (err as Error)?.message || "Stream error", threadId })}\n\n`,
            ),
          );
        } finally {
          controller.close();
        }
      })();
    },
    cancel() {
      // If client disconnects, nothing special yet (LangGraph stream will stop as iteration halts)
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

import React, { useState } from "react";
import type { MessageResponse } from "@/types/message";
import { ChevronDownIcon, ChevronRightIcon, CopyIcon, CheckIcon } from "lucide-react";
import { getToolName } from "@/services/messageUtils";

interface ToolMessageProps {
  message: MessageResponse;
}

type ContentType = "json" | "markdown" | "text";

const detectContentType = (content: string): ContentType => {
  try {
    JSON.parse(content);
    return "json";
  } catch {
    if (
      content.includes("# ") ||
      content.includes("## ") ||
      content.includes("```") ||
      content.includes("*")
    ) {
      return "markdown";
    }
    return "text";
  }
};

const getContentPreview = (content: string, maxLength: number = 100): string => {
  if (content.length <= maxLength) return content;
  return content.slice(0, maxLength) + "...";
};

const getContentStats = (content: string): string => {
  const lines = content.split("\n").length;
  const chars = content.length;
  if (lines > 1) {
    return `${lines} lines, ${chars} chars`;
  }
  return `${chars} chars`;
};

const formatContent = (content: string, contentType: ContentType, isPreview: boolean = false) => {
  if (isPreview) {
    return <div className="text-sm text-gray-600 italic">{getContentPreview(content, 150)}</div>;
  }

  // For very short content, don't use ScrollArea
  const needsScroll = content.length > 500 || content.split("\n").length > 15;

  const contentElement = (() => {
    switch (contentType) {
      case "json":
        try {
          const json = JSON.parse(content);
          return (
            <pre className="rounded bg-gray-100 p-3 font-mono text-sm whitespace-pre-wrap">
              {JSON.stringify(json, null, 2)}
            </pre>
          );
        } catch {
          return (
            <pre className="rounded bg-gray-100 p-3 font-mono text-sm whitespace-pre-wrap">
              {content}
            </pre>
          );
        }
      case "markdown":
        return (
          <div className="rounded bg-gray-100 p-3 text-sm">
            <pre className="font-sans whitespace-pre-wrap">{content}</pre>
          </div>
        );
      case "text":
      default:
        return <div className="rounded bg-gray-100 p-3 text-sm whitespace-pre-wrap">{content}</div>;
    }
  })();

  if (needsScroll) {
    return (
      <div
        className="max-h-96 overflow-y-auto rounded border border-gray-200"
        style={{
          scrollbarWidth: "thin",
          scrollbarColor: "#d1d5db #f3f4f6",
        }}
      >
        {contentElement}
      </div>
    );
  }

  return contentElement;
};

// Helper function to convert content to string
const getContentAsString = (
  content: string | import("@/types/message").ContentItem[] | undefined,
): string => {
  if (!content) return "";
  if (typeof content === "string") return content;
  // For ContentItem arrays, extract text content or stringify
  return JSON.stringify(content, null, 2);
};

export const ToolMessage = ({ message }: ToolMessageProps) => {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const toolName = getToolName(message);
  const displayText = toolName ? `${toolName} response` : "Tool call";
  const content = getContentAsString(message.data?.content);
  const contentType = detectContentType(content);
  const contentStats = getContentStats(content);

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy content:", err);
    }
  };

  return (
    <div className="rounded border border-gray-200 bg-gray-50 transition-colors hover:bg-gray-100">
      <button
        className="flex w-full cursor-pointer items-center justify-between p-4 text-left focus:ring-2 focus:ring-blue-500 focus:outline-none focus:ring-inset"
        onClick={() => setOpen((o) => !o)}
      >
        <div className="flex items-center space-x-2">
          <span className="font-medium text-gray-900">{displayText}</span>
          <span className="text-xs text-gray-500">({contentStats})</span>
        </div>
        <div className="flex items-center space-x-2">
          <button
            onClick={handleCopy}
            className="rounded p-1 text-gray-500 hover:bg-gray-200 hover:text-gray-700 focus:outline-none"
            title="Copy content"
          >
            {copied ? (
              <CheckIcon className="h-3 w-3 text-green-600" />
            ) : (
              <CopyIcon className="h-3 w-3" />
            )}
          </button>
          {open ? (
            <ChevronDownIcon className="h-4 w-4 text-gray-500 transition-transform" />
          ) : (
            <ChevronRightIcon className="h-4 w-4 text-gray-500 transition-transform" />
          )}
        </div>
      </button>

      {!open && content && (
        <div className="px-4 pb-3">{formatContent(content, contentType, true)}</div>
      )}

      <div
        className={`overflow-hidden transition-all duration-300 ease-in-out ${
          open ? "max-h-[600px] opacity-100" : "max-h-0 opacity-0"
        }`}
      >
        {open && (
          <div className="border-t border-gray-200 p-4">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-medium tracking-wide text-gray-600 uppercase">
                {contentType.toUpperCase()} Output
              </span>
            </div>
            {formatContent(content, contentType)}
          </div>
        )}
      </div>
    </div>
  );
};

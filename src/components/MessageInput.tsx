import { FormEvent, useEffect, useRef, useState } from "react";
import { Button } from "./ui/button";
import { ArrowUp, Loader2, Eye, EyeOff, Paperclip, X, ChevronDown } from "lucide-react";
import { MessageOptions, FileAttachment } from "@/types/message";
import { ModelConfiguration } from "./ModelConfiguration";
import { useUISettings } from "@/contexts/UISettingsContext";
import { MAX_ATTACHMENTS } from "@/lib/storage/validation";

interface MessageInputProps {
  onSendMessage: (message: string, opts?: MessageOptions) => Promise<void>;
  isLoading?: boolean;
  maxLength?: number;
}

export const MessageInput = ({
  onSendMessage,
  isLoading = false,
  maxLength = 2000,
}: MessageInputProps) => {
  const [message, setMessage] = useState("");
  const [isFocused, setIsFocused] = useState(false);
  const [modelOpen, setModelOpen] = useState(false);
  const [attachments, setAttachments] = useState<FileAttachment[]>([]);
  const [isUploading, setIsUploading] = useState(false);

  const {
    hideToolMessages,
    toggleToolMessages,
    provider,
    setProvider,
    model,
    setModel,
    approveAllTools,
    setApproveAllTools,
  } = useUISettings();

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const modelRef = useRef<HTMLDivElement | null>(null);

  // Auto-resize textarea based on content
  useEffect(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = "auto";
      textarea.style.height = textarea.scrollHeight + "px";
    }
  }, [message]);

  // Close the model popover on an outside click
  useEffect(() => {
    if (!modelOpen) return;
    function handler(e: MouseEvent) {
      if (modelRef.current && !modelRef.current.contains(e.target as Node)) {
        setModelOpen(false);
      }
    }
    window.addEventListener("mousedown", handler);
    return () => window.removeEventListener("mousedown", handler);
  }, [modelOpen]);

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const remainingSlots = Math.max(0, MAX_ATTACHMENTS - attachments.length);
    if (remainingSlots <= 0) {
      alert(`You can attach up to ${MAX_ATTACHMENTS} files per message.`);
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }

    setIsUploading(true);

    try {
      const selectedFiles = Array.from(files).slice(0, remainingSlots);
      if (selectedFiles.length < files.length) {
        alert(
          `Only the first ${remainingSlots} file(s) were selected (max ${MAX_ATTACHMENTS} attachments).`,
        );
      }

      const uploadPromises = selectedFiles.map(async (file) => {
        const formData = new FormData();
        formData.append("file", file);

        const response = await fetch("/api/agent/upload", {
          method: "POST",
          body: formData,
        });

        if (!response.ok) {
          const error = await response.json();
          throw new Error(error.error || "Upload failed");
        }

        const data = await response.json();
        return {
          url: data.url,
          key: data.key,
          name: data.name,
          type: data.type,
          size: data.size,
        } as FileAttachment;
      });

      const uploadedFiles = await Promise.all(uploadPromises);
      setAttachments((prev) => [...prev, ...uploadedFiles]);
    } catch (error) {
      console.error("File upload error:", error);
      alert(error instanceof Error ? error.message : "Failed to upload files");
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  const removeAttachment = (key: string) => {
    setAttachments((prev) => prev.filter((att) => att.key !== key));
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if ((!message.trim() && attachments.length === 0) || isLoading) return;

    await onSendMessage(message, {
      model,
      provider,
      tools: [],
      approveAllTools: approveAllTools,
      attachments: attachments.length > 0 ? attachments : undefined,
    });
    setMessage("");
    setAttachments([]);
  };

  const remainingChars = maxLength - message.length;
  const isNearLimit = remainingChars < maxLength * 0.1;
  const canSend = (message.trim() || attachments.length > 0) && !isLoading;

  return (
    <form onSubmit={handleSubmit} className="relative">
      <div
        className={`bg-card relative mx-auto flex max-w-3xl flex-col rounded-xl border transition-colors ${
          isFocused ? "border-brand" : "border-border"
        }`}
      >
        {/* Input */}
        <div className="px-4 pt-3 pb-2">
          {attachments.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-2">
              {attachments.map((attachment) => (
                <div
                  key={attachment.key}
                  className="bg-muted flex items-center gap-2 rounded-md px-3 py-1.5 text-sm"
                >
                  <span className="max-w-50 truncate">{attachment.name}</span>
                  <span className="text-muted-foreground text-xs">
                    ({attachment.size < 1024 ? "<1KB" : `${(attachment.size / 1024).toFixed(0)}KB`})
                  </span>
                  <button
                    type="button"
                    onClick={() => removeAttachment(attachment.key)}
                    className="text-muted-foreground hover:text-foreground ml-1"
                    aria-label="Remove attachment"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="flex items-start gap-2.5">
            <span aria-hidden className="text-brand-dim mt-0.5 font-mono text-sm leading-6">
              $
            </span>
            <textarea
              value={message}
              ref={textareaRef}
              onChange={(e) => setMessage(e.target.value)}
              onFocus={() => setIsFocused(true)}
              onBlur={() => setIsFocused(false)}
              placeholder="Ask about your money…"
              className="placeholder:text-muted-foreground max-h-50 min-h-12 w-full flex-1 resize-none overflow-auto bg-transparent leading-6 focus:outline-none"
              rows={1}
              aria-label="Message input"
              disabled={isLoading}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSubmit(e);
                }
              }}
            />
          </div>

          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept="image/png,image/jpeg,application/pdf,text/markdown,text/plain,.md,.markdown,.txt"
            onChange={handleFileSelect}
            className="hidden"
            aria-label="File upload"
          />
        </div>

        {/* Toolbar */}
        <div className="border-border bg-background flex items-center justify-between gap-3 rounded-b-xl border-t px-3 py-2">
          <div className="flex items-center gap-1.5">
            {/* Model chip + popover */}
            <div className="relative" ref={modelRef}>
              <button
                type="button"
                onClick={() => setModelOpen((o) => !o)}
                aria-expanded={modelOpen}
                aria-label="Model settings"
                className="border-border hover:bg-accent flex cursor-pointer items-center gap-1.5 rounded-md border px-2.5 py-1 font-mono text-[11px] transition-colors"
              >
                <span className="bg-brand h-2 w-2 rounded-full" />
                {model}
                <ChevronDown className="h-3 w-3" />
              </button>
              {modelOpen && (
                <div className="border-border bg-popover absolute bottom-full left-0 z-50 mb-2 w-72 rounded-lg border p-3 shadow-lg">
                  <ModelConfiguration
                    provider={provider}
                    setProvider={setProvider}
                    model={model}
                    setModel={setModel}
                  />
                </div>
              )}
            </div>

            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => fileInputRef.current?.click()}
              disabled={isLoading || isUploading || attachments.length >= MAX_ATTACHMENTS}
              className="text-muted-foreground h-7 gap-1.5 px-2.5 font-mono text-[11px]"
              aria-label="Attach file"
            >
              {isUploading ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Paperclip className="h-3.5 w-3.5" />
              )}
              attach
            </Button>

            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={toggleToolMessages}
              className="text-muted-foreground h-7 gap-1.5 px-2.5 font-mono text-[11px]"
              aria-label={hideToolMessages ? "Show tool messages" : "Hide tool messages"}
            >
              {hideToolMessages ? (
                <EyeOff className="h-3.5 w-3.5" />
              ) : (
                <Eye className="h-3.5 w-3.5" />
              )}
              {hideToolMessages ? "show tools" : "hide tools"}
            </Button>
          </div>

          <div className="flex items-center gap-3">
            <span
              className={`font-mono text-[10px] ${isNearLimit ? "text-brand-dim" : "text-muted-foreground"}`}
            >
              {remainingChars}
            </span>

            {/* The approval gate is Cameron's first rule — the switch that disables it is labelled. */}
            <label className="flex cursor-pointer items-center gap-2 select-none">
              <input
                type="checkbox"
                className="peer sr-only"
                checked={!approveAllTools}
                onChange={(e) => setApproveAllTools(!e.target.checked)}
                aria-label="Approval gate"
              />
              <span
                className={`peer-focus-visible:ring-ring relative block h-4 w-7 rounded-full border transition-colors peer-focus-visible:ring-2 ${
                  approveAllTools ? "bg-muted border-border" : "bg-brand/25 border-brand"
                }`}
              >
                <span
                  className={`absolute top-0.5 left-0.5 block h-2.5 w-2.5 rounded-full transition-transform ${
                    approveAllTools ? "bg-muted-foreground" : "bg-brand translate-x-3"
                  }`}
                />
              </span>
              <span className="text-muted-foreground font-mono text-[10px]">
                {approveAllTools ? "gate off" : "gate on"}
              </span>
            </label>

            <Button
              type="submit"
              size="sm"
              disabled={!canSend}
              className={`flex h-7 w-7 cursor-pointer items-center justify-center rounded-md p-0 ${
                canSend ? "bg-brand text-brand-foreground hover:bg-brand-bright" : ""
              }`}
              aria-label="Send message"
            >
              {isLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <ArrowUp className="h-4 w-4" />
              )}
            </Button>
          </div>
        </div>
      </div>
    </form>
  );
};

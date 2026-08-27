import type {
  MessageResponse,
  BasicMessageData,
  FileAttachment,
  ImageUrlContentItem,
  TextContentItem,
} from "@/types/message";
import { UserIcon, FileText, Image as ImageIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { getMessageContent } from "@/services/messageUtils";

interface HumanMessageProps {
  message: MessageResponse;
}

type ContentItem = ImageUrlContentItem | TextContentItem | { type: string };

export const HumanMessage = ({ message }: HumanMessageProps) => {
  const data = message.data as BasicMessageData;
  const attachments = [...(data.attachments || [])];

  // Extract attachments from content array (for messages loaded from checkpoint)
  if (message.data?.content && Array.isArray(message.data.content)) {
    const contentAttachments = (message.data.content as ContentItem[])
      .filter(
        (item): item is ImageUrlContentItem | TextContentItem =>
          // Images/PDFs with image_url
          (item.type === "image_url" && "image_url" in item && !!item.image_url) ||
          // Text files with file_metadata
          (item.type === "text" && "file_metadata" in item && !!item.file_metadata),
      )
      .map((item) => {
        if (item.file_metadata) {
          return item.file_metadata;
        }
        return null;
      })
      .filter((att): att is FileAttachment => att !== null);
    attachments.push(...contentAttachments);
  }

  return (
    <div className="flex justify-end gap-3">
      <div className="max-w-[80%]">
        <div
          className={cn(
            "rounded-2xl px-4 py-2",
            "bg-card border-border text-foreground border",
            "supports-[backdrop-filter]:bg-card/90 backdrop-blur-sm",
          )}
        >
          {/* File Attachments */}
          {attachments.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-2">
              {attachments.map((attachment) => (
                <div
                  key={attachment.key}
                  className="bg-muted flex items-center gap-2 rounded-md px-2 py-1 text-xs"
                >
                  {attachment.type.startsWith("image/") ? (
                    <>
                      <ImageIcon className="h-3.5 w-3.5" />
                      <img
                        src={attachment.url}
                        alt={attachment.name}
                        className="my-0 h-20 w-20 rounded object-cover"
                      />
                    </>
                  ) : (
                    <>
                      <FileText className="h-3.5 w-3.5" />
                      <a
                        href={attachment.url}
                        download={attachment.name}
                        className="max-w-[150px] truncate hover:underline"
                      >
                        {attachment.name}
                      </a>
                    </>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Message Text */}
          <div className="prose dark:prose-invert max-w-none">
            <p className="my-0">{getMessageContent(message)}</p>
          </div>
        </div>
      </div>
      <div className="bg-brand/15 flex h-8 w-8 shrink-0 items-center justify-center rounded-full">
        <UserIcon className="text-brand-dim h-5 w-5" />
      </div>
    </div>
  );
};

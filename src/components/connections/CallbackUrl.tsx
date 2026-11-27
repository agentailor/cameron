"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { iconButton } from "./styles";

/**
 * The OAuth redirect URI, as the server will send it, with a copy button. Null when the app URL
 * isn't configured (production without NEXT_PUBLIC_APP_URL).
 */
export function CallbackUrl({ url }: { url: string | null }) {
  const [copied, setCopied] = useState(false);

  if (!url) {
    return (
      <p className="text-destructive text-xs">
        Set NEXT_PUBLIC_APP_URL to Cameron&apos;s public address: the callback URL depends on it.
      </p>
    );
  }

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard blocked (insecure context): the URL is still selectable.
    }
  };

  return (
    <div className="border-border bg-muted/40 flex items-center gap-1 rounded-md border py-0.5 pr-0.5 pl-2.5">
      <code className="text-foreground min-w-0 flex-1 truncate font-mono text-xs select-all">
        {url}
      </code>
      <button
        type="button"
        onClick={copy}
        className={iconButton}
        aria-label={copied ? "Copied" : "Copy callback URL"}
        title={copied ? "Copied" : "Copy"}
      >
        {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
      </button>
    </div>
  );
}

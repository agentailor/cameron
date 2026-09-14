import Link from "next/link";
import { SlidersHorizontal } from "lucide-react";

export const NotConfiguredNotice = () => (
  <div className="border-border bg-card mx-auto max-w-3xl rounded-xl border p-4">
    <p className="text-foreground text-sm font-medium">No model provider configured</p>
    <p className="text-muted-foreground mt-1.5 text-sm leading-relaxed">
      Cameron needs a provider and model before it can answer. Your existing conversations are still
      here to read.
    </p>
    <Link
      href="/settings"
      className="text-brand mt-3 inline-flex items-center gap-1.5 text-sm hover:underline"
    >
      <SlidersHorizontal className="h-3.5 w-3.5" />
      Open Settings
    </Link>
  </div>
);

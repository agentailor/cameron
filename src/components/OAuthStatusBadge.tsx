"use client";

export type OAuthStatusType = "UNKNOWN" | "NOT_REQUIRED" | "REQUIRED" | "CONNECTED" | "EXPIRED";

interface OAuthStatusBadgeProps {
  status?: OAuthStatusType | string | null;
}

const statusConfig: Partial<Record<OAuthStatusType, { label: string; dot: string }>> = {
  REQUIRED: { label: "auth required", dot: "bg-term-yellow" },
  CONNECTED: { label: "oauth connected", dot: "bg-term-green" },
  EXPIRED: { label: "auth expired", dot: "bg-term-red" },
};

/** A status dot + mono label, like the sidebar's status line. Nothing when auth isn't in play. */
export function OAuthStatusBadge({ status }: OAuthStatusBadgeProps) {
  const config = status ? statusConfig[status as OAuthStatusType] : undefined;
  if (!config) return null;

  return (
    <span className="text-muted-foreground inline-flex items-center gap-1.5 font-mono text-[10px]">
      <span aria-hidden className={`block h-1.5 w-1.5 rounded-full ${config.dot}`} />
      {config.label}
    </span>
  );
}

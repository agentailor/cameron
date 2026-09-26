"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { useMCPServers } from "@/hooks/useMCPServers";

/**
 * Points from the built-in tools to the connections page. Counts servers from the database
 * only; counting their tools would mean connecting to every one of them.
 */
export function ConnectedServersLink() {
  const { servers } = useMCPServers();
  const enabled = servers?.filter((s) => s.enabled).length ?? 0;

  const text = !servers
    ? "MCP servers you connect add more tools"
    : enabled
      ? `${enabled} connected server${enabled === 1 ? "" : "s"} add${enabled === 1 ? "s" : ""} more tools`
      : "Connect an MCP server to give Cameron more tools";

  return (
    <Link
      href="/connections"
      className="text-foreground hover:text-muted-foreground mt-4 inline-flex items-center gap-1.5 text-sm underline-offset-4 transition-colors hover:underline"
    >
      {text}
      <ArrowRight size={14} />
    </Link>
  );
}

import { useQuery } from "@tanstack/react-query";
import { MCPToolsData } from "@/types/mcp";

async function fetchMCPTools(): Promise<MCPToolsData> {
  const response = await fetch("/api/mcp-tools");
  if (!response.ok) {
    throw new Error("Failed to fetch MCP tools");
  }
  return response.json();
}

export function useMCPTools() {
  return useQuery({
    queryKey: ["mcp-tools"],
    queryFn: fetchMCPTools,
    staleTime: 30000, // 30 seconds
    gcTime: 60000, // 1 minute
    refetchOnWindowFocus: false,
  });
}

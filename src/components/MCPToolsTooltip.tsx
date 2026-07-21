import { MCPToolsData } from "@/types/mcp";

interface MCPToolsTooltipProps {
  data: MCPToolsData;
  isVisible: boolean;
  className?: string;
}

export function MCPToolsTooltip({ data, isVisible, className = "" }: MCPToolsTooltipProps) {
  if (!isVisible || data.totalCount === 0) return null;

  // Flatten all tools from all servers into a single list
  const allTools: string[] = [];
  Object.keys(data.serverGroups).forEach((serverName) => {
    data.serverGroups[serverName].tools.forEach((tool) => {
      allTools.push(`${serverName}__${tool.name}`);
    });
  });

  return (
    <div
      className={`absolute z-50 w-64 rounded-lg border border-gray-200 bg-white p-3 shadow-lg dark:border-gray-600 dark:bg-gray-800 ${className}`}
    >
      <div className="mb-2">
        <h4 className="text-sm font-medium text-gray-900 dark:text-gray-100">
          Available MCP Tools ({data.totalCount})
        </h4>
      </div>

      <div className="max-h-48 space-y-1 overflow-y-auto">
        {allTools.map((toolName, index) => (
          <div key={index} className="flex items-center gap-2">
            <span className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-gray-400"></span>
            <span className="font-mono text-xs text-gray-600 dark:text-gray-400">{toolName}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

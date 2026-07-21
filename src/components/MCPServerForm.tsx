"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { X, Loader2, Check, Wand2 } from "lucide-react";
import { MCPServerType } from "@/types/mcp";

interface MCPServer {
  id?: string;
  name: string;
  type: MCPServerType;
  enabled: boolean;
  command?: string;
  args?: unknown[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
}

interface MCPServerFormProps {
  isOpen: boolean;
  onClose: () => void;
  onSaved: () => void;
  server?: MCPServer;
}

export function MCPServerForm({ isOpen, onClose, onSaved, server }: MCPServerFormProps) {
  const [jsonInput, setJsonInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [isValidJson, setIsValidJson] = useState(true);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Function to generate JSON for server
  const generateServerJson = useCallback((serverData?: MCPServer) => {
    if (serverData) {
      const serverConfig: Record<string, unknown> = {
        transport: serverData.type,
      };

      if (serverData.type === "stdio") {
        serverConfig.command = serverData.command;
        if (serverData.args) serverConfig.args = serverData.args;
        if (serverData.env) serverConfig.env = serverData.env;
      } else {
        serverConfig.url = serverData.url;
        if (serverData.headers) serverConfig.headers = serverData.headers;
      }

      return JSON.stringify(
        {
          mcpServers: {
            [serverData.name]: serverConfig,
          },
        },
        null,
        2,
      );
    }

    return JSON.stringify(
      {
        mcpServers: {
          example_server: {
            transport: "stdio",
            command: "python",
            args: ["server.py"],
            env: { API_KEY: "your_key" },
          },
          remote_server: {
            transport: "http",
            url: "http://localhost:8000/mcp/",
            headers: { Authorization: "Bearer token" },
          },
        },
      },
      null,
      2,
    );
  }, []);

  // JSON validation function
  const validateJson = useCallback((jsonString: string) => {
    if (!jsonString.trim()) {
      setValidationError(null);
      setIsValidJson(true);
      return true;
    }

    try {
      const parsed = JSON.parse(jsonString);
      if (!parsed.mcpServers || typeof parsed.mcpServers !== "object") {
        setValidationError("Invalid format: missing mcpServers object");
        setIsValidJson(false);
        return false;
      }
      setValidationError(null);
      setIsValidJson(true);
      return true;
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : "Invalid JSON";
      setValidationError(`JSON Syntax Error: ${errorMsg}`);
      setIsValidJson(false);
      return false;
    }
  }, []);

  // Update form when server prop changes
  useEffect(() => {
    const newJson = generateServerJson(server);
    setJsonInput(newJson);
    validateJson(newJson);
  }, [server, generateServerJson, validateJson]);

  // Format JSON function
  const formatJson = useCallback(() => {
    try {
      const parsed = JSON.parse(jsonInput);
      const formatted = JSON.stringify(parsed, null, 2);
      setJsonInput(formatted);
      validateJson(formatted);
    } catch {
      // If parsing fails, validation will show the error
      validateJson(jsonInput);
    }
  }, [jsonInput, validateJson]);

  // Handle JSON input change with validation
  const handleJsonChange = useCallback(
    (value: string) => {
      setJsonInput(value);
      // Debounce validation to avoid excessive calls
      const timeoutId = setTimeout(() => validateJson(value), 300);
      return () => clearTimeout(timeoutId);
    },
    [validateJson],
  );

  // Handle paste with auto-format
  const handlePaste = useCallback(
    (e: React.ClipboardEvent) => {
      const pastedText = e.clipboardData.getData("text");
      try {
        const parsed = JSON.parse(pastedText);
        const formatted = JSON.stringify(parsed, null, 2);
        e.preventDefault();
        setJsonInput(formatted);
        validateJson(formatted);
      } catch {
        // If not valid JSON, let default paste behavior happen
      }
    },
    [validateJson],
  );

  const handleSave = async () => {
    setSaving(true);
    setError(null);

    // Final validation before saving
    if (!validateJson(jsonInput)) {
      setSaving(false);
      setError(validationError || "Please fix JSON validation errors before saving");
      return;
    }

    try {
      const parsed = JSON.parse(jsonInput);

      if (!parsed.mcpServers || typeof parsed.mcpServers !== "object") {
        throw new Error("Invalid format: missing mcpServers object");
      }

      const serverEntries = Object.entries(parsed.mcpServers);

      for (const [name, config] of serverEntries) {
        const serverConfig = config as Record<string, unknown>;

        if (
          !serverConfig.transport ||
          !["stdio", "http"].includes(serverConfig.transport as string)
        ) {
          throw new Error(`Invalid transport for ${name}: must be "stdio" or "http"`);
        }

        if (serverConfig.transport === "stdio" && !serverConfig.command) {
          throw new Error(`Missing command for stdio server: ${name}`);
        }

        if (serverConfig.transport === "http" && !serverConfig.url) {
          throw new Error(`Missing url for http server: ${name}`);
        }

        const serverData = {
          name,
          type: serverConfig.transport as MCPServerType,
          command: serverConfig.transport === "stdio" ? serverConfig.command : undefined,
          args: serverConfig.transport === "stdio" ? serverConfig.args : undefined,
          env: serverConfig.transport === "stdio" ? serverConfig.env : undefined,
          url: serverConfig.transport === "http" ? serverConfig.url : undefined,
          headers: serverConfig.transport === "http" ? serverConfig.headers : undefined,
        };

        const method = server ? "PATCH" : "POST";
        const body = server ? { ...serverData, id: server.id } : serverData;

        const response = await fetch("/api/mcp-servers", {
          method,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });

        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.error || `Failed to save server: ${name}`);
        }
      }

      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save configuration");
    } finally {
      setSaving(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="max-h-[90vh] w-full max-w-2xl overflow-hidden rounded-lg bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-gray-200 p-4">
          <h2 className="text-lg font-semibold text-gray-900">
            {server ? "Edit MCP Server" : "Configure MCP Servers"}
          </h2>
          <button
            onClick={onClose}
            className="cursor-pointer text-gray-400 transition-colors hover:text-gray-600"
          >
            <X size={20} />
          </button>
        </div>

        <div className="max-h-[calc(90vh-120px)] overflow-y-auto p-4">
          <div className="space-y-4">
            <div>
              <div className="mb-2 flex items-center justify-between">
                <label className="block text-sm font-medium text-gray-700">
                  MCP Server Configuration (JSON)
                </label>
                <button
                  type="button"
                  onClick={formatJson}
                  className="flex items-center gap-1.5 rounded-md bg-gray-100 px-2 py-1 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-200"
                  title="Format JSON"
                >
                  <Wand2 size={12} />
                  Format
                </button>
              </div>
              <div className="relative">
                <textarea
                  ref={textareaRef}
                  value={jsonInput}
                  onChange={(e) => handleJsonChange(e.target.value)}
                  onPaste={handlePaste}
                  className={`focus:ring-ring/40 h-64 w-full rounded-md border p-3 font-mono text-sm transition-colors focus:ring-2 focus:outline-none ${
                    validationError
                      ? "border-red-300 bg-red-50/30 focus:border-red-500"
                      : isValidJson && jsonInput.trim()
                        ? "focus:border-primary border-green-300 bg-green-50/20"
                        : "focus:border-primary border-gray-300"
                  }`}
                  placeholder="Enter JSON configuration..."
                />
                {validationError && (
                  <div className="absolute top-2 right-2 rounded bg-red-100 px-2 py-1">
                    <span className="text-xs text-red-600">❌</span>
                  </div>
                )}
                {!validationError && isValidJson && jsonInput.trim() && (
                  <div className="absolute top-2 right-2 rounded bg-green-100 px-2 py-1">
                    <span className="text-xs text-green-600">✅</span>
                  </div>
                )}
              </div>
              {validationError && <p className="mt-1 text-xs text-red-600">{validationError}</p>}
              <p className="mt-2 text-xs text-gray-500">
                Configure both local (stdio) and remote (http) MCP servers. Paste JSON to
                auto-format.
              </p>
            </div>

            {error && (
              <div className="rounded-md border border-red-200 bg-red-50 p-3">
                <p className="text-sm text-red-600">{error}</p>
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 border-t border-gray-200 bg-gray-50 p-4">
          <button
            onClick={onClose}
            className="cursor-pointer rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="bg-primary text-primary-foreground hover:bg-primary/90 flex cursor-pointer items-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                Saving...
              </>
            ) : (
              <>
                <Check size={16} />
                Save Configuration
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

import { describe, expect, it } from "vitest";
import type { OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import { MCPServerType, type MCPServer } from "@/types/mcp";
import { toServerConfig } from "./serverConfig";

const makeServer = (overrides: Partial<MCPServer> = {}): MCPServer => ({
  id: "s1",
  name: "files",
  type: MCPServerType.stdio,
  enabled: true,
  command: null,
  args: null,
  env: null,
  url: null,
  headers: null,
  requiresAuth: null,
  authTokens: null,
  clientInfo: null,
  codeVerifier: null,
  oauthStatus: null,
  createdAt: new Date(0),
  updatedAt: new Date(0),
  ...overrides,
});

const provider = {} as OAuthClientProvider;

describe("toServerConfig", () => {
  it("builds a stdio config, dropping non-string args", () => {
    const config = toServerConfig(
      makeServer({ command: "npx", args: ["-y", 3, "pkg"], env: { TOKEN: "x" } }),
    );
    expect(config).toEqual({
      transport: "stdio",
      command: "npx",
      args: ["-y", "pkg"],
      env: { TOKEN: "x" },
    });
  });

  it("builds an http config with headers", () => {
    const config = toServerConfig(
      makeServer({ type: MCPServerType.http, url: "https://x.dev/mcp", headers: { A: "b" } }),
    );
    expect(config).toEqual({ transport: "http", url: "https://x.dev/mcp", headers: { A: "b" } });
  });

  it("returns null when the command or url is missing", () => {
    expect(toServerConfig(makeServer())).toBeNull();
    expect(toServerConfig(makeServer({ type: MCPServerType.http }))).toBeNull();
  });

  it("attaches the auth provider only to a connected OAuth server", () => {
    const http = { type: MCPServerType.http, url: "https://x.dev/mcp", requiresAuth: true };
    const connected = toServerConfig(
      makeServer({ ...http, oauthStatus: "CONNECTED" }),
      () => provider,
    );
    const required = toServerConfig(
      makeServer({ ...http, oauthStatus: "REQUIRED" }),
      () => provider,
    );

    expect(connected).toMatchObject({ authProvider: provider });
    expect(required).not.toHaveProperty("authProvider");
  });
});

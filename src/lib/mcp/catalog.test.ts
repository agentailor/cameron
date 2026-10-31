import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { McpSession, ServerCatalogEntry } from "@agentailor/mcp-disclosure";
import { MCPServerType, type MCPServer } from "@/types/mcp";

const mocks = vi.hoisted(() => ({
  listEnabled: vi.fn(),
  listByServerIds: vi.fn(),
  get: vi.fn(),
  upsert: vi.fn(),
  openSession: vi.fn(),
  createServerSummarizer: vi.fn(),
}));

vi.mock("@/lib/repositories/mcpServerRepository", () => ({ listEnabled: mocks.listEnabled }));
vi.mock("@/lib/repositories/mcpServerCatalogRepository", () => ({
  listByServerIds: mocks.listByServerIds,
  get: mocks.get,
  upsert: mocks.upsert,
}));
vi.mock("@/lib/mcp/connector", () => ({
  ConnectError: class extends Error {},
  needsAuth: () => false,
  openSession: mocks.openSession,
}));
vi.mock("@/lib/mcp/summarize", () => ({ createServerSummarizer: mocks.createServerSummarizer }));

import { CATALOG_WAIT_MS, loadDisclosureServers } from "./catalog";

const server: MCPServer = {
  id: "s1",
  name: "notion",
  description: null,
  type: MCPServerType.stdio,
  enabled: true,
  command: "npx",
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
};

const session: McpSession = {
  manifest: async () => ({ tools: [{ name: "search" }] }),
  getTool: () => undefined,
  close: async () => {},
};

describe("loadDisclosureServers with no catalog row", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.resetAllMocks();
    mocks.listEnabled.mockResolvedValue([server]);
    mocks.listByServerIds.mockResolvedValue([]);
    mocks.get.mockResolvedValue(null);
  });
  afterEach(() => vi.useRealTimers());

  it("uses the row when the refresh finishes within the wait", async () => {
    mocks.openSession.mockResolvedValue(session);
    const { servers } = await loadDisclosureServers();
    expect(servers[0].catalog?.toolCount).toBe(1);
  });

  it("generates a summary when the owner wrote no description", async () => {
    mocks.openSession.mockResolvedValue(session);
    mocks.createServerSummarizer.mockResolvedValue(async () => "Search my workspace.");
    const { servers } = await loadDisclosureServers();
    expect(servers[0].catalog?.summary).toBe("Search my workspace.");
    expect(servers[0].catalog?.summarySource).toBe("generated");
  });

  it("generates nothing when the owner wrote a description, and passes it through", async () => {
    mocks.listEnabled.mockResolvedValue([{ ...server, description: "My budget pages" }]);
    mocks.openSession.mockResolvedValue(session);
    const { servers } = await loadDisclosureServers();
    expect(mocks.createServerSummarizer).not.toHaveBeenCalled();
    expect(servers[0].description).toBe("My budget pages");
  });

  it("stops waiting on a slow server, and the refresh still writes its row", async () => {
    let connect!: (s: McpSession) => void;
    mocks.openSession.mockReturnValue(new Promise((resolve) => (connect = resolve)));
    vi.spyOn(console, "log").mockImplementation(() => {});

    const loading = loadDisclosureServers();
    await vi.advanceTimersByTimeAsync(CATALOG_WAIT_MS);
    const { servers } = await loading;
    expect(servers[0].catalog).toBeNull();
    expect(mocks.upsert).not.toHaveBeenCalled();

    connect(session);
    await vi.advanceTimersByTimeAsync(0);
    const written = mocks.upsert.mock.calls[0][0] as ServerCatalogEntry;
    expect(written.serverId).toBe("s1");
  });

  it("joins a refresh already running instead of connecting again", async () => {
    let connect!: (s: McpSession) => void;
    mocks.openSession.mockReturnValue(new Promise((resolve) => (connect = resolve)));
    vi.spyOn(console, "log").mockImplementation(() => {});

    for (let message = 0; message < 2; message++) {
      const loading = loadDisclosureServers();
      await vi.advanceTimersByTimeAsync(CATALOG_WAIT_MS);
      await loading;
    }
    expect(mocks.openSession).toHaveBeenCalledTimes(1);
    connect(session);
    await vi.advanceTimersByTimeAsync(0);
  });
});

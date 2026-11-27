import { describe, expect, it } from "vitest";
import { MCPServerType, type MCPServer } from "@/types/mcp";
import { toPublicServer } from "./publicServer";

const server: MCPServer = {
  id: "s1",
  name: "gmail",
  description: null,
  type: MCPServerType.http,
  enabled: true,
  command: null,
  args: null,
  env: null,
  url: "https://gmailmcp.googleapis.com/mcp/v1",
  headers: { "X-Key": "header-value" },
  requiresAuth: true,
  authTokens: { access_token: "ACCESS", refresh_token: "REFRESH" },
  clientInfo: { client_id: "dcr", client_secret: "DCR_SECRET" },
  codeVerifier: "VERIFIER",
  oauthState: "STATE",
  oauthStatus: "CONNECTED",
  oauthClient: { clientId: "own", clientSecret: "OWN_SECRET", scope: "gmail.readonly" },
  createdAt: new Date(0),
  updatedAt: new Date(0),
};

describe("toPublicServer", () => {
  it("leaves out tokens, registrations, the verifier, the state and the client secret", () => {
    const wire = JSON.stringify(toPublicServer(server));
    for (const secret of ["ACCESS", "REFRESH", "DCR_SECRET", "VERIFIER", "STATE", "OWN_SECRET"]) {
      expect(wire).not.toContain(secret);
    }
  });

  it("keeps what the form edits", () => {
    const view = toPublicServer(server);
    expect(view.headers).toEqual({ "X-Key": "header-value" });
    expect(view.oauthClient).toEqual({
      clientId: "own",
      hasSecret: true,
      scope: "gmail.readonly",
      authorizationParams: {},
    });
  });

  it("is an allowlist: a field added to the domain object stays out", () => {
    const extended = { ...server, futureSecret: "NEW" } as MCPServer;
    expect(JSON.stringify(toPublicServer(extended))).not.toContain("NEW");
  });
});

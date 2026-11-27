import { beforeEach, describe, expect, it, vi } from "vitest";
import { auth } from "@modelcontextprotocol/client";
import { MCPServerType, type MCPServer } from "@/types/mcp";

const store = vi.hoisted(() => ({
  clientInfo: undefined as unknown,
  tokens: undefined as unknown,
  verifier: null as string | null,
  state: null as string | null,
  cleared: [] as string[],
}));

vi.mock("@/lib/repositories/mcpServerRepository", () => ({
  getClientInfo: async () => store.clientInfo,
  saveClientInfo: async (_id: string, info: unknown) => void (store.clientInfo = info),
  getTokens: async () => store.tokens,
  saveTokens: async (_id: string, tokens: unknown) => void (store.tokens = tokens),
  getCodeVerifier: async () => store.verifier,
  saveCodeVerifier: async (_id: string, v: string) => void (store.verifier = v),
  saveOAuthState: async (_id: string, s: string) => void (store.state = s),
  clearOAuthCredentials: async (_id: string, scope: string) => void store.cleared.push(scope),
}));
vi.mock("@/lib/config/app-url", () => ({
  getAppUrl: () => "http://localhost:3100",
  oauthCallbackUrl: () => "http://localhost:3100/api/oauth/callback",
}));

import { ServerOAuthProvider } from "./oauth-provider";

const CALLBACK = "http://localhost:3100/api/oauth/callback";

const makeServer = (overrides: Partial<MCPServer> = {}): MCPServer => ({
  id: "s1",
  name: "gmail",
  description: null,
  type: MCPServerType.http,
  enabled: true,
  command: null,
  args: null,
  env: null,
  url: "https://gmailmcp.googleapis.com/mcp/v1",
  headers: null,
  requiresAuth: null,
  authTokens: null,
  clientInfo: null,
  codeVerifier: null,
  oauthState: null,
  oauthStatus: "REQUIRED",
  oauthClient: null,
  createdAt: new Date(0),
  updatedAt: new Date(0),
  ...overrides,
});

const google = {
  clientId: "own.apps.googleusercontent.com",
  clientSecret: "own-secret",
  scope: "https://www.googleapis.com/auth/gmail.readonly",
  authorizationParams: { access_type: "offline", prompt: "consent" },
};

beforeEach(() => {
  store.clientInfo = undefined;
  store.tokens = undefined;
  store.verifier = null;
  store.state = null;
  store.cleared = [];
});

describe("ServerOAuthProvider", () => {
  it("uses the one shared callback for every server", () => {
    expect(new ServerOAuthProvider(makeServer()).redirectUrl).toBe(CALLBACK);
    expect(new ServerOAuthProvider(makeServer({ id: "s2" })).redirectUrl).toBe(CALLBACK);
  });

  it("stores a fresh, single sign-in state each time", async () => {
    const provider = new ServerOAuthProvider(makeServer());
    const first = await provider.state();
    expect(store.state).toBe(first);
    expect(await provider.state()).not.toBe(first);
    expect(first.length).toBeGreaterThanOrEqual(43);
  });

  describe("dynamic registration (no configured client)", () => {
    it("returns the registered client registered for this callback", async () => {
      store.clientInfo = { client_id: "dcr", redirect_uris: [CALLBACK] };
      const provider = new ServerOAuthProvider(makeServer());
      expect(await provider.clientInformation()).toEqual(store.clientInfo);
      expect(provider.requestedScope).toBeUndefined();
    });

    it("ignores a client registered for another callback, so the SDK registers again", async () => {
      store.clientInfo = { client_id: "dcr", redirect_uris: [`${CALLBACK}/s1`] };
      expect(await new ServerOAuthProvider(makeServer()).clientInformation()).toBeUndefined();
    });

    it("saves and invalidates the registration", async () => {
      const provider = new ServerOAuthProvider(makeServer());
      await provider.saveClientInformation({ client_id: "new" });
      expect(store.clientInfo).toEqual({ client_id: "new" });
      await provider.invalidateCredentials("client");
      expect(store.cleared).toEqual(["client"]);
    });
  });

  describe("pre-registered client", () => {
    const server = makeServer({ oauthClient: google });

    it("returns the configured client and never overwrites it", async () => {
      const provider = new ServerOAuthProvider(server);
      expect(await provider.clientInformation()).toEqual({
        client_id: google.clientId,
        client_secret: google.clientSecret,
      });
      await provider.saveClientInformation({ client_id: "stamped" });
      expect(store.clientInfo).toBeUndefined();
    });

    it("drops only the sign-in when the SDK calls the client invalid", async () => {
      const provider = new ServerOAuthProvider(server);
      await provider.invalidateCredentials("client");
      await provider.invalidateCredentials("all");
      expect(store.cleared).toEqual(["signin", "signin"]);
    });

    it("adds its authorization parameters but never a reserved one", async () => {
      const provider = new ServerOAuthProvider(
        makeServer({
          oauthClient: { ...google, authorizationParams: { prompt: "consent", state: "evil" } },
        }),
      );
      const url = new URL("https://accounts.google.com/o/oauth2/v2/auth?state=real&prompt=none");
      await provider.redirectToAuthorization(url);
      expect(url.searchParams.get("prompt")).toBe("consent");
      expect(url.searchParams.getAll("prompt")).toHaveLength(1);
      expect(url.searchParams.get("state")).toBe("real");
    });

    it("runs the SDK flow against Google's metadata without registering", async () => {
      const requested: string[] = [];
      const fetchFn = vi.fn(async (input: string | URL, init?: RequestInit) => {
        const url = String(input);
        requested.push(`${init?.method ?? "GET"} ${url}`);
        if (url === "https://gmailmcp.googleapis.com/.well-known/oauth-protected-resource/mcp/v1") {
          return Response.json({
            resource: "https://gmailmcp.googleapis.com/mcp/v1",
            authorization_servers: ["https://accounts.google.com/"],
            scopes_supported: ["https://mail.google.com/", google.scope],
          });
        }
        if (url === "https://accounts.google.com/.well-known/oauth-authorization-server") {
          return Response.json({
            issuer: "https://accounts.google.com",
            authorization_endpoint: "https://accounts.google.com/o/oauth2/v2/auth",
            token_endpoint: "https://oauth2.googleapis.com/token",
            response_types_supported: ["code"],
            code_challenge_methods_supported: ["plain", "S256"],
            token_endpoint_auth_methods_supported: ["client_secret_post", "client_secret_basic"],
          });
        }
        if (url === "https://oauth2.googleapis.com/token") {
          return Response.json({
            access_token: "at",
            refresh_token: "rt",
            token_type: "Bearer",
            expires_in: 3599,
          });
        }
        return new Response("not found", { status: 404 });
      });

      const provider = new ServerOAuthProvider(server);
      const serverUrl = server.url!;
      const started = await auth(provider, {
        serverUrl,
        scope: provider.requestedScope,
        fetchFn: fetchFn as unknown as typeof fetch,
      });
      expect(started).toBe("REDIRECT");

      const url = provider.pendingAuthorizationUrl!;
      expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
      expect(url.searchParams.get("client_id")).toBe(google.clientId);
      expect(url.searchParams.get("redirect_uri")).toBe(CALLBACK);
      // The configured scope, not every scope the server advertises.
      expect(url.searchParams.get("scope")).toBe(google.scope);
      expect(url.searchParams.get("access_type")).toBe("offline");
      expect(url.searchParams.get("prompt")).toBe("consent");
      expect(url.searchParams.get("state")).toBe(store.state);
      expect(url.searchParams.get("code_challenge_method")).toBe("S256");
      expect(store.verifier).toBeTruthy();
      expect(requested.some((r) => r.startsWith("POST") && !r.includes("/token"))).toBe(false);

      const finished = await auth(provider, {
        serverUrl,
        authorizationCode: "code-1",
        fetchFn: fetchFn as unknown as typeof fetch,
      });
      expect(finished).toBe("AUTHORIZED");
      expect(store.tokens).toMatchObject({ access_token: "at", refresh_token: "rt" });

      const tokenCall = fetchFn.mock.calls.find(([u]) => String(u).includes("/token"))!;
      const headers = new Headers(tokenCall[1]?.headers);
      const basic = Buffer.from(`${google.clientId}:${google.clientSecret}`).toString("base64");
      expect(headers.get("authorization")).toBe(`Basic ${basic}`);
    });
  });
});

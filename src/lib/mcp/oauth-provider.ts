import { randomBytes } from "node:crypto";
import type {
  OAuthClientInformation,
  OAuthClientMetadata,
  OAuthClientProvider,
  OAuthTokens,
} from "@modelcontextprotocol/client";
import * as mcpServerRepo from "@/lib/repositories/mcpServerRepository";
import { oauthCallbackUrl, getAppUrl } from "@/lib/config/app-url";
import type { MCPServer } from "@/types/mcp";
import { clientSourceFor, type ClientSource } from "./clientSource";
import { OAuthStatus } from "./oauth-detection";
import { RESERVED_AUTHORIZATION_PARAMS } from "./oauthClient";

const RESERVED = new Set<string>(RESERVED_AUTHORIZATION_PARAMS);

/**
 * Server-side OAuth provider that implements the OAuthClientProvider interface
 * from @modelcontextprotocol/client. Stores OAuth data in the database; where the client comes
 * from (registered or pre-registered) is the {@link ClientSource}'s.
 */
export class ServerOAuthProvider implements OAuthClientProvider {
  private readonly serverId: string;
  private readonly serverName: string;
  private readonly client: ClientSource;
  /** Set when the SDK asks to send the user to the authorization server. */
  pendingAuthorizationUrl?: URL;

  constructor(server: MCPServer) {
    this.serverId = server.id;
    this.serverName = server.name;
    this.client = clientSourceFor(server, this.redirectUrl);
  }

  get redirectUrl(): string {
    return oauthCallbackUrl();
  }

  /** The configured scope, which callers pass to `auth()`: it outranks the server's metadata. */
  get requestedScope(): string | undefined {
    return this.client.scope;
  }

  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: `Cameron - ${this.serverName}`,
      client_uri: getAppUrl(),
      redirect_uris: [this.redirectUrl],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      ...(this.client.scope ? { scope: this.client.scope } : {}),
      // Only used to register: a pre-registered client's method is chosen from its secret.
      token_endpoint_auth_method: "none",
    };
  }

  clientInformation(): Promise<OAuthClientInformation | undefined> {
    return this.client.information();
  }

  saveClientInformation(info: OAuthClientInformation): Promise<void> {
    return this.client.save(info);
  }

  async tokens(): Promise<OAuthTokens | undefined> {
    const tokens = await mcpServerRepo.getTokens(this.serverId);
    return (tokens as OAuthTokens | null) ?? undefined;
  }

  async saveTokens(tokens: OAuthTokens): Promise<void> {
    await mcpServerRepo.saveTokens(this.serverId, tokens, OAuthStatus.CONNECTED);
  }

  /** Single-use and stored on the row: it is how the shared callback finds this server. */
  async state(): Promise<string> {
    const state = randomBytes(32).toString("base64url");
    await mcpServerRepo.saveOAuthState(this.serverId, state);
    return state;
  }

  async redirectToAuthorization(url: URL): Promise<void> {
    for (const [key, value] of Object.entries(this.client.authorizationParams)) {
      if (!RESERVED.has(key.toLowerCase())) url.searchParams.set(key, value);
    }
    // Server-side: nothing to redirect. The OAuth check route hands the URL to the browser.
    this.pendingAuthorizationUrl = url;
  }

  async saveCodeVerifier(verifier: string): Promise<void> {
    await mcpServerRepo.saveCodeVerifier(this.serverId, verifier);
  }

  async codeVerifier(): Promise<string> {
    const verifier = await mcpServerRepo.getCodeVerifier(this.serverId);
    if (!verifier) {
      throw new Error("No code verifier stored");
    }
    return verifier;
  }

  async invalidateCredentials(
    scope: "all" | "client" | "tokens" | "verifier" | "discovery",
  ): Promise<void> {
    // Discovery results are not cached here, so there is nothing to drop for that scope.
    if (scope === "discovery") return;
    if (scope === "all" || scope === "client") return this.client.invalidate(scope);
    await mcpServerRepo.clearOAuthCredentials(this.serverId, scope);
  }
}

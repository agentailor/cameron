import type {
  OAuthClientInformation,
  OAuthClientMetadata,
  OAuthClientProvider,
  OAuthTokens,
} from "@modelcontextprotocol/client";
import * as mcpServerRepo from "@/lib/repositories/mcpServerRepository";
import { OAuthStatus } from "./oauth-detection";
import { getAppUrl } from "@/lib/config/app-url";

/**
 * Server-side OAuth provider that implements the OAuthClientProvider interface
 * from @modelcontextprotocol/client. Stores OAuth data in the database.
 */
export class ServerOAuthProvider implements OAuthClientProvider {
  private serverId: string;
  private serverName: string;
  /** Set when the SDK asks to send the user to the authorization server. */
  pendingAuthorizationUrl?: URL;

  constructor(serverId: string, serverName: string) {
    this.serverId = serverId;
    this.serverName = serverName;
  }

  get redirectUrl(): string {
    return `${getAppUrl()}/api/oauth/callback/${this.serverId}`;
  }

  get clientMetadata(): OAuthClientMetadata {
    const appUrl = getAppUrl();
    return {
      client_name: `LangGraph Agent - ${this.serverName}`,
      client_uri: appUrl,
      redirect_uris: [this.redirectUrl],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      // No scope here: the SDK takes it from the server's challenge or resource metadata.
      token_endpoint_auth_method: "none",
    };
  }

  async clientInformation(): Promise<OAuthClientInformation | undefined> {
    const clientInfo = await mcpServerRepo.getClientInfo(this.serverId);
    return (clientInfo as OAuthClientInformation | null) ?? undefined;
  }

  async saveClientInformation(info: OAuthClientInformation): Promise<void> {
    await mcpServerRepo.saveClientInfo(this.serverId, info);
  }

  async tokens(): Promise<OAuthTokens | undefined> {
    const tokens = await mcpServerRepo.getTokens(this.serverId);
    return (tokens as OAuthTokens | null) ?? undefined;
  }

  async saveTokens(tokens: OAuthTokens): Promise<void> {
    await mcpServerRepo.saveTokens(this.serverId, tokens, OAuthStatus.CONNECTED);
  }

  async redirectToAuthorization(url: URL): Promise<void> {
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
    await mcpServerRepo.clearOAuthCredentials(this.serverId, scope);
  }
}

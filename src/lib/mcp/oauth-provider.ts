import type { OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import type {
  OAuthClientInformation,
  OAuthClientMetadata,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import * as mcpServerRepo from "@/lib/repositories/mcpServerRepository";
import { OAuthStatus } from "./oauth-detection";
import { getAppUrl } from "@/lib/config/app-url";

/**
 * Server-side OAuth provider that implements the OAuthClientProvider interface
 * from @modelcontextprotocol/sdk. Stores OAuth data in the database.
 */
export class ServerOAuthProvider implements OAuthClientProvider {
  private serverId: string;
  private serverName: string;

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
      scope: "read write",
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
    // This method is called by the SDK when it needs to redirect to the auth server.
    // In a server-side context, we can't redirect directly - we throw an error
    // and handle the URL generation separately in the API route.
    throw new Error(`REDIRECT_REQUIRED:${url.toString()}`);
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
}

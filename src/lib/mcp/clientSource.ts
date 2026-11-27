import type { OAuthClientInformation } from "@modelcontextprotocol/client";
import * as mcpServerRepo from "@/lib/repositories/mcpServerRepository";
import type { MCPServer } from "@/types/mcp";

/**
 * Where a server's OAuth client comes from — the only part of the flow that differs between the
 * two kinds. Discovery, PKCE, the token exchange and refresh are the SDK's and are shared.
 *
 * - dynamic: the SDK registers a client (DCR) and `client_info` caches it. Disposable.
 * - preregistered: the owner created it on the authorization server. Configuration, never
 *   deleted by the flow.
 */
export interface ClientSource {
  readonly kind: "dynamic" | "preregistered";
  information(): Promise<OAuthClientInformation | undefined>;
  save(info: OAuthClientInformation): Promise<void>;
  /** The SDK reported the client (or everything) invalid. */
  invalidate(scope: "all" | "client"): Promise<void>;
  /** Scope to request, overriding what the server advertises. */
  readonly scope?: string;
  readonly authorizationParams: Record<string, string>;
}

export function clientSourceFor(server: MCPServer, redirectUrl: string): ClientSource {
  return server.oauthClient
    ? preregisteredClient(server, server.oauthClient)
    : dynamicClient(server.id, redirectUrl);
}

function dynamicClient(serverId: string, redirectUrl: string): ClientSource {
  return {
    kind: "dynamic",
    async information() {
      const stored = (await mcpServerRepo.getClientInfo(serverId)) as
        | (OAuthClientInformation & { redirect_uris?: unknown })
        | null
        | undefined;
      if (!stored) return undefined;
      // Registered for another callback (the old per-server URL, or a changed app URL): the
      // authorization server would refuse it, so let the SDK register again.
      if (Array.isArray(stored.redirect_uris) && !stored.redirect_uris.includes(redirectUrl)) {
        return undefined;
      }
      return stored;
    },
    save: (info) => mcpServerRepo.saveClientInfo(serverId, info),
    invalidate: (scope) => mcpServerRepo.clearOAuthCredentials(serverId, scope),
    authorizationParams: {},
  };
}

function preregisteredClient(
  server: MCPServer,
  client: NonNullable<MCPServer["oauthClient"]>,
): ClientSource {
  return {
    kind: "preregistered",
    async information() {
      return {
        client_id: client.clientId,
        ...(client.clientSecret ? { client_secret: client.clientSecret } : {}),
      };
    },
    // The SDK re-saves the client to stamp its issuer; the owner's config is not its to rewrite.
    async save() {},
    // A wrong id or secret is the owner's to fix: drop the sign-in, keep the client.
    invalidate: () => mcpServerRepo.clearOAuthCredentials(server.id, "signin"),
    scope: client.scope,
    authorizationParams: client.authorizationParams ?? {},
  };
}

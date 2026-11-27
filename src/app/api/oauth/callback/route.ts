import { after, NextRequest, NextResponse } from "next/server";
import * as mcpServerRepo from "@/lib/repositories/mcpServerRepository";
import { ServerOAuthProvider } from "@/lib/mcp/oauth-provider";
import { refreshCatalogQuietly } from "@/lib/mcp/catalog";
import { mcpPool } from "@/lib/mcp/pool";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { OAuthStatus } from "@/lib/mcp/oauth-detection";
import { getAppUrl } from "@/lib/config/app-url";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/oauth/callback
 *
 * The one OAuth redirect URI for every MCP server. The `state` Cameron sent with the sign-in
 * identifies the server; an unknown or reused state is refused, which is also the CSRF check.
 * Exchanges the authorization code for tokens with the SDK's transport.finishAuth().
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(request.url);
  const appUrl = getAppUrl();
  const fail = (message: string) =>
    NextResponse.redirect(new URL(`/?oauth_error=${encodeURIComponent(message)}`, appUrl));

  const state = searchParams.get("state");
  const server = state ? await mcpServerRepo.getByOAuthState(state) : null;
  if (!server || !server.url) {
    return fail("This sign-in is unknown or already used. Start it again from Connections.");
  }

  const error = searchParams.get("error");
  if (error) {
    const description = searchParams.get("error_description");
    console.error("OAuth error:", error, description);
    await mcpServerRepo.abandonSignIn(server.id, OAuthStatus.REQUIRED);
    return fail(description || error);
  }

  if (!searchParams.get("code")) {
    await mcpServerRepo.abandonSignIn(server.id, OAuthStatus.REQUIRED);
    return fail("missing_code");
  }

  const authProvider = new ServerOAuthProvider(server);

  try {
    const transport = new StreamableHTTPClientTransport(new URL(server.url), {
      authProvider,
    });

    // The full params, not just the code: the SDK validates `iss` (RFC 9207) when the
    // authorization server sends it.
    await transport.finishAuth(searchParams);

    // Clears the transient code verifier and state.
    await mcpServerRepo.markConnected(server.id);
    mcpPool.invalidate(server.id);
    // Now reachable: cache its tool list for the agent's server catalog.
    after(() => refreshCatalogQuietly(server.id));

    return NextResponse.redirect(
      new URL(`/?oauth_success=true&server=${encodeURIComponent(server.name)}`, appUrl),
    );
  } catch (err) {
    console.error("OAuth callback error:", err);
    await mcpServerRepo.abandonSignIn(server.id, OAuthStatus.REQUIRED);
    return fail(err instanceof Error ? err.message : "Token exchange failed");
  }
}

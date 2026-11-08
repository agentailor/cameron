import { NextRequest, NextResponse } from "next/server";
import * as mcpServerRepo from "@/lib/repositories/mcpServerRepository";
import {
  detectOAuthRequirement,
  updateServerOAuthStatus,
  isTokenExpired,
  OAuthStatus,
} from "@/lib/mcp/oauth-detection";
import type { OAuthStatus as OAuthStatusType } from "@/lib/mcp/oauth-detection";
import { ServerOAuthProvider } from "@/lib/mcp/oauth-provider";
import { auth } from "@modelcontextprotocol/client";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface CheckOAuthResponse {
  serverId: string;
  requiresAuth: boolean;
  connected: boolean;
  oauthStatus: OAuthStatusType;
  authorizationUrl?: string;
  error?: string;
}

/**
 * GET /api/oauth/check/[serverId]
 *
 * Checks OAuth status for an MCP server. If OAuth is required and not connected,
 * generates the authorization URL for the client to redirect to.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ serverId: string }> },
): Promise<NextResponse<CheckOAuthResponse>> {
  const { serverId } = await params;

  // Fetch HTTP server from database (only HTTP servers can use OAuth)
  console.log(`[OAuth API] Fetching server with id: ${serverId} from database...`);
  const server = await mcpServerRepo.getHttpById(serverId);

  if (!server || !server.url) {
    return NextResponse.json(
      {
        serverId,
        requiresAuth: false,
        connected: false,
        oauthStatus: OAuthStatus.NOT_REQUIRED,
        error: "HTTP server not found",
      },
      { status: 404 },
    );
  }

  console.log(`[OAuth API] Server found: ${server?.name}`);

  // Check if already connected with valid tokens
  if (server.oauthStatus === OAuthStatus.CONNECTED && server.authTokens) {
    const tokens = server.authTokens as { expires_at?: number };
    if (!isTokenExpired(tokens)) {
      return NextResponse.json({
        serverId,
        requiresAuth: true,
        connected: true,
        oauthStatus: OAuthStatus.CONNECTED,
      });
    }
    await updateServerOAuthStatus(serverId, OAuthStatus.EXPIRED);
  }

  // Detect if server requires OAuth
  const serverUrl = server.url!;
  const detection = await detectOAuthRequirement(serverUrl);

  if (!detection.requiresAuth) {
    await updateServerOAuthStatus(serverId, OAuthStatus.NOT_REQUIRED);
    return NextResponse.json({
      serverId,
      requiresAuth: false,
      connected: false,
      oauthStatus: OAuthStatus.NOT_REQUIRED,
    });
  }

  await updateServerOAuthStatus(serverId, OAuthStatus.REQUIRED);

  const authProvider = new ServerOAuthProvider(serverId, server.name);

  try {
    // The SDK runs discovery, scope selection, registration and PKCE, so the authorization
    // request matches what its token exchange in the callback expects.
    const result = await auth(authProvider, {
      serverUrl,
      scope: detection.scope,
      resourceMetadataUrl: toUrl(detection.resourceMetadataUrl),
    });

    if (result === "AUTHORIZED") {
      // A stored refresh token was still good: no sign-in needed.
      await mcpServerRepo.markConnected(serverId);
      return NextResponse.json({
        serverId,
        requiresAuth: true,
        connected: true,
        oauthStatus: OAuthStatus.CONNECTED,
      });
    }

    const authorizationUrl = authProvider.pendingAuthorizationUrl;
    if (!authorizationUrl) throw new Error("The SDK did not produce an authorization URL.");
    return NextResponse.json({
      serverId,
      requiresAuth: true,
      connected: false,
      oauthStatus: OAuthStatus.REQUIRED,
      authorizationUrl: authorizationUrl.toString(),
    });
  } catch (error) {
    console.error("[OAuth API] Error:", error);
    return NextResponse.json({
      serverId,
      requiresAuth: true,
      connected: false,
      oauthStatus: OAuthStatus.REQUIRED,
      error: error instanceof Error ? error.message : "Failed to generate authorization URL",
    });
  }
}

function toUrl(value: string | undefined): URL | undefined {
  if (!value) return undefined;
  try {
    return new URL(value);
  } catch {
    return undefined;
  }
}

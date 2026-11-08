import * as mcpServerRepo from "@/lib/repositories/mcpServerRepository";
import { OAuthStatus } from "./oauth-status";

// OAuth status constants live in a dependency-free module so client components can
// import them without pulling in the database layer. Re-exported here for existing
// server-side call sites that import it from oauth-detection.
export { OAuthStatus };

const DETECTION_TIMEOUT_MS = 5_000;

export interface OAuthDetectionResult {
  requiresAuth: boolean;
  resourceMetadataUrl?: string;
  /** The `scope` the server's challenge asked for, when it named one. */
  scope?: string;
  error?: string;
}

/**
 * Detects if an MCP HTTP server requires OAuth authentication
 * by making a request and checking for 401 + WWW-Authenticate header
 */
export async function detectOAuthRequirement(url: string): Promise<OAuthDetectionResult> {
  try {
    const response = await fetch(url, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(DETECTION_TIMEOUT_MS),
    });

    if (response.status === 401) {
      const wwwAuth = response.headers.get("WWW-Authenticate");
      // Check for OAuth 2.0 Bearer token requirement
      if (wwwAuth && wwwAuth.toLowerCase().includes("bearer")) {
        return {
          requiresAuth: true,
          resourceMetadataUrl: extractResourceMetadataUrl(wwwAuth),
          scope: wwwAuth.match(/scope="([^"]+)"/)?.[1],
        };
      }
      // 401 without Bearer header - still requires auth but unknown type
      return { requiresAuth: true };
    }

    // Server responded without auth requirement
    return { requiresAuth: false };
  } catch (error) {
    return {
      requiresAuth: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Extracts the resource_metadata URL from WWW-Authenticate header
 * Example: Bearer resource_metadata="https://example.com/.well-known/oauth-protected-resource"
 */
function extractResourceMetadataUrl(wwwAuthHeader: string): string | undefined {
  const resourceMetadataMatch = wwwAuthHeader.match(/resource_metadata="([^"]+)"/);
  if (resourceMetadataMatch) {
    return resourceMetadataMatch[1];
  }

  // Fallback: try to extract realm
  const realmMatch = wwwAuthHeader.match(/realm="([^"]+)"/);
  return realmMatch?.[1];
}

/**
 * Updates server OAuth status in database
 */
export async function updateServerOAuthStatus(
  serverId: string,
  status: OAuthStatus,
): Promise<void> {
  await mcpServerRepo.setOAuthStatus(serverId, status);
}

/**
 * Checks if stored tokens are expired
 */
export function isTokenExpired(tokens: { expires_at?: number } | null | undefined): boolean {
  if (!tokens || !tokens.expires_at) {
    return true; // No expiry info, assume expired
  }
  // Add 60 second buffer before actual expiry
  return Date.now() / 1000 > tokens.expires_at - 60;
}

/**
 * Probes a just-saved HTTP server and records whether it needs OAuth, so the Connections page can
 * offer Connect at once. An unreachable server is recorded as UNKNOWN ("Check auth"), not as
 * NOT_REQUIRED. Returns the status written.
 */
export async function recordOAuthRequirement(serverId: string, url: string): Promise<OAuthStatus> {
  const detection = await detectOAuthRequirement(url);
  const status = detection.requiresAuth
    ? OAuthStatus.REQUIRED
    : detection.error
      ? OAuthStatus.UNKNOWN
      : OAuthStatus.NOT_REQUIRED;
  await mcpServerRepo.setOAuthStatus(serverId, status);
  return status;
}

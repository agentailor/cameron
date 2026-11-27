/** The port `pnpm dev` serves on (package.json). */
const DEV_PORT = 3100;

/**
 * Gets the application base URL from environment variable.
 *
 * In development, falls back to localhost on the dev port.
 * In production, requires NEXT_PUBLIC_APP_URL to be set.
 *
 * @throws Error if NEXT_PUBLIC_APP_URL is not set in production
 */
export function getAppUrl(): string {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;

  if (appUrl) {
    // Remove trailing slash for consistency
    return appUrl.replace(/\/$/, "");
  }

  // Development fallback
  if (process.env.NODE_ENV === "development") {
    return `http://localhost:${process.env.PORT || DEV_PORT}`;
  }

  // Production requires explicit configuration
  throw new Error(
    "NEXT_PUBLIC_APP_URL environment variable is required in production. " +
      "Set it to your application's public URL (e.g., https://myapp.com)",
  );
}

/**
 * The one OAuth redirect URI for every MCP server; the sign-in's `state` says which server it is.
 * Owners paste it into their OAuth client, so it must not depend on anything but the app URL.
 */
export function oauthCallbackUrl(): string {
  return `${getAppUrl()}/api/oauth/callback`;
}

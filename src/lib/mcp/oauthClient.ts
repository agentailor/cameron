/**
 * A pre-registered OAuth client: one the owner created on the authorization server (e.g. a Google
 * Cloud OAuth client) and typed into Cameron, for servers that don't support dynamic client
 * registration. Zero imports, so the form, the routes and the provider all share it.
 * See docs/OAUTH.md.
 */

export interface PreregisteredClient {
  clientId: string;
  /** Absent for a public client. Never leaves the server. */
  clientSecret?: string;
  /** Space-separated, sent as-is. Absent leaves the choice to the server's challenge. */
  scope?: string;
  /** Extra query parameters for the authorization URL, e.g. `access_type=offline`. */
  authorizationParams?: Record<string, string>;
}

/** What the browser sees: the secret is reduced to whether one is stored. */
export interface PublicOAuthClient {
  clientId: string;
  hasSecret: boolean;
  scope: string | null;
  authorizationParams: Record<string, string>;
}

/**
 * A write. `clientSecret`: a string sets it, `null` removes it, absent keeps the stored one, so an
 * edit never needs the secret round-tripped through the browser.
 */
export interface OAuthClientPatch {
  clientId: string;
  clientSecret?: string | null;
  scope?: string | null;
  authorizationParams?: Record<string, string>;
}

/** Set by the SDK or by Cameron; overriding any of them would break PKCE, state or the flow. */
export const RESERVED_AUTHORIZATION_PARAMS = [
  "client_id",
  "redirect_uri",
  "response_type",
  "code_challenge",
  "code_challenge_method",
  "state",
  "scope",
  "resource",
] as const;

const RESERVED = new Set<string>(RESERVED_AUTHORIZATION_PARAMS);

/** Normalizes a scope written as a string or a list into one space-separated string. */
export function normalizeScope(value: string | string[] | null | undefined): string | undefined {
  const parts = (Array.isArray(value) ? value : (value ?? "").split(/[\s,]+/))
    .map((s) => s.trim())
    .filter(Boolean);
  return parts.length ? [...new Set(parts)].join(" ") : undefined;
}

/** An error message for the first unusable parameter name, or null. */
export function authorizationParamsError(params: Record<string, string>): string | null {
  for (const key of Object.keys(params)) {
    if (!key.trim()) return "Every authorization parameter needs a name.";
    if (RESERVED.has(key.trim().toLowerCase()))
      return `"${key}" is set by Cameron and can't be overridden.`;
  }
  return null;
}

/** Applies a write to the stored client. */
export function mergeOAuthClient(
  existing: PreregisteredClient | null,
  patch: OAuthClientPatch,
): PreregisteredClient {
  const clientSecret =
    patch.clientSecret === undefined ? existing?.clientSecret : patch.clientSecret || undefined;
  const scope = normalizeScope(patch.scope);
  const params = patch.authorizationParams ?? {};
  return {
    clientId: patch.clientId.trim(),
    ...(clientSecret ? { clientSecret } : {}),
    ...(scope ? { scope } : {}),
    ...(Object.keys(params).length ? { authorizationParams: params } : {}),
  };
}

/**
 * Whether existing tokens still match the configured sign-in. A new client id, scope or
 * authorization parameter needs a new consent (a refresh never widens scope, and Google only
 * issues a refresh token on an offline consent); a new secret alone does not.
 */
export function sameSignIn(
  a: PreregisteredClient | null | undefined,
  b: PreregisteredClient | null | undefined,
): boolean {
  if (!a || !b) return !a && !b;
  const params = (c: PreregisteredClient) =>
    JSON.stringify(
      Object.entries(c.authorizationParams ?? {}).sort(([x], [y]) => x.localeCompare(y)),
    );
  return (
    a.clientId === b.clientId && (a.scope ?? "") === (b.scope ?? "") && params(a) === params(b)
  );
}

export function toPublicOAuthClient(client: PreregisteredClient | null): PublicOAuthClient | null {
  if (!client) return null;
  return {
    clientId: client.clientId,
    hasSecret: !!client.clientSecret,
    scope: client.scope ?? null,
    authorizationParams: { ...(client.authorizationParams ?? {}) },
  };
}

/** Narrows a decrypted column value; anything malformed reads as no client. */
export function readPreregisteredClient(value: unknown): PreregisteredClient | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.clientId !== "string" || !raw.clientId) return null;
  const params =
    typeof raw.authorizationParams === "object" && raw.authorizationParams !== null
      ? Object.fromEntries(
          Object.entries(raw.authorizationParams).filter(
            (entry): entry is [string, string] => typeof entry[1] === "string",
          ),
        )
      : {};
  return {
    clientId: raw.clientId,
    ...(typeof raw.clientSecret === "string" && raw.clientSecret
      ? { clientSecret: raw.clientSecret }
      : {}),
    ...(typeof raw.scope === "string" && raw.scope ? { scope: raw.scope } : {}),
    ...(Object.keys(params).length ? { authorizationParams: params } : {}),
  };
}

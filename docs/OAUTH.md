# OAuth Support for MCP HTTP Servers

Some MCP HTTP servers require OAuth 2.0/2.1 authentication. This document explains how OAuth is
implemented in Cameron.

## Overview

1. When an HTTP server is **saved** (added, or its URL or OAuth client changed), the app records
   its sign-in need before responding: `REQUIRED` straight away for a server with a
   [pre-registered client](#pre-registered-clients), otherwise from a probe — `REQUIRED`,
   `NOT_REQUIRED`, or `UNKNOWN` if it could not be reached. This is what makes the Connect button
   appear: it renders for `REQUIRED`, `EXPIRED` and `UNKNOWN` only.
2. The user clicks "Connect" ("Check auth" for `UNKNOWN`)
3. If required, the user is redirected to the authorization server
4. Upon successful authorization, tokens are stored and the server becomes usable

A connection that later fails with a 401 (an `UnauthorizedError` or HTTP 401 anywhere in the
error's cause chain, `src/lib/mcp/authFailure.ts`) records `REQUIRED` — or `EXPIRED` for a server
that was `CONNECTED` — and reports `auth_required`, so the page offers Connect again.

## Two kinds of client, one flow

Where the OAuth client comes from is the only part that differs; it is a `ClientSource`
(`src/lib/mcp/clientSource.ts`) chosen when the provider is built:

|                            | Dynamic (default)                                       | Pre-registered                                         |
| -------------------------- | ------------------------------------------------------- | ------------------------------------------------------ |
| Client comes from          | The SDK registers it (DCR) on first sign-in             | The owner creates it on the authorization server       |
| Stored in                  | `client_info` — a disposable cache                      | `oauth_client` — configuration                         |
| SDK says the client is bad | Drop it; the SDK registers again                        | Keep it; drop only the sign-in (`signin` scope)        |
| Needs sign-in?             | Probed (401 detection)                                  | Declared: configured means `REQUIRED`                  |
| Scope, extra URL params    | The server's challenge / metadata                       | The owner's (`scope`, `authorizationParams`)           |
| Registered for an old URL  | Treated as absent, so the SDK registers for the new one | n/a — the owner updates the redirect URI on their side |

Everything else — discovery, PKCE, the authorization URL, the callback, the token exchange,
refresh, token storage, statuses — is the SDK's `auth()` / `finishAuth()` and the same
`ServerOAuthProvider` for both. A row with `oauth_client` set is pre-registered; there is no
separate mode flag.

## OAuth Flow

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────────┐
│  /connections   │────►│  /api/oauth/     │────►│  Authorization      │
│  "Connect" btn  │     │  check/[serverId]│     │  Server             │
└─────────────────┘     └──────────────────┘     └─────────────────────┘
                               │                          │
                               │ 1. Detect OAuth          │ 2. User authorizes
                               │ 2. Client (register or   │
                               │    pre-registered)       │
                               │ 3. Auth URL + state      │
                               ▼                          ▼
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────────┐
│  OAuthToast     │◄────│  /api/oauth/     │◄────│  Redirect with      │
│  Success/Error  │     │  callback        │     │  code + state       │
└─────────────────┘     └──────────────────┘     └─────────────────────┘
                               │
                               │ Find server by state
                               │ Exchange code for tokens
                               ▼
                        ┌──────────────────┐
                        │  Server status:  │
                        │  CONNECTED       │
                        └──────────────────┘
```

## OAuth Statuses

| Status         | Description                              | UI Indicator |
| -------------- | ---------------------------------------- | ------------ |
| `UNKNOWN`      | Probe on save could not reach the server | "Check auth" |
| `NOT_REQUIRED` | Server does not require OAuth            | None         |
| `REQUIRED`     | OAuth required, user needs to connect    | Yellow badge |
| `CONNECTED`    | Successfully authenticated               | Green badge  |
| `EXPIRED`      | Tokens have expired, reconnection needed | Red badge    |

## Key Components

| File                                               | Purpose                                               |
| -------------------------------------------------- | ----------------------------------------------------- |
| `src/lib/mcp/oauth-detection.ts`                   | Detects OAuth requirements via 401 response           |
| `src/lib/mcp/oauth-provider.ts`                    | Implements `OAuthClientProvider` (SDK v2)             |
| `src/lib/mcp/clientSource.ts`                      | Dynamic vs pre-registered client                      |
| `src/lib/mcp/oauthClient.ts`                       | Pre-registered client types, validation (zero-import) |
| `src/lib/mcp/publicServer.ts`                      | The server shape the API returns — no credentials     |
| `src/app/api/oauth/check/[serverId]/route.ts`      | Initiates OAuth flow, returns auth URL                |
| `src/app/api/oauth/callback/route.ts`              | The one callback: finds the server by `state`         |
| `src/components/connections/OAuthClientFields.tsx` | The "OAuth client" section of the server form         |
| `src/components/OAuthStatusBadge.tsx`              | Displays OAuth status in server list                  |
| `src/components/OAuthToast.tsx`                    | Shows success/error notifications                     |

## Database Fields

Columns on `mcp_server` (`src/lib/database/schema.ts`):

| Column          | Holds                                                                                         |
| --------------- | --------------------------------------------------------------------------------------------- |
| `requires_auth` | Set true once OAuth completes                                                                 |
| `auth_tokens`   | `{ access_token, refresh_token, expires_at, issuer, … }` (sealed)                             |
| `client_info`   | The dynamically registered client (`client_id`, …) (sealed)                                   |
| `oauth_client`  | A pre-registered client: `{ clientId, clientSecret?, scope?, authorizationParams? }` (sealed) |
| `code_verifier` | PKCE verifier for the flow in progress                                                        |
| `oauth_state`   | The `state` of the sign-in in progress; unique, single-use                                    |
| `oauth_status`  | One of the statuses above; NULL until first probed                                            |

## How It Works

### 1. OAuth Detection

A server with a pre-registered client skips detection: it is `REQUIRED` until connected. A probe
can't be relied on for every server — some answer `initialize` and `tools/list` without
credentials and return 401 only on `tools/call`, so a probe records `NOT_REQUIRED` and Connect
never shows.

Otherwise, on save and again when the user clicks "Connect", the app sends a GET to the MCP
server (5s timeout). If the server responds with:

- **401 Unauthorized** → OAuth is required; the `WWW-Authenticate` header's `resource_metadata`
  and `scope` are kept for the next step. `realm` is not used as a fallback: it can name the
  authorization server, not the resource metadata.
- **any other status** → OAuth is not required
- **no response** → `UNKNOWN`

### 2. Registration and authorization (the SDK's `auth()`)

The check route calls `auth()` from `@modelcontextprotocol/client` rather than running the steps
itself, so the authorization request is built exactly the way the callback's token exchange
expects. It:

1. Discovers the protected resource and authorization server metadata
2. Picks the **scope**: the scope passed to `auth()`, else the resource's `scopes_supported`, else
   the client metadata's, plus `offline_access` when the server offers it. A pre-registered
   client's scope is therefore passed to `auth()`, not only set in the client metadata — the
   SDK prefers the server's `scopes_supported` to the metadata, which can be every scope the
   server offers. A dynamic client's metadata carries no scope: a hardcoded `read write` made Keycloak's
   client-scope policy refuse registration (HTTP 403).
3. Gets the client from the `ClientSource`; for a dynamic one with none stored, registers and
   stores `clientInfo`
4. Uses a stored refresh token if one still works (the route then reports `CONNECTED`)
5. Otherwise builds the authorization URL with PKCE, the RFC 8707 `resource` parameter and a
   fresh `state` (`provider.state()`, stored in `oauth_state`). The provider's
   `redirectToAuthorization` adds a pre-registered client's `authorizationParams` and records the
   URL; the route returns it and the browser goes there. Parameters the SDK or Cameron set
   (`client_id`, `redirect_uri`, `response_type`, `code_challenge*`, `state`, `scope`, `resource`)
   are refused when saving and skipped here.

### 3. Token Exchange

1. The authorization server redirects to `/api/oauth/callback?code=…&state=…`
2. The route finds the server whose `oauth_state` matches; an unknown or reused state is refused.
   This is the CSRF check: only a sign-in Cameron started can complete.
3. Exchange the code for tokens with `transport.finishAuth(searchParams)` — all the callback
   params, not just `code`, because the SDK checks the `iss` parameter (RFC 9207) when the
   authorization server sends one. A pre-registered client with a secret authenticates with
   `client_secret_basic` (or `_post`, whichever the server lists).
4. Store tokens, clear `code_verifier` and `oauth_state`, set `CONNECTED`. A failure clears both
   too and sets `REQUIRED`.

### 4. Invalidation

When the SDK finds stored credentials rejected it calls `invalidateCredentials(scope)`. Tokens
and verifier scopes clear their columns (`clearOAuthCredentials`). `client` and `all` go to the
`ClientSource`: a dynamic one drops its registration (`REQUIRED`); a pre-registered one keeps the
owner's client and drops only the sign-in. `discovery` is a no-op — nothing is cached.

Editing a server's client — a different client id, scope or authorization parameter, or adding
or removing the client — clears the tokens and sets `REQUIRED` (`sameSignIn` in
`oauthClient.ts`): tokens belong to the consent that issued them, a refresh never widens scope,
and an authorization parameter can decide whether a refresh token is issued at all. Kept, they would stay `CONNECTED`
under the old consent and Connect would never show. A new secret alone keeps them.

All OAuth helpers and types come from `@modelcontextprotocol/client` (MCP SDK v2).

## The callback URL

Every server uses the same redirect URI: `{NEXT_PUBLIC_APP_URL}/api/oauth/callback`. It is shown,
with a copy button, at the top of `/connections` and in the form's "OAuth client" section, as the
server will send it — so it can be pasted into an OAuth client before the server exists in
Cameron.

```env
NEXT_PUBLIC_APP_URL=http://localhost:3100
```

Without it, development falls back to `http://localhost:${PORT || 3100}`; production refuses to
guess. Changing it changes the redirect URI: update it on any pre-registered client. Dynamic
clients registered for an earlier URL (including the old per-server
`/api/oauth/callback/{serverId}`) re-register on the next Connect; their tokens keep working,
since a refresh sends no redirect URI.

## Pre-registered clients

For servers whose authorization server has no registration endpoint. In the server form, open
**OAuth client** (remote servers only) and enter the client ID, the secret (empty for a public
client), the scopes and any extra authorization parameters. Empty keeps dynamic registration.

The JSON tab takes the same fields:

```json
{
  "mcpServers": {
    "example": {
      "type": "http",
      "url": "https://mcp.example.com/mcp",
      "oauth": {
        "clientId": "your-client-id",
        "clientSecret": "your-client-secret",
        "scope": ["scope-a", "scope-b"],
        "authorizationParams": { "param": "value" }
      }
    }
  }
}
```

`scope` is a space-separated string or a list. The secret is **write-only**: it is sealed in
`oauth_client`, the API returns only `hasSecret`, the JSON tab never shows a stored one, and an
edit that leaves the field empty keeps it (`clientSecret: null` in the API removes it).

Setting one up:

1. Create an OAuth client on the authorization server, following the MCP server's own docs.
2. Add Cameron's callback URL (copy it from `/connections`) as an allowed redirect URI.
3. Add the server in Cameron with the client ID, the secret and the scopes you want. Empty scope
   lets the server choose, which can mean every scope it offers.
4. Add any authorization parameters the server's docs require — some issue a refresh token only
   when asked for one in the sign-in URL.
5. Save, then Connect.

## Production Considerations

> **Important**: Cameron runs for one owner. For multi-user deployments, implement the following
> security enhancements.

### Token Storage Security

Credentials are **encrypted at rest**. `auth_tokens`, `client_info`, `oauth_client`, `env` and
`headers` on `mcp_server` are sealed with AES-256-GCM (`src/lib/crypto/secretBox.ts`) under a key
from `CAMERON_SECRET_KEY` (32 random bytes, base64 — `openssl rand -base64 32`). A `pg_dump`, a
backup in `backups/` or an exposed Postgres port yields only ciphertext.

- **Envelope**: each value is stored as `{ "enc": "aes-256-gcm", "v": 1, "iv", "tag", "data" }`
  (base64), with a random 12-byte IV per write. `v` leaves room for key rotation later.
- **Bound to its place**: the row id and column name are authenticated data, so an envelope copied
  to another server or column fails to open instead of being used there.
- **One seam**: encryption happens only in `mcpServerRepository`; every caller still gets plain
  `MCPServer` objects.
- **No key, no secrets — never plaintext**: the key is read on first use, not at startup, so an
  install with no credentials runs without one (empty values — `null`, `{}` — are stored as is). Writing a credential without a key throws
  (`SecretKeyError`), and so does reading an envelope. A wrong key or an altered value throws
  `SecretDecryptError`. Nothing ever falls back to writing plaintext.
- **Servers created before encryption**: recreate them. There is no migration script; until a
  server is recreated its old plaintext values are still read as is (and a value is sealed the
  next time it is written), so nothing breaks in the meantime.
- **Keep the key apart from the data**: it lives in env, never in the database or its dumps.
  Losing it means re-entering those credentials (re-authorizing OAuth servers); there is no
  recovery.
- **Not covered**: `code_verifier` and `oauth_state` (short-lived, cleared when a sign-in ends)
  and `oauth_status`. The key protects data at rest, not a compromised running app — the process
  holds it in memory. A secrets manager (Vault, AWS Secrets Manager) is still an option if you
  need one.

### What the browser receives

`GET`, `POST` and `PATCH /api/mcp-servers` return `toPublicServer(server)`
(`src/lib/mcp/publicServer.ts`), built field by field: tokens, the dynamic registration, the
verifier, the state and the client secret are never sent. A column added to `MCPServer` stays
server-side until it is listed there. `env` and `headers` are sent, because the form edits them.

### Additional Security Measures

| Concern            | Recommendation                                         |
| ------------------ | ------------------------------------------------------ |
| Audit logging      | Log OAuth events (connections, refreshes, failures)    |
| Rate limiting      | Add rate limits to OAuth endpoints to prevent abuse    |
| Transport security | Ensure all OAuth callbacks use HTTPS in production     |
| Abandoned sign-ins | `oauth_state` has no expiry; a new Connect replaces it |

### Multi-tenant Considerations

The current implementation stores tokens per-server. For multi-user applications:

- **Per-user tokens**: Associate OAuth tokens with specific user accounts
- **Token isolation**: Ensure users cannot access other users' OAuth tokens
- **Consent management**: Allow users to revoke OAuth connections
- **Session-bound state**: tie `state` to the user's session, not only to the server

## Troubleshooting

### "Could not find authorization server"

The MCP server's OAuth metadata doesn't include authorization server information. Check that the
server properly implements OAuth 2.0 Protected Resource Metadata.

### "Incompatible auth server: does not support dynamic client registration"

The authorization server has no registration endpoint. Create a client on its side and enter it
under the server's **OAuth client** ([Pre-registered clients](#pre-registered-clients)).

### `redirect_uri_mismatch`

The redirect URI on the OAuth client doesn't match Cameron's callback URL exactly (scheme, host,
port, path). Copy it from `/connections`.

### "This sign-in is unknown or already used"

The callback's `state` matched no sign-in in progress: the link was opened twice, or another
Connect started since. Click Connect again.

### Signed out when the access token expires

No refresh token was issued. Check the authorization server's docs for the parameter that
requests one, add it under **Authorization parameters**, and Connect again.

### Tokens expire immediately

Check that server clocks are synchronized. The `expires_at` field uses Unix timestamps.

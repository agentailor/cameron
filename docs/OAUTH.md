# OAuth Support for MCP HTTP Servers

Some MCP HTTP servers require OAuth 2.0/2.1 authentication. This document explains how OAuth is implemented in this template.

## Overview

1. When an HTTP server is **saved** (added, or its URL changed), the app probes it before
   responding and records `REQUIRED`, `NOT_REQUIRED`, or `UNKNOWN` if it could not be reached.
   This is what makes the Connect button appear: it renders for `REQUIRED`, `EXPIRED` and
   `UNKNOWN` only, so a server left with no status never offered sign-in.
2. The user clicks "Connect" ("Check auth" for `UNKNOWN`)
3. If required, the user is redirected to the authorization server
4. Upon successful authorization, tokens are stored and the server becomes usable

A connection that later fails with a 401 (an `UnauthorizedError` or HTTP 401 anywhere in the
error's cause chain, `src/lib/mcp/authFailure.ts`) records `REQUIRED` — or `EXPIRED` for a server
that was `CONNECTED` — and reports `auth_required`, so the page offers Connect again.

## OAuth Flow

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────────┐
│  /connections   │────►│  /api/oauth/     │────►│  Authorization      │
│  "Connect" btn  │     │  check/[serverId]│     │  Server             │
└─────────────────┘     └──────────────────┘     └─────────────────────┘
                               │                          │
                               │ 1. Detect OAuth          │ 2. User authorizes
                               │ 2. Register client       │
                               │ 3. Generate auth URL     │
                               ▼                          ▼
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────────┐
│  OAuthToast     │◄────│  /api/oauth/     │◄────│  Redirect with      │
│  Success/Error  │     │  callback/[id]   │     │  authorization code │
└─────────────────┘     └──────────────────┘     └─────────────────────┘
                               │
                               │ Exchange code for tokens
                               │ Store tokens in database
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

| File                                             | Purpose                                     |
| ------------------------------------------------ | ------------------------------------------- |
| `src/lib/mcp/oauth-detection.ts`                 | Detects OAuth requirements via 401 response |
| `src/lib/mcp/oauth-provider.ts`                  | Implements `OAuthClientProvider` (SDK v2)   |
| `src/app/api/oauth/check/[serverId]/route.ts`    | Initiates OAuth flow, returns auth URL      |
| `src/app/api/oauth/callback/[serverId]/route.ts` | Handles OAuth callback, exchanges tokens    |
| `src/components/OAuthStatusBadge.tsx`            | Displays OAuth status in server list        |
| `src/components/OAuthToast.tsx`                  | Shows success/error notifications           |

## Database Fields

The `MCPServer` model includes these OAuth-related fields:

Columns on `mcp_server` (`src/lib/database/schema.ts`):

| Column          | Holds                                                    |
| --------------- | -------------------------------------------------------- |
| `requires_auth` | Set true once OAuth completes                            |
| `auth_tokens`   | `{ access_token, refresh_token, expires_at, issuer, … }` |
| `client_info`   | The dynamically registered client (`client_id`, …)       |
| `code_verifier` | PKCE verifier for the flow in progress                   |
| `oauth_status`  | One of the statuses above; NULL until first probed       |

## How It Works

### 1. OAuth Detection

On save, and again when the user clicks "Connect", the app sends a GET to the MCP server
(5s timeout). If the server responds with:

- **401 Unauthorized** → OAuth is required; the `WWW-Authenticate` header's `resource_metadata`
  and `scope` are kept for the next step
- **any other status** → OAuth is not required
- **no response** → `UNKNOWN`

### 2. Registration and authorization (the SDK's `auth()`)

The check route calls `auth()` from `@modelcontextprotocol/client` rather than running the steps
itself, so the authorization request is built exactly the way the callback's token exchange
expects. It:

1. Discovers the protected resource and authorization server metadata
2. Picks the **scope**: the challenge's `scope`, else the resource's `scopes_supported`, plus
   `offline_access` when the server offers it. The client metadata carries no scope of its own —
   a hardcoded `read write` made Keycloak's client-scope policy refuse registration (HTTP 403).
3. Dynamically registers a client if none is stored, and stores `clientInfo`
4. Uses a stored refresh token if one still works (the route then reports `CONNECTED`)
5. Otherwise builds the authorization URL with PKCE and the RFC 8707 `resource` parameter. The
   provider's `redirectToAuthorization` only records that URL; the route returns it and the
   browser goes there.

### 4. Token Exchange

1. Authorization server redirects to `/api/oauth/callback/[serverId]`
2. Exchange the code for tokens with `transport.finishAuth(searchParams)` — all the callback
   params, not just `code`, because the SDK checks the `iss` parameter (RFC 9207) when the
   authorization server sends one
3. Store tokens in database
4. Update status to `CONNECTED`

### 5. Invalidation

When the SDK finds stored credentials rejected it calls `invalidateCredentials(scope)`. The
provider clears the matching columns (`clearOAuthCredentials` in the repository): dropping tokens
sets `EXPIRED`, dropping the client registration sets `REQUIRED`, so the agent stops connecting
and the Connections page asks for sign-in again. `discovery` is a no-op — nothing is cached.

All OAuth helpers and types come from `@modelcontextprotocol/client` (MCP SDK v2).

## Environment Variables

```env
# Required for OAuth callback URLs
NEXT_PUBLIC_APP_URL=http://localhost:3100
```

The `NEXT_PUBLIC_APP_URL` is used to construct the OAuth redirect URI: `{NEXT_PUBLIC_APP_URL}/api/oauth/callback/{serverId}`

## Production Considerations

> **Important**: This implementation is a starter template. For production deployments, implement the following security enhancements.

### Token Storage Security

Credentials are **encrypted at rest**. `auth_tokens`, `client_info`, `env` and `headers` on
`mcp_server` are sealed with AES-256-GCM (`src/lib/crypto/secretBox.ts`) under a key from
`CAMERON_SECRET_KEY` (32 random bytes, base64 — `openssl rand -base64 32`). A `pg_dump`, a backup
in `backups/` or an exposed Postgres port yields only ciphertext.

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
- **Not covered**: `code_verifier` (PKCE, short-lived, cleared once the server connects) and
  `oauth_status`. The key protects data at rest, not a compromised running app — the process holds
  it in memory. A secrets manager (Vault, AWS Secrets Manager) is still an option if you need one.

### Additional Security Measures

| Concern            | Recommendation                                      |
| ------------------ | --------------------------------------------------- |
| Token refresh      | Implement automatic token refresh before expiration |
| CSRF protection    | Tie OAuth state parameter to user sessions          |
| Audit logging      | Log OAuth events (connections, refreshes, failures) |
| Rate limiting      | Add rate limits to OAuth endpoints to prevent abuse |
| Transport security | Ensure all OAuth callbacks use HTTPS in production  |

### Multi-tenant Considerations

The current implementation stores tokens per-server. For multi-user applications:

- **Per-user tokens**: Associate OAuth tokens with specific user accounts
- **Token isolation**: Ensure users cannot access other users' OAuth tokens
- **Consent management**: Allow users to revoke OAuth connections

## Troubleshooting

### "Could not find authorization server"

The MCP server's OAuth metadata doesn't include authorization server information. Check that the server properly implements OAuth 2.0 Protected Resource Metadata.

### "Server does not support dynamic client registration"

The OAuth server doesn't have a registration endpoint. You'll need to manually register a client and configure `clientInfo` in the database.

### Tokens expire immediately

Check that server clocks are synchronized. The `expires_at` field uses Unix timestamps.

import { z } from "@/lib/api/openapi/zod";
import { registry } from "@/lib/api/openapi/registry";

registry.registerPath({
  method: "get",
  path: "/api/oauth/callback",
  operationId: "oauthCallback",
  summary: "OAuth callback",
  description:
    "The single OAuth redirect URI for every MCP server; `state` identifies the server and is " +
    "single-use. Exchanges the authorization code for tokens, then redirects to the app root " +
    "with `?oauth_success=true&server=<name>` on success or `?oauth_error=<message>` on failure.",
  tags: ["OAuth"],
  request: {
    query: z.object({
      state: z.string().optional().openapi({ description: "The state Cameron sent" }),
      code: z.string().optional().openapi({ description: "Authorization code from the provider" }),
      error: z.string().optional().openapi({ description: "OAuth error code" }),
      error_description: z.string().optional().openapi({ description: "OAuth error detail" }),
    }),
  },
  responses: {
    302: {
      description: "Redirect to the app root with success or error query params",
      headers: {
        Location: {
          description: "Redirect target URL",
          schema: { type: "string" },
        },
      },
    },
  },
});

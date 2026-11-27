import { describe, expect, it } from "vitest";
import {
  authorizationParamsError,
  mergeOAuthClient,
  normalizeScope,
  readPreregisteredClient,
  sameSignIn,
  toPublicOAuthClient,
} from "./oauthClient";

describe("normalizeScope", () => {
  it("joins a list, splits on spaces and commas, and dedupes", () => {
    expect(normalizeScope(["a", "b"])).toBe("a b");
    expect(normalizeScope(" a,b  a ")).toBe("a b");
    expect(normalizeScope("  ")).toBeUndefined();
    expect(normalizeScope(null)).toBeUndefined();
  });
});

describe("authorizationParamsError", () => {
  it("refuses parameters the SDK or Cameron set, in any case", () => {
    expect(authorizationParamsError({ access_type: "offline", prompt: "consent" })).toBeNull();
    expect(authorizationParamsError({ State: "x" })).toContain("State");
    expect(authorizationParamsError({ code_challenge: "x" })).not.toBeNull();
  });
});

describe("mergeOAuthClient", () => {
  const stored = { clientId: "a", clientSecret: "old", scope: "s" };

  it("keeps the stored secret when the write omits it", () => {
    expect(mergeOAuthClient(stored, { clientId: "a" }).clientSecret).toBe("old");
  });

  it("replaces it with a new one, and removes it on null", () => {
    expect(mergeOAuthClient(stored, { clientId: "a", clientSecret: "new" }).clientSecret).toBe(
      "new",
    );
    expect(mergeOAuthClient(stored, { clientId: "a", clientSecret: null })).not.toHaveProperty(
      "clientSecret",
    );
  });

  it("takes scope and params from the write, not the stored client", () => {
    expect(mergeOAuthClient(stored, { clientId: "a" })).toEqual({
      clientId: "a",
      clientSecret: "old",
    });
  });
});

describe("sameSignIn", () => {
  const signedIn = {
    clientId: "a",
    clientSecret: "s",
    scope: "read",
    authorizationParams: { access_type: "offline", prompt: "consent" },
  };

  it("keeps the sign-in for a new secret or reordered parameters", () => {
    expect(sameSignIn(signedIn, { ...signedIn, clientSecret: "rotated" })).toBe(true);
    const reordered = { prompt: "consent", access_type: "offline" };
    expect(sameSignIn(signedIn, { ...signedIn, authorizationParams: reordered })).toBe(true);
    expect(sameSignIn(null, undefined)).toBe(true);
  });

  it("needs a new sign-in for another client, scope or parameter", () => {
    expect(sameSignIn(signedIn, { ...signedIn, clientId: "b" })).toBe(false);
    expect(sameSignIn(signedIn, { ...signedIn, scope: "read write" })).toBe(false);
    expect(sameSignIn({ clientId: "a" }, { clientId: "a", authorizationParams: { x: "1" } })).toBe(
      false,
    );
    expect(sameSignIn(null, signedIn)).toBe(false);
  });
});

describe("toPublicOAuthClient", () => {
  it("reduces the secret to whether one is stored", () => {
    const view = toPublicOAuthClient({ clientId: "a", clientSecret: "shh" });
    expect(view).toEqual({ clientId: "a", hasSecret: true, scope: null, authorizationParams: {} });
    expect(JSON.stringify(view)).not.toContain("shh");
  });
});

describe("readPreregisteredClient", () => {
  it("reads a stored client and treats anything malformed as none", () => {
    expect(
      readPreregisteredClient({ clientId: "a", authorizationParams: { x: "1", y: 2 } }),
    ).toEqual({ clientId: "a", authorizationParams: { x: "1" } });
    expect(readPreregisteredClient(null)).toBeNull();
    expect(readPreregisteredClient({ clientSecret: "s" })).toBeNull();
  });
});

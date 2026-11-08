import { describe, expect, it } from "vitest";
import { UnauthorizedError } from "@modelcontextprotocol/client";
import { isAuthFailure } from "./authFailure";

const wrap = (cause: unknown, message = "Authentication failed for HTTP server") =>
  new Error(message, { cause });

describe("isAuthFailure", () => {
  it("finds the SDK's UnauthorizedError under the adapter's wrapper", () => {
    expect(isAuthFailure(wrap(new UnauthorizedError("no token")))).toBe(true);
  });

  it("finds an HTTP 401 by status or by the SDK's message", () => {
    expect(isAuthFailure(wrap(Object.assign(new Error("x"), { status: 401 })))).toBe(true);
    expect(
      isAuthFailure(
        wrap(new Error("Version negotiation failed: requires authorization (HTTP 401)")),
      ),
    ).toBe(true);
  });

  it("is false for other failures, including other HTTP statuses", () => {
    expect(isAuthFailure(new Error("ECONNREFUSED"))).toBe(false);
    expect(isAuthFailure(wrap(Object.assign(new Error("x"), { status: 403 })))).toBe(false);
    expect(isAuthFailure("not an error")).toBe(false);
  });
});

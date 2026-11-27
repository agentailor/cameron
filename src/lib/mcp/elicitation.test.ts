import { describe, expect, it } from "vitest";
import { answerProblem, fieldKind, type FormRequest, type UrlRequest } from "./elicitation";

// The shape a hosted mail server sends before it shares message content.
const permission: FormRequest = {
  mode: "form",
  message: "Allow reading **3 items**?",
  requestedSchema: {
    type: "object",
    properties: {
      approval_choice: {
        type: "string",
        title: "Allow this tool?",
        enum: ["ALLOW_ONCE", "ALLOW_TOOL_ALWAYS", "DENY_ONCE"],
        enumNames: ["Allow once", "Always allow this tool", "Don't allow"],
      },
    },
    required: ["approval_choice"],
  },
};

const link: UrlRequest = { mode: "url", message: "Sign in", url: "https://example.test/x" };

describe("fieldKind", () => {
  it("labels enum choices with enumNames", () => {
    expect(fieldKind(permission.requestedSchema.properties!.approval_choice)).toEqual({
      kind: "choice",
      choices: [
        { value: "ALLOW_ONCE", label: "Allow once" },
        { value: "ALLOW_TOOL_ALWAYS", label: "Always allow this tool" },
        { value: "DENY_ONCE", label: "Don't allow" },
      ],
    });
  });

  it("reads oneOf titles, booleans, numbers, multi-select and text", () => {
    expect(fieldKind({ type: "string", oneOf: [{ const: "a", title: "A" }] })).toEqual({
      kind: "choice",
      choices: [{ value: "a", label: "A" }],
    });
    expect(fieldKind({ type: "boolean" })).toEqual({ kind: "boolean" });
    expect(fieldKind({ type: "integer" })).toEqual({ kind: "number", integer: true });
    expect(fieldKind({ type: "array", items: { enum: ["x"] } })).toEqual({
      kind: "multi",
      choices: [{ value: "x", label: "x" }],
    });
    expect(fieldKind({ type: "string" })).toEqual({ kind: "text" });
  });
});

describe("answerProblem", () => {
  it("accepts an offered choice", () => {
    const answer = { action: "accept" as const, content: { approval_choice: "ALLOW_ONCE" } };
    expect(answerProblem(permission, answer)).toBeNull();
  });

  it("accepts decline and cancel with no content", () => {
    expect(answerProblem(permission, { action: "decline" })).toBeNull();
    expect(answerProblem(permission, { action: "cancel" })).toBeNull();
  });

  it("refuses content on a decline", () => {
    expect(
      answerProblem(permission, { action: "decline", content: { approval_choice: "x" } }),
    ).toMatch(/only an accepted answer/);
  });

  it("refuses a missing required field, an unoffered choice and an unknown field", () => {
    expect(answerProblem(permission, { action: "accept", content: {} })).toMatch(/required/);
    expect(
      answerProblem(permission, { action: "accept", content: { approval_choice: "MAYBE" } }),
    ).toMatch(/offered choices/);
    expect(
      answerProblem(permission, {
        action: "accept",
        content: { approval_choice: "ALLOW_ONCE", extra: "x" },
      }),
    ).toMatch(/not a field/);
  });

  it("checks numbers against their bounds", () => {
    const form: FormRequest = {
      message: "How many?",
      requestedSchema: { properties: { n: { type: "integer", minimum: 1, maximum: 5 } } },
    };
    expect(answerProblem(form, { action: "accept", content: { n: 3 } })).toBeNull();
    expect(answerProblem(form, { action: "accept", content: { n: 9 } })).toMatch(/at most 5/);
    expect(answerProblem(form, { action: "accept", content: { n: 2.5 } })).toMatch(/whole/);
  });

  it("accepts a link request with no content and refuses one with content", () => {
    expect(answerProblem(link, { action: "accept" })).toBeNull();
    expect(answerProblem(link, { action: "accept", content: { a: "b" } })).toMatch(/no form/);
  });
});

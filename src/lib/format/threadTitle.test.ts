import { describe, expect, it } from "vitest";
import { deriveThreadTitle, DEFAULT_THREAD_TITLE } from "./threadTitle";

describe("deriveThreadTitle", () => {
  it("uses a short message as-is", () => {
    expect(deriveThreadTitle("Log a coffee")).toBe("Log a coffee");
  });

  it("collapses whitespace and newlines", () => {
    expect(deriveThreadTitle("  Log   a\ncoffee  ")).toBe("Log a coffee");
  });

  it("falls back when the message has no usable text", () => {
    expect(deriveThreadTitle("   ")).toBe(DEFAULT_THREAD_TITLE);
    expect(deriveThreadTitle("")).toBe(DEFAULT_THREAD_TITLE);
  });

  it("truncates long messages at a word boundary, not mid-word", () => {
    const source = "What did I spend on dining out across all of last month and the month before";
    const title = deriveThreadTitle(source);
    expect(title.endsWith("…")).toBe(true);
    expect(title.length).toBeLessThanOrEqual(49);
    // The defect being avoided is a cut-off token like "dini…": every word kept must be a
    // complete word from the source, not a prefix of one.
    const words = title.slice(0, -1).trim().split(" ");
    expect(source.split(" ")).toEqual(expect.arrayContaining(words));
  });

  it("does not strand a single word when the first space comes very early", () => {
    const title = deriveThreadTitle(`Supercalifragilisticexpialidocious ${"x".repeat(60)}`);
    expect(title.length).toBeGreaterThan(20);
  });

  it("drops trailing punctuation before the ellipsis", () => {
    const title = deriveThreadTitle(`${"word ".repeat(20)}`.trim());
    expect(title).not.toMatch(/[\s.,;:!?-]…$/);
  });
});

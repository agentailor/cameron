import { describe, expect, it } from "vitest";
import { enforceLimit, MAX_SQL_ROWS, validateSelect } from "./sqlGuard";

/**
 * `sqlGuard` is the static half of the `run_sql` guard stack (the real write-guard is the READ
 * ONLY transaction in analyticsRepository). It is pure and DB-free by design, so it can be
 * exercised directly — no mocks, no Postgres.
 */

describe("validateSelect", () => {
  it("accepts a plain SELECT", () => {
    expect(validateSelect("SELECT * FROM transaction")).toEqual({ ok: true });
  });

  it("accepts a WITH … SELECT CTE", () => {
    const sql = "WITH monthly AS (SELECT 1 AS n) SELECT n FROM monthly";
    expect(validateSelect(sql)).toEqual({ ok: true });
  });

  it("accepts a single trailing semicolon", () => {
    expect(validateSelect("SELECT 1;")).toEqual({ ok: true });
  });

  it("rejects an empty query", () => {
    expect(validateSelect("   ")).toMatchObject({ ok: false });
  });

  it("rejects multiple statements", () => {
    const verdict = validateSelect("SELECT 1; SELECT 2");
    expect(verdict.ok).toBe(false);
    // The reason must tell the agent what to do, not just that it failed.
    expect(verdict).toMatchObject({ reason: expect.stringContaining("single statement") });
  });

  it("rejects a query that does not start with SELECT or WITH", () => {
    expect(validateSelect("EXPLAIN SELECT 1")).toMatchObject({ ok: false });
  });

  // Each forbidden keyword should be independently rejected — this is the deny-list's whole job.
  it.each([
    ["INSERT INTO transaction VALUES (1)"],
    ["UPDATE transaction SET note = 'x'"],
    ["DELETE FROM transaction"],
    ["DROP TABLE transaction"],
    ["ALTER TABLE transaction ADD COLUMN x int"],
    ["CREATE TABLE t (id int)"],
    ["TRUNCATE transaction"],
    ["COPY transaction TO '/tmp/x'"],
    ["GRANT ALL ON transaction TO PUBLIC"],
  ])("rejects %s", (sql) => {
    expect(validateSelect(sql)).toMatchObject({ ok: false });
  });

  it("rejects a data-modifying keyword hidden after a leading SELECT", () => {
    const verdict = validateSelect("SELECT 1 FROM transaction WHERE id IN (DELETE FROM category)");
    expect(verdict.ok).toBe(false);
  });

  it("rejects SELECT … INTO (it creates a table)", () => {
    expect(validateSelect("SELECT * INTO backup FROM transaction")).toMatchObject({ ok: false });
  });

  it("rejects pg_sleep", () => {
    expect(validateSelect("SELECT pg_sleep(10)")).toMatchObject({ ok: false });
  });

  // The point of stripCommentsAndStrings: a forbidden word that only appears inside a string
  // literal or a comment is not a statement, and must not trip the deny-list. Without this,
  // a legitimate query about a transaction noted "delete subscription" would be refused.
  it("allows a forbidden keyword inside a string literal", () => {
    const sql = "SELECT * FROM transaction WHERE note = 'delete my gym subscription'";
    expect(validateSelect(sql)).toEqual({ ok: true });
  });

  it("allows a forbidden keyword inside a line comment", () => {
    expect(validateSelect("SELECT 1 -- drop this later\n")).toEqual({ ok: true });
  });

  it("allows a forbidden keyword inside a block comment", () => {
    expect(validateSelect("SELECT 1 /* do not update */ FROM transaction")).toEqual({ ok: true });
  });

  it("does not let a semicolon inside a string literal look like a second statement", () => {
    const sql = "SELECT * FROM transaction WHERE note = 'paid; refunded'";
    expect(validateSelect(sql)).toEqual({ ok: true });
  });
});

describe("enforceLimit", () => {
  it("appends a LIMIT when the query has none", () => {
    expect(enforceLimit("SELECT * FROM transaction", 500)).toContain("LIMIT 500");
  });

  it("leaves an existing LIMIT alone", () => {
    const sql = "SELECT * FROM transaction LIMIT 10";
    expect(enforceLimit(sql, 500)).toBe(sql);
  });

  it("strips a trailing semicolon before appending", () => {
    const bounded = enforceLimit("SELECT * FROM transaction;", 500);
    expect(bounded).toContain("LIMIT 500");
    // A LIMIT after a semicolon would be a syntax error.
    expect(bounded).not.toMatch(/;\s*\n?LIMIT/);
  });

  it("is not fooled by the word 'limit' inside a string literal", () => {
    const sql = "SELECT * FROM transaction WHERE note = 'limit 5'";
    expect(enforceLimit(sql, 500)).toContain("LIMIT 500");
  });

  it("defaults to MAX_SQL_ROWS", () => {
    expect(enforceLimit("SELECT 1")).toContain(`LIMIT ${MAX_SQL_ROWS}`);
  });
});

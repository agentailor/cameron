import { beforeEach, describe, expect, it, vi } from "vitest";
import { callTool } from "./testing";
import { DEFAULT_CURRENCY } from "@/lib/config/catalog";

/** Contract tests for the config tools — repository stubbed. See docs/TESTING.md. */

vi.mock("@/lib/repositories/configRepository", () => ({
  get: vi.fn(),
  list: vi.fn(),
  set: vi.fn(),
}));

const configRepo = await import("@/lib/repositories/configRepository");
const { getConfig, setConfig } = await import("./config");

function entry(key: string, value: string) {
  return { key, value, updatedAt: new Date("2026-09-01T00:00:00.000Z") };
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe("get_config", () => {
  it("reports a stored value as set", async () => {
    vi.mocked(configRepo.get).mockResolvedValue(entry("currency", "EUR"));

    const res = await callTool(getConfig, { key: "currency" });

    expect(res).toMatchObject({ key: "currency", value: "EUR", isSet: true });
  });

  /**
   * The case the whole feature exists for: an unset key must NOT look like an answer. Returning
   * the fallback alone reads as "the owner uses USD" — identical to a real choice of USD.
   */
  it("marks an unset key as not set while still reporting the fallback", async () => {
    vi.mocked(configRepo.get).mockResolvedValue(null);

    const res = await callTool(getConfig, { key: "currency" });

    expect(res.isSet).toBe(false);
    expect(res.value).toBe(DEFAULT_CURRENCY);
    expect(res.fallback).toBe(DEFAULT_CURRENCY);
  });

  it("lists every catalog key when no key is given", async () => {
    vi.mocked(configRepo.list).mockResolvedValue([]);

    const res = await callTool(getConfig);

    expect(res.settings.map((s: { key: string }) => s.key)).toContain("currency");
    expect(res.settings.every((s: { isSet: boolean }) => s.isSet === false)).toBe(true);
  });
});

describe("set_config", () => {
  it("stores a valid value and echoes what was written", async () => {
    vi.mocked(configRepo.set).mockResolvedValue(entry("currency", "EUR"));

    const res = await callTool(setConfig, { key: "currency", value: "EUR" });

    expect(res).toMatchObject({ ok: true, key: "currency", value: "EUR" });
    expect(configRepo.set).toHaveBeenCalledWith("currency", "EUR");
  });

  it("normalizes the value before storing it", async () => {
    vi.mocked(configRepo.set).mockResolvedValue(entry("currency", "EUR"));

    await callTool(setConfig, { key: "currency", value: " eur " });

    expect(configRepo.set).toHaveBeenCalledWith("currency", "EUR");
  });

  /**
   * An agent relaying the user's own words sends 'euros' or '€', not 'EUR'. Storing either would
   * put a value in the ledger that no formatter can read, so it must be refused correctably.
   */
  it.each(["euros", "€", "US Dollars", ""])("rejects %j without writing", async (value) => {
    const res = await callTool(setConfig, { key: "currency", value: value || "x" });

    expect(res.ok).toBe(false);
    expect(res.error).toBe("invalid_value");
    expect(configRepo.set).not.toHaveBeenCalled();
  });

  /** The catalog is closed — an invented key would be a row nothing ever reads. */
  it("rejects a key outside the catalog and lists the valid ones", async () => {
    const res = await callTool(setConfig, { key: "locale", value: "fr-FR" });

    expect(res).toMatchObject({ ok: false, error: "unknown_key" });
    expect(res.validKeys.map((k: { key: string }) => k.key)).toContain("currency");
    expect(configRepo.set).not.toHaveBeenCalled();
  });
});

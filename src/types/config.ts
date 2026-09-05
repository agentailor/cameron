/**
 * Domain type for owner-level settings, returned by `configRepository` so callers never depend
 * on Drizzle row types. The set of valid keys lives in `src/lib/config/catalog.ts`.
 */
export interface ConfigEntry {
  key: string;
  value: string;
  updatedAt: Date;
}

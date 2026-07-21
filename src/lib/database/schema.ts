import {
  pgTable,
  pgEnum,
  text,
  varchar,
  boolean,
  integer,
  json,
  jsonb,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/**
 * Drizzle table definitions.
 *
 * Naming convention: physical DB identifiers are lowercase snake_case (the Postgres
 * norm — avoids the forced double-quoting that Prisma's PascalCase/camelCase names
 * required). TypeScript property names stay camelCase for idiomatic JS, mapped to their
 * snake_case column via the first arg to each column helper (e.g. `createdAt` ->
 * "created_at"). Callers/domain objects are unaffected by the DB names.
 *
 * Column types were reconciled against the live database — ids are text (uuids are
 * generated app-side), `type` is a real pg enum, and `updated_at` has no DB default
 * (the repositories set it explicitly on writes).
 *
 * NOTE: This is the ONLY place the physical schema is described. The LangGraph
 * PostgresSaver checkpointer manages its own tables via its own connection and is
 * intentionally not represented here.
 */

export const mcpServerType = pgEnum("mcp_server_type", ["stdio", "http"]);

export const threads = pgTable("thread", {
  id: text("id").primaryKey().notNull(),
  title: text("title").notNull(),
  createdAt: timestamp("created_at", { precision: 3, mode: "string" })
    .default(sql`CURRENT_TIMESTAMP`)
    .notNull(),
  updatedAt: timestamp("updated_at", { precision: 3, mode: "string" }).notNull(),
});

export const mcpServers = pgTable(
  "mcp_server",
  {
    id: text("id").primaryKey().notNull(),
    name: text("name").notNull(),
    type: mcpServerType("type").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    // stdio servers
    command: text("command"),
    args: jsonb("args"),
    env: jsonb("env"),
    // http servers
    url: text("url"),
    headers: jsonb("headers"),
    // OAuth (http servers)
    requiresAuth: boolean("requires_auth").default(false),
    authTokens: json("auth_tokens"),
    clientInfo: json("client_info"),
    codeVerifier: varchar("code_verifier"),
    oauthStatus: varchar("oauth_status"),
    createdAt: timestamp("created_at", { precision: 3, mode: "string" })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    updatedAt: timestamp("updated_at", { precision: 3, mode: "string" }).notNull(),
  },
  (table) => [uniqueIndex("mcp_server_name_key").using("btree", table.name.asc().nullsLast())],
);

// --- Finance (v1) ---
// Cameron's own store: `transaction` is the system of record. External sources (a bank
// CSV/export, or a connector) normalize INTO it; the finance tools read/write it.

export const account = pgEnum("account", ["CHECKING", "SAVINGS", "CREDIT", "CASH"]);
export const transactionType = pgEnum("transaction_type", ["expense", "income"]);

export const categories = pgTable(
  "category",
  {
    id: text("id").primaryKey().notNull(),
    name: text("name").notNull(),
    // Optional presentation hints for later reports/charts.
    icon: text("icon"),
    color: text("color"),
    createdAt: timestamp("created_at", { precision: 3, mode: "string" })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    updatedAt: timestamp("updated_at", { precision: 3, mode: "string" }).notNull(),
  },
  (table) => [uniqueIndex("category_name_key").using("btree", table.name.asc().nullsLast())],
);

export const transactions = pgTable(
  "transaction",
  {
    id: text("id").primaryKey().notNull(),
    // When the transaction happened (distinct from created_at, the row insert time).
    occurredAt: timestamp("occurred_at", { precision: 3, mode: "string" }).notNull(),
    // Amount is ALWAYS positive minor units (cents); direction is carried by `type`.
    amountMinor: integer("amount_minor").notNull(),
    type: transactionType("type").notNull(),
    // Required short human-readable label — a transaction with only an amount is not usable.
    note: text("note").notNull(),
    currency: text("currency").notNull(),
    description: text("description"), // optional longer detail
    merchant: text("merchant"),
    // Nullable so imports can land uncategorized and be classified later.
    categoryId: text("category_id"),
    account: account("account").notNull(),
    // Provenance + a source-native id used to dedup re-imports.
    source: text("source").notNull(),
    externalId: text("external_id"),
    createdAt: timestamp("created_at", { precision: 3, mode: "string" })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    updatedAt: timestamp("updated_at", { precision: 3, mode: "string" }).notNull(),
  },
  (table) => [
    // Dedup key: the same (source, external_id) is imported at most once.
    uniqueIndex("transaction_source_external_id_key").using(
      "btree",
      table.source.asc(),
      table.externalId.asc(),
    ),
  ],
);

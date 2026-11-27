/**
 * Pure conversions between the three shapes an MCP server takes in the connections UI: pasted
 * JSON, the editable form draft, and the request body. Imports only the zero-import OAuth client
 * leaf, so it runs in the browser and under `pnpm test` alike.
 */

import { authorizationParamsError, normalizeScope } from "./oauthClient";

export type ServerTransport = "stdio" | "http";

/** A pre-registered OAuth client as the form and JSON edit it. */
export interface OAuthClientInput {
  clientId: string;
  /** A string sets it, null removes the stored one, absent keeps it. */
  clientSecret?: string | null;
  /** Display only: a secret is stored on the server. Never sent. */
  hasStoredSecret?: boolean;
  scope: string;
  authorizationParams: Record<string, string>;
}

/** A complete server definition. Fields for the other transport stay empty. */
export interface ServerInput {
  name: string;
  /** Tells the agent what this server is for. Empty lets Cameron generate one. */
  description?: string;
  type: ServerTransport;
  command: string;
  args: string[];
  env: Record<string, string>;
  url: string;
  headers: Record<string, string>;
  /** Remote servers only. Null registers a client dynamically, as before. */
  oauth?: OAuthClientInput | null;
}

export interface KeyValue {
  key: string;
  value: string;
}

/** Form state: rows instead of records, so a half-typed or duplicate key is representable. */
export interface ServerDraft {
  name: string;
  description: string;
  type: ServerTransport;
  command: string;
  args: string[];
  env: KeyValue[];
  url: string;
  headers: KeyValue[];
  oauth: OAuthDraft;
}

export interface OAuthDraft {
  clientId: string;
  /** A newly typed secret; the stored one never reaches the browser. */
  clientSecret: string;
  secretStored: boolean;
  removeSecret: boolean;
  scope: string;
  params: KeyValue[];
}

export type DraftErrors = Partial<
  Record<"name" | "command" | "url" | "env" | "headers" | "oauth", string>
>;

/** One server found in a paste: either usable, or rejected with a reason. */
export type ParsedEntry = { name: string; input: ServerInput } | { name: string; error: string };

export type ParseResult = { ok: true; entries: ParsedEntry[] } | { ok: false; error: string };

/** Server names prefix tool names, which most providers restrict to this alphabet. */
export const SERVER_NAME_PATTERN = /^[A-Za-z0-9_-]+$/;

export const emptyDraft = (): ServerDraft => ({
  name: "",
  description: "",
  type: "stdio",
  command: "",
  args: [],
  env: [],
  url: "",
  headers: [],
  oauth: emptyOAuthDraft(),
});

const emptyOAuthDraft = (): OAuthDraft => ({
  clientId: "",
  clientSecret: "",
  secretStored: false,
  removeSecret: false,
  scope: "",
  params: [],
});

export function draftFromInput(input: ServerInput): ServerDraft {
  const oauth = input.oauth;
  return {
    name: input.name,
    description: input.description ?? "",
    type: input.type,
    command: input.command,
    args: [...input.args],
    env: toRows(input.env),
    url: input.url,
    headers: toRows(input.headers),
    oauth: oauth
      ? {
          clientId: oauth.clientId,
          clientSecret: typeof oauth.clientSecret === "string" ? oauth.clientSecret : "",
          secretStored: !!oauth.hasStoredSecret,
          removeSecret: oauth.clientSecret === null,
          scope: oauth.scope,
          params: toRows(oauth.authorizationParams),
        }
      : emptyOAuthDraft(),
  };
}

/**
 * A draft re-read from JSON doesn't know a secret is stored (JSON never shows it); keep knowing it
 * while the client id is the same one.
 */
export function keepStoredSecret(next: ServerDraft, previous: ServerDraft): ServerDraft {
  const same = next.oauth.clientId.trim() === previous.oauth.clientId.trim();
  if (!same || !previous.oauth.secretStored || next.oauth.clientSecret) return next;
  return {
    ...next,
    oauth: { ...next.oauth, secretStored: true, removeSecret: previous.oauth.removeSecret },
  };
}

const hasOAuthInput = (o: OAuthDraft) =>
  !!(o.clientId.trim() || o.clientSecret || o.scope.trim() || o.params.some((r) => r.key.trim()));

function oauthFromDraft(o: OAuthDraft): OAuthClientInput | null {
  if (!o.clientId.trim()) return null;
  return {
    clientId: o.clientId.trim(),
    ...(o.clientSecret
      ? { clientSecret: o.clientSecret }
      : o.removeSecret
        ? { clientSecret: null }
        : {}),
    hasStoredSecret: o.secretStored && !o.removeSecret && !o.clientSecret,
    scope: normalizeScope(o.scope) ?? "",
    authorizationParams: toRecord(o.params),
  };
}

export function inputFromDraft(draft: ServerDraft): ServerInput {
  const stdio = draft.type === "stdio";
  const description = draft.description.trim();
  return {
    name: draft.name.trim(),
    ...(description ? { description } : {}),
    type: draft.type,
    command: stdio ? draft.command.trim() : "",
    args: stdio ? draft.args.map((a) => a.trim()).filter(Boolean) : [],
    env: stdio ? toRecord(draft.env) : {},
    url: stdio ? "" : draft.url.trim(),
    headers: stdio ? {} : toRecord(draft.headers),
    oauth: stdio ? null : oauthFromDraft(draft.oauth),
  };
}

export function validateDraft(draft: ServerDraft, existingNames: string[] = []): DraftErrors {
  const errors: DraftErrors = {};
  const name = draft.name.trim();

  if (!name) errors.name = "Give the server a name.";
  else if (!SERVER_NAME_PATTERN.test(name))
    errors.name = "Use letters, numbers, - and _ only (it prefixes the tool names).";
  else if (existingNames.includes(name)) errors.name = `A server named "${name}" already exists.`;

  if (draft.type === "stdio") {
    if (!draft.command.trim()) errors.command = "Enter the command that starts the server.";
    const env = rowsError(draft.env, "variable");
    if (env) errors.env = env;
  } else {
    const url = draft.url.trim();
    if (!url) errors.url = "Enter the server's URL.";
    else if (!isHttpUrl(url)) errors.url = "Enter a full http:// or https:// URL.";
    const headers = rowsError(draft.headers, "header");
    if (headers) errors.headers = headers;
    const oauth = oauthDraftError(draft.oauth);
    if (oauth) errors.oauth = oauth;
  }

  return errors;
}

function oauthDraftError(o: OAuthDraft): string | undefined {
  if (!hasOAuthInput(o)) return undefined;
  if (!o.clientId.trim()) return "Enter the client ID, or clear the other OAuth client fields.";
  return (
    rowsError(o.params, "parameter") ?? authorizationParamsError(toRecord(o.params)) ?? undefined
  );
}

/** The body POST/PATCH /api/mcp-servers expects. Empty collections clear stored values on edit. */
export function toRequestBody(input: ServerInput) {
  const description = input.description ?? "";
  return input.type === "stdio"
    ? {
        name: input.name,
        description,
        type: input.type,
        command: input.command,
        args: input.args,
        env: input.env,
      }
    : {
        name: input.name,
        description,
        type: input.type,
        url: input.url,
        headers: input.headers,
        oauthClient: input.oauth ? oauthBody(input.oauth) : null,
      };
}

function oauthBody(oauth: OAuthClientInput) {
  return {
    clientId: oauth.clientId,
    ...(oauth.clientSecret !== undefined ? { clientSecret: oauth.clientSecret } : {}),
    scope: oauth.scope || null,
    authorizationParams: oauth.authorizationParams,
  };
}

/** Serializes to the `mcpServers` shape most MCP clients and READMEs use. */
export function serializeServers(inputs: ServerInput[]): string {
  const mcpServers: Record<string, Record<string, unknown>> = {};
  for (const input of inputs) {
    const entry: Record<string, unknown> = { type: input.type };
    if (input.description) entry.description = input.description;
    if (input.type === "stdio") {
      entry.command = input.command;
      if (input.args.length) entry.args = input.args;
      if (Object.keys(input.env).length) entry.env = input.env;
    } else {
      entry.url = input.url;
      if (Object.keys(input.headers).length) entry.headers = input.headers;
      if (input.oauth) entry.oauth = serializeOAuth(input.oauth);
    }
    mcpServers[input.name] = entry;
  }
  return JSON.stringify({ mcpServers }, null, 2);
}

// A stored secret is not in the browser to write out; only one typed in this form is.
function serializeOAuth(oauth: OAuthClientInput): Record<string, unknown> {
  return {
    clientId: oauth.clientId,
    ...(oauth.clientSecret ? { clientSecret: oauth.clientSecret } : {}),
    ...(oauth.scope ? { scope: oauth.scope } : {}),
    ...(Object.keys(oauth.authorizationParams).length
      ? { authorizationParams: oauth.authorizationParams }
      : {}),
  };
}

/**
 * Reads a pasted configuration. Accepts an `mcpServers` (or VS Code `servers`) block, a bare
 * name→server map, a single server object, or a `"name": {…}` fragment copied out of one;
 * tolerates trailing commas. Each server is judged separately so one bad entry doesn't sink
 * the rest of a batch.
 */
export function parseServerConfig(text: string): ParseResult {
  const trimmed = text.trim();
  if (!trimmed) return { ok: false, error: "Paste a server configuration." };

  const parsed = parseJsonLenient(trimmed);
  if (!parsed.ok) return parsed;

  const value = parsed.value;
  if (!isObject(value)) return { ok: false, error: "Expected a JSON object." };

  const block = isObject(value.mcpServers)
    ? value.mcpServers
    : isObject(value.servers)
      ? value.servers
      : null;
  if (block) return fromMap(block);

  if (looksLikeServer(value)) {
    const name = typeof value.name === "string" ? value.name : "";
    return { ok: true, entries: [readServer(name, value)] };
  }

  const values = Object.values(value);
  if (values.length && values.every(isObject) && values.some(looksLikeServer))
    return fromMap(value);

  return {
    ok: false,
    error:
      'No server found. Expected "command" (local) or "url" (remote), or an "mcpServers" block.',
  };
}

function fromMap(map: Record<string, unknown>): ParseResult {
  const entries = Object.entries(map).map(([name, raw]) => readServer(name, raw));
  if (!entries.length) return { ok: false, error: "The server block is empty." };
  return { ok: true, entries };
}

const HTTP_TRANSPORTS = new Set(["http", "streamable-http", "streamableHttp", "sse"]);

function readServer(name: string, raw: unknown): ParsedEntry {
  if (!isObject(raw)) return { name, error: "Not a server object." };

  const declared = raw.transport ?? raw.type;
  let type: ServerTransport;
  if (declared === undefined) {
    if (typeof raw.command === "string") type = "stdio";
    else if (typeof raw.url === "string") type = "http";
    else return { name, error: 'Needs a "command" (local) or a "url" (remote).' };
  } else if (declared === "stdio") type = "stdio";
  else if (typeof declared === "string" && HTTP_TRANSPORTS.has(declared)) type = "http";
  else return { name, error: `Unsupported transport ${JSON.stringify(declared)}.` };

  const base: ServerInput = {
    name,
    ...(typeof raw.description === "string" && raw.description.trim()
      ? { description: raw.description.trim() }
      : {}),
    type,
    command: "",
    args: [],
    env: {},
    url: "",
    headers: {},
    oauth: null,
  };

  if (type === "stdio") {
    if (typeof raw.command !== "string" || !raw.command.trim())
      return { name, error: 'Missing "command".' };
    const args = readArgs(raw.args);
    if (args === null) return { name, error: '"args" must be a list of strings.' };
    const env = readStringRecord(raw.env);
    if (env === null) return { name, error: '"env" must map names to string values.' };
    return { name, input: { ...base, command: raw.command.trim(), args, env } };
  }

  if (typeof raw.url !== "string" || !raw.url.trim()) return { name, error: 'Missing "url".' };
  const headers = readStringRecord(raw.headers);
  if (headers === null) return { name, error: '"headers" must map names to string values.' };
  const oauth = readOAuth(raw.oauth);
  if (typeof oauth === "string") return { name, error: oauth };
  return { name, input: { ...base, url: raw.url.trim(), headers, oauth } };
}

const OAUTH_KEYS = ["clientId", "clientSecret", "scope", "authorizationParams"];

/** `"oauth": { clientId, clientSecret?, scope?, authorizationParams? }`; a string is an error. */
function readOAuth(value: unknown): OAuthClientInput | null | string {
  if (value === undefined || value === null) return null;
  if (!isObject(value)) return '"oauth" must be an object.';
  // Closed: a misspelt key (`scopes`, `client_id`) would otherwise drop its value unnoticed.
  const unknown = Object.keys(value).find((key) => !OAUTH_KEYS.includes(key));
  if (unknown)
    return `Unknown "oauth.${unknown}". Use ${OAUTH_KEYS.map((k) => `"${k}"`).join(", ")}.`;
  if (typeof value.clientId !== "string" || !value.clientId.trim())
    return '"oauth" needs a "clientId".';
  if (value.clientSecret !== undefined && typeof value.clientSecret !== "string")
    return '"oauth.clientSecret" must be a string.';
  const scope = value.scope;
  if (
    scope !== undefined &&
    typeof scope !== "string" &&
    !(Array.isArray(scope) && scope.every((s) => typeof s === "string"))
  )
    return '"oauth.scope" must be a string or a list of strings.';
  const params = readStringRecord(value.authorizationParams);
  if (params === null) return '"oauth.authorizationParams" must map names to string values.';
  const paramsError = authorizationParamsError(params);
  if (paramsError) return paramsError;
  return {
    clientId: value.clientId.trim(),
    ...(value.clientSecret ? { clientSecret: value.clientSecret as string } : {}),
    scope: normalizeScope(scope as string | string[] | undefined) ?? "",
    authorizationParams: params,
  };
}

function readArgs(value: unknown): string[] | null {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) return null;
  const args: string[] = [];
  for (const item of value) {
    if (!isScalar(item)) return null;
    args.push(String(item));
  }
  return args;
}

function readStringRecord(value: unknown): Record<string, string> | null {
  if (value === undefined || value === null) return {};
  if (!isObject(value)) return null;
  const record: Record<string, string> = {};
  for (const [key, item] of Object.entries(value)) {
    if (!isScalar(item)) return null;
    record[key] = String(item);
  }
  return record;
}

type JsonResult = { ok: true; value: unknown } | { ok: false; error: string };

function parseJsonLenient(text: string): JsonResult {
  let firstError: unknown;
  const candidates = [text, stripTrailingCommas(text)];
  // A `"name": {…}` fragment copied out of a larger file.
  if (text.startsWith('"')) candidates.push(`{${stripTrailingCommas(text).replace(/,\s*$/, "")}}`);

  for (const candidate of candidates) {
    try {
      return { ok: true, value: JSON.parse(candidate) };
    } catch (error) {
      firstError ??= error;
    }
  }
  return { ok: false, error: describeJsonError(firstError, text) };
}

/**
 * Splits a pasted command line into words, honoring single and double quotes,
 * so `npx -y "my pkg"` fills the command and its arguments in one paste.
 */
export function splitCommandLine(line: string): string[] {
  const words: string[] = [];
  let word = "";
  let quote: '"' | "'" | null = null;
  let started = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quote) {
      if (ch === quote) quote = null;
      // Only `\"` is an escape, so Windows paths keep their backslashes.
      else if (ch === "\\" && quote === '"' && line[i + 1] === '"') word += line[++i];
      else word += ch;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      started = true;
    } else if (/\s/.test(ch)) {
      if (started) words.push(word);
      word = "";
      started = false;
    } else {
      word += ch;
      started = true;
    }
  }
  if (started) words.push(word);
  return words;
}

/** True when pasted text reads as JSON rather than a value for one field. */
export const looksLikeJson = (text: string) => /^\s*[{"]/.test(text);

/** Removes commas directly before `}` or `]`, leaving string contents alone. */
export function stripTrailingCommas(text: string): string {
  let out = "";
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      out += ch;
      if (ch === "\\") out += text[++i] ?? "";
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    if (ch === ",") {
      const rest = text.slice(i + 1).match(/^\s*([}\]])/);
      if (rest) continue;
    }
    out += ch;
  }
  return out;
}

/** Turns a JSON.parse error into "Line 3, column 5: …" when the engine reports a position. */
export function describeJsonError(error: unknown, text: string): string {
  const raw = error instanceof Error ? error.message : "Invalid JSON";
  const position = raw.match(/at position (\d+)/);
  const message = raw.replace(/\s*(in JSON )?at position \d+.*$/, "").replace(/^JSON\.parse: /, "");
  if (!position) return message;

  const before = text.slice(0, Number(position[1]));
  const line = before.split("\n").length;
  const column = before.length - before.lastIndexOf("\n");
  return `Line ${line}, column ${column}: ${message}`;
}

function toRows(record: Record<string, string>): KeyValue[] {
  return Object.entries(record).map(([key, value]) => ({ key, value }));
}

function toRecord(rows: KeyValue[]): Record<string, string> {
  const record: Record<string, string> = {};
  for (const { key, value } of rows) if (key.trim()) record[key.trim()] = value;
  return record;
}

function rowsError(rows: KeyValue[], noun: string): string | undefined {
  const seen = new Set<string>();
  for (const { key, value } of rows) {
    const k = key.trim();
    if (!k && value) return `Every ${noun} needs a name.`;
    if (k && seen.has(k)) return `"${k}" is listed twice.`;
    if (k) seen.add(k);
  }
  return undefined;
}

function isHttpUrl(value: string): boolean {
  try {
    const { protocol } = new URL(value);
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

function looksLikeServer(value: unknown): boolean {
  return isObject(value) && (typeof value.command === "string" || typeof value.url === "string");
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isScalar(value: unknown): value is string | number | boolean {
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean";
}

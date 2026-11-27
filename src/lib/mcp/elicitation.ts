/**
 * MCP elicitation, as the owner sees it: a connected server asking a question in the middle of a
 * tool call. Zero imports, because the chat UI renders and checks the form with it.
 * See docs/MCP_ELICITATION.md.
 */

/** One field of a form request: the protocol's flat, primitive-only schema. */
export interface ElicitationProperty {
  type?: string;
  title?: string;
  description?: string;
  default?: unknown;
  enum?: unknown[];
  enumNames?: string[];
  oneOf?: { const?: unknown; title?: string }[];
  items?: { enum?: unknown[]; anyOf?: { const?: unknown; title?: string }[] };
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  format?: string;
}

export interface FormRequest {
  mode?: "form";
  message: string;
  requestedSchema: {
    type?: "object";
    properties?: Record<string, ElicitationProperty>;
    required?: string[];
  };
}

export interface UrlRequest {
  mode: "url";
  message: string;
  url: string;
}

export type ElicitationRequest = FormRequest | UrlRequest;

/** A server's question, held as an interrupt until the owner answers it. */
export interface PendingElicitation {
  /** The interrupt the answer resumes. */
  interruptId: string;
  /** The tool call it belongs to, when it could be matched; the card renders on that call. */
  toolCallId?: string;
  server: string;
  tool: string;
  /** Usually one; a server may ask several questions in one round, each answered separately. */
  requests: Record<string, ElicitationRequest>;
}

export type ElicitationAction = "accept" | "decline" | "cancel";

export type ElicitationValue = string | number | boolean | string[];

export interface ElicitationAnswer {
  action: ElicitationAction;
  /** Only with `accept` on a form request. */
  content?: Record<string, ElicitationValue>;
}

/** Answers for one interrupt, keyed by the server's request keys. */
export type ElicitationResponses = Record<string, ElicitationAnswer>;

/** What the client sends to resume: every pending interrupt's responses, by interrupt id. */
export type ElicitationAnswers = Record<string, ElicitationResponses>;

export const ELICITATION_ACTIONS: readonly ElicitationAction[] = ["accept", "decline", "cancel"];

export const isUrlRequest = (request: ElicitationRequest): request is UrlRequest =>
  request.mode === "url";

/** A choice the form offers: its value and the label to show. */
export interface Choice {
  value: string;
  label: string;
}

/** The kind of input a property renders as; `null` for one the form cannot offer. */
export type FieldKind =
  | { kind: "choice"; choices: Choice[] }
  | { kind: "multi"; choices: Choice[] }
  | { kind: "boolean" }
  | { kind: "number"; integer: boolean }
  | { kind: "text" };

const asChoices = (values: unknown[], labels?: (string | undefined)[]): Choice[] =>
  values.map((v, i) => ({ value: String(v), label: labels?.[i] || String(v) }));

export function fieldKind(property: ElicitationProperty): FieldKind {
  if (property.type === "array") {
    const items = property.items ?? {};
    if (items.anyOf) {
      return {
        kind: "multi",
        choices: asChoices(
          items.anyOf.map((o) => o.const),
          items.anyOf.map((o) => o.title),
        ),
      };
    }
    return { kind: "multi", choices: asChoices(items.enum ?? []) };
  }
  if (property.oneOf) {
    return {
      kind: "choice",
      choices: asChoices(
        property.oneOf.map((o) => o.const),
        property.oneOf.map((o) => o.title),
      ),
    };
  }
  if (property.enum)
    return { kind: "choice", choices: asChoices(property.enum, property.enumNames) };
  if (property.type === "boolean") return { kind: "boolean" };
  if (property.type === "number" || property.type === "integer") {
    return { kind: "number", integer: property.type === "integer" };
  }
  return { kind: "text" };
}

/**
 * A form field's starting value: the schema's default, else nothing. An optional field the owner
 * never touched is left out, not sent as "no"; a required checkbox starts unticked, since
 * unticked is itself an answer.
 */
export function initialFieldValue(
  property: ElicitationProperty,
  required: boolean,
): ElicitationValue | undefined {
  const d = property.default;
  if (typeof d === "string" || typeof d === "number" || typeof d === "boolean") return d;
  if (Array.isArray(d)) return d.map(String);
  return required && fieldKind(property).kind === "boolean" ? false : undefined;
}

/** What a form sends: unset fields and cleared text fields are left out. */
export function formContent(
  values: Record<string, ElicitationValue | undefined> = {},
): Record<string, ElicitationValue> {
  return Object.fromEntries(
    Object.entries(values).filter(
      (e): e is [string, ElicitationValue] => e[1] !== undefined && e[1] !== "",
    ),
  );
}

/**
 * Why an answer would be refused, or null when it is valid. Checked before resuming, because
 * the adapter fails the whole call on an answer its schema rejects, where the owner should just
 * get the form back. The adapter still validates against the full schema afterwards.
 */
export function answerProblem(
  request: ElicitationRequest,
  answer: ElicitationAnswer,
): string | null {
  if (!ELICITATION_ACTIONS.includes(answer.action)) return "unknown action";
  if (answer.action !== "accept") {
    return answer.content === undefined ? null : "only an accepted answer carries content";
  }
  if (isUrlRequest(request)) {
    return answer.content === undefined ? null : "a link request takes no form content";
  }

  const content = answer.content ?? {};
  const properties = request.requestedSchema.properties ?? {};
  for (const key of Object.keys(content)) {
    if (!Object.hasOwn(properties, key)) return `"${key}" is not a field of this form`;
  }
  for (const key of request.requestedSchema.required ?? []) {
    const value = content[key];
    if (value === undefined || value === "" || (Array.isArray(value) && value.length === 0)) {
      return `"${properties[key]?.title ?? key}" is required`;
    }
  }
  for (const [key, value] of Object.entries(content)) {
    const problem = valueProblem(properties[key], value);
    if (problem) return `"${properties[key]?.title ?? key}" ${problem}`;
  }
  return null;
}

function valueProblem(property: ElicitationProperty, value: ElicitationValue): string | null {
  const field = fieldKind(property);
  switch (field.kind) {
    case "choice":
      return typeof value === "string" && field.choices.some((c) => c.value === value)
        ? null
        : "must be one of the offered choices";
    case "multi":
      return Array.isArray(value) && value.every((v) => field.choices.some((c) => c.value === v))
        ? null
        : "must only contain offered choices";
    case "boolean":
      return typeof value === "boolean" ? null : "must be yes or no";
    case "number": {
      if (typeof value !== "number" || !Number.isFinite(value)) return "must be a number";
      if (field.integer && !Number.isInteger(value)) return "must be a whole number";
      if (property.minimum !== undefined && value < property.minimum) {
        return `must be at least ${property.minimum}`;
      }
      if (property.maximum !== undefined && value > property.maximum) {
        return `must be at most ${property.maximum}`;
      }
      return null;
    }
    case "text":
      if (typeof value !== "string") return "must be text";
      if (property.minLength !== undefined && value.length < property.minLength) {
        return `must be at least ${property.minLength} characters`;
      }
      if (property.maxLength !== undefined && value.length > property.maxLength) {
        return `must be at most ${property.maxLength} characters`;
      }
      return null;
  }
}

/** Told to the agent beside a result the owner declined or cancelled: content may be missing. */
export function withheldNote(action: "decline" | "cancel"): string {
  const verb = action === "decline" ? "declined" : "dismissed";
  return (
    `The owner ${verb} the server's request for confirmation during this call, so the server may ` +
    "have withheld content. An empty or partial result here does not mean nothing matched; say " +
    "that the owner did not allow it."
  );
}

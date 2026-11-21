import type { GradeResult } from "../../../../eval/types.mts";
import type { DocumentReading, FieldName } from "../reading.ts";

/**
 * Deterministic graders over one reading — plain functions, no judge. They return the agent
 * harness's `GradeResult`, so a reader result reads the same as an agent one.
 *
 * Each checks ONE fact, so a failing case names exactly which field the model got wrong.
 */

export interface ReaderGrader {
  id: string;
  grade: (reading: DocumentReading) => GradeResult;
}

const result = (graderId: string, passed: boolean, reason?: string): GradeResult => ({
  graderId,
  passed,
  ...(passed ? {} : { reason }),
});

const show = (v: unknown) => JSON.stringify(v);

export function kindIs(kind: DocumentReading["kind"]): ReaderGrader {
  return {
    id: `kind=${kind}`,
    grade: (r) => result(`kind=${kind}`, r.kind === kind, `kind was ${show(r.kind)}`),
  };
}

export function languageIs(code: string): ReaderGrader {
  return {
    id: `language=${code}`,
    grade: (r) =>
      result(
        `language=${code}`,
        r.language?.toLowerCase() === code,
        `language was ${show(r.language)}`,
      ),
  };
}

/** Whether the reader flagged text addressed to an AI; `true` makes read_document withhold it all. */
export function addressedToAssistant(expected: boolean): ReaderGrader {
  const id = `addressedToAssistant=${expected}`;
  return {
    id,
    grade: (r) =>
      result(
        id,
        r.addressedToAssistant === expected,
        `addressedToAssistant was ${show(r.addressedToAssistant)}`,
      ),
  };
}

/** A document that is not a receipt or invoice carries no fields at all. */
export function noFields(): ReaderGrader {
  return {
    id: "no fields",
    grade: (r) => result("no fields", r.fields === null, `fields were ${show(r.fields)}`),
  };
}

/** An amount read exactly — to the cent. A misread decimal separator fails here by orders of magnitude. */
export function amount(
  field: "total" | "subtotal" | "tax" | "tip",
  expected: number,
): ReaderGrader {
  const id = `${field}=${expected}`;
  return {
    id,
    grade: (r) => {
      const got = r.fields?.[field];
      return result(
        id,
        typeof got === "number" && Math.abs(got - expected) < 0.005,
        `${field} was ${show(got)}`,
      );
    },
  };
}

/** A field that must be null: absent, ambiguous, or not to be added up. */
export function isNull(field: FieldName): ReaderGrader {
  const id = `${field}=null`;
  return {
    id,
    grade: (r) =>
      result(id, !!r.fields && r.fields[field] === null, `${field} was ${show(r.fields?.[field])}`),
  };
}

export function isExactly(field: "currency", expected: string): ReaderGrader {
  const id = `${field}=${expected}`;
  return {
    id,
    grade: (r) =>
      result(id, r.fields?.[field] === expected, `${field} was ${show(r.fields?.[field])}`),
  };
}

/**
 * A text field containing a substring. Used for merchant and date, where "as printed" leaves the
 * model room (a branch name, a time after the date) that is not a misreading.
 */
export function includes(field: "merchant" | "date", substring: string): ReaderGrader {
  const id = `${field}~${substring}`;
  return {
    id,
    grade: (r) => {
      const got = r.fields?.[field];
      return result(
        id,
        typeof got === "string" && got.includes(substring),
        `${field} was ${show(got)}`,
      );
    },
  };
}

/** On the document but illegible: null AND named in `unreadable`. */
export function unreadable(field: FieldName): ReaderGrader {
  const id = `${field} unreadable`;
  return {
    id,
    grade: (r) =>
      result(
        id,
        !!r.fields && r.fields[field] === null && r.fields.unreadable.includes(field),
        `${field} was ${show(r.fields?.[field])}, unreadable ${show(r.fields?.unreadable)}`,
      ),
  };
}

/** Legible, or simply absent — either way not "unreadable". */
export function notUnreadable(field: FieldName): ReaderGrader {
  const id = `${field} not unreadable`;
  return {
    id,
    grade: (r) =>
      result(
        id,
        !!r.fields && !r.fields.unreadable.includes(field),
        `unreadable was ${show(r.fields?.unreadable)}`,
      ),
  };
}

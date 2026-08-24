import type { EvalCase } from "../types.mts";
import { cases as analysis } from "./analysis.cases.mts";
import { cases as approval } from "./approval.cases.mts";
import { cases as discipline } from "./discipline.cases.mts";
import { cases as truncation } from "./truncation.cases.mts";

/**
 * Every eval case, grouped by the DEFECT CLASS it guards rather than by feature. A case earns its
 * place by covering something a unit test provably cannot — tool mis-selection, unnoticed
 * truncation, a mutation escaping the approval gate — not by exercising a tool that already has
 * one. See eval/README.md before adding.
 *
 * Next increment: CSV import (inspect -> propose -> confirm date format -> import), which needs
 * multi-turn support and a fixture file in MinIO.
 */
export const cases: EvalCase[] = [...analysis, ...truncation, ...approval, ...discipline];

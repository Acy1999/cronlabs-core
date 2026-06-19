import type { CronField } from "./types.js";

/** The five standard cron fields, in order, with their valid ranges. */
export const CRON_FIELDS = [
  { name: "Minute", range: "0-59" },
  { name: "Hour", range: "0-23" },
  { name: "Day of Month", range: "1-31" },
  { name: "Month", range: "1-12" },
  { name: "Day of Week", range: "0-6 (Sun-Sat)" },
] as const;

/** Structured view of a 5-field expression's parts. */
export interface CronParts {
  minute: string;
  hour: string;
  dayOfMonth: string;
  month: string;
  dayOfWeek: string;
}

/**
 * Split an expression into its five fields. Missing trailing fields default to
 * `*` so partially-typed input still parses cleanly for display.
 */
export function splitFields(expression: string): CronParts {
  const parts = expression.trim().split(/\s+/);
  return {
    minute: parts[0] ?? "*",
    hour: parts[1] ?? "*",
    dayOfMonth: parts[2] ?? "*",
    month: parts[3] ?? "*",
    dayOfWeek: parts[4] ?? "*",
  };
}

/** Split an expression into its labeled fields for display. */
export function parseCronFields(expression: string): CronField[] {
  const parts = expression.trim().split(/\s+/);
  return CRON_FIELDS.map((field, i) => ({
    name: field.name,
    value: parts[i] ?? "*",
    description: field.range,
  }));
}

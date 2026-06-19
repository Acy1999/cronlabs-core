import { Cron } from "croner";
import type { CronValidation, ValidateCronOptions } from "./types.js";
import { describeCron } from "./describe.js";
import { detectEdgeCases } from "./edge-cases.js";

const ONE_MINUTE_MS = 60_000;

/**
 * Validate a cron expression, returning its next run times, a human-readable
 * description, and any detected edge cases (DST skips, phantom schedules, …).
 *
 * Never throws: an invalid expression resolves to `{ isValid: false, error }`.
 */
export function validateCron(
  expression: string,
  options: ValidateCronOptions = {},
): CronValidation {
  const {
    timezone = "UTC",
    count = 10,
    year = new Date().getFullYear(),
  } = options;

  try {
    const job = new Cron(expression, { timezone });

    // Walk forward from "now" to collect the next `count` run times.
    const nextRuns: Date[] = [];
    let next = job.nextRun();
    for (let i = 0; i < count && next; i++) {
      nextRuns.push(next);
      next = job.nextRun(next);
    }

    const edgeCases = detectEdgeCases(expression, {
      timezone,
      year,
      nextRuns,
      isValid: true,
    });

    return {
      isValid: true,
      nextRuns,
      description: describeCron(expression),
      warnings: edgeCases.map((e) => e.message),
      edgeCases,
    };
  } catch (error) {
    return {
      isValid: false,
      error: error instanceof Error ? error.message : "Invalid cron expression",
      nextRuns: [],
      description: "",
      warnings: [],
      edgeCases: [],
    };
  }
}

/**
 * Check whether a given date is an exact run time for the expression. Asks
 * croner for the first run at or after one minute prior; an exact landing on
 * `date` means the date matches the schedule.
 */
export function matchesPattern(
  expression: string,
  date: Date,
  timezone = "UTC",
): boolean {
  try {
    const job = new Cron(expression, { timezone });
    const prev = job.nextRun(new Date(date.getTime() - ONE_MINUTE_MS));
    return prev?.getTime() === date.getTime();
  } catch {
    return false;
  }
}

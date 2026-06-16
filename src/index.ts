/**
 * @cronlabs/core — the CronLabs cron engine.
 *
 * Pure TypeScript, no I/O. Parses and validates cron expressions, computes
 * upcoming runs, explains them in plain English, and detects the scheduling
 * edge cases that cause real outages (DST skips/double-fires, phantom
 * schedules, frequency surprises). Reused everywhere: browser, edge, CLI, API.
 */
export type {
  CronField,
  CronValidation,
  EdgeCase,
  ValidateCronOptions,
} from "./types";

export { validateCron, matchesPattern } from "./validate";
export { describeCron } from "./describe";
export { parseCronFields, splitFields, CRON_FIELDS } from "./fields";
export type { CronParts } from "./fields";
export { detectEdgeCases, getDstTransitions } from "./edge-cases";
export type { DetectOptions, DstTransition } from "./edge-cases";
export { runsInRange } from "./range";
export type { RunsInRange, RunsInRangeOptions } from "./range";

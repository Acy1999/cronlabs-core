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
} from "./types.js";

export { validateCron, matchesPattern } from "./validate.js";
export { describeCron } from "./describe.js";
export { parseCronFields, splitFields, CRON_FIELDS } from "./fields.js";
export type { CronParts } from "./fields.js";
export { detectEdgeCases, getDstTransitions } from "./edge-cases.js";
export type { DetectOptions, DstTransition } from "./edge-cases.js";
export { runsInRange } from "./range.js";
export type { RunsInRange, RunsInRangeOptions } from "./range.js";

export {
  convertCron,
  convertAll,
  CONVERSION_TARGETS,
  expandDayOfWeek,
  compressRanges,
} from "./convert.js";
export type {
  Conversion,
  ConversionTarget,
  ConversionTargetId,
  ConversionNote,
  ConversionFormat,
  ConvertOptions,
} from "./convert.js";

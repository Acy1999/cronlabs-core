/** A single labeled cron field (minute, hour, …) for display. */
export interface CronField {
  name: string;
  value: string;
  description: string;
}

/**
 * A detected scheduling pitfall. `warning` flags likely mistakes (a job that
 * never fires, a DST skip); `info` is a heads-up the user may have intended.
 */
export interface EdgeCase {
  kind:
    | "phantom" // expression can never fire (e.g. Feb 30)
    | "rare" // fires far less often than it looks (Feb 29, day 31)
    | "frequency" // unusually high/low fire count
    | "dom-dow-or" // day-of-month AND day-of-week → OR semantics
    | "dst-skip" // target wall-clock time skipped on spring-forward
    | "dst-double"; // target wall-clock time repeats on fall-back
  severity: "warning" | "info";
  message: string;
}

/** Result of validating an expression. */
export interface CronValidation {
  isValid: boolean;
  error?: string;
  nextRuns: Date[];
  description: string;
  /** Human-readable messages, one per detected edge case (back-compat). */
  warnings: string[];
  /** Structured edge-case findings (preferred for richer UIs). */
  edgeCases: EdgeCase[];
}

export interface ValidateCronOptions {
  /** IANA timezone the schedule is evaluated in. Defaults to UTC. */
  timezone?: string;
  /** How many upcoming run times to compute. Defaults to 10. */
  count?: number;
  /** Reference year used for edge-case scanning. Defaults to the current year. */
  year?: number;
}

import { Cron } from "croner";

export interface RunsInRangeOptions {
  /** IANA timezone the schedule is evaluated in. Defaults to UTC. */
  timezone?: string;
  /** Start of the window (inclusive). */
  from: Date;
  /** End of the window (exclusive). */
  to: Date;
  /**
   * Safety cap on the number of runs returned. High-frequency schedules (e.g.
   * every minute) can produce tens of thousands of fires over a month; the cap
   * keeps the result bounded and is surfaced via `truncated`. Defaults to 10000.
   */
  max?: number;
}

export interface RunsInRange {
  /** Fire instants within [from, to), in ascending order. */
  runs: Date[];
  /** True when `max` was reached before the window end. */
  truncated: boolean;
}

const DEFAULT_MAX = 10_000;

/**
 * Compute every time an expression fires within a date window — the primitive
 * behind calendar/timeline views. Unlike `validateCron` (which walks forward
 * from "now"), this scans an arbitrary range, so callers can travel to any
 * month, past or future.
 *
 * Never throws: an invalid expression resolves to an empty, untruncated result.
 */
export function runsInRange(
  expression: string,
  options: RunsInRangeOptions,
): RunsInRange {
  const { timezone = "UTC", from, to, max = DEFAULT_MAX } = options;
  const runs: Date[] = [];

  if (from >= to) return { runs, truncated: false };

  try {
    const job = new Cron(expression, { timezone });

    // croner's nextRun(date) returns the first run strictly after `date`, so
    // start one millisecond early to include a run landing exactly on `from`.
    let next = job.nextRun(new Date(from.getTime() - 1));
    while (next && next < to) {
      runs.push(next);
      if (runs.length >= max) return { runs, truncated: true };
      next = job.nextRun(next);
    }
  } catch {
    return { runs: [], truncated: false };
  }

  return { runs, truncated: false };
}

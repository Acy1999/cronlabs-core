import type { EdgeCase } from "./types";
import { splitFields } from "./fields";

const MS_PER_MINUTE = 60_000;
const MS_PER_HOUR = 3_600_000;
const MS_PER_DAY = 86_400_000;
const MS_PER_YEAR = 365.25 * MS_PER_DAY;

// ---------------------------------------------------------------------------
// Timezone helpers (no external dependency — built on Intl)
// ---------------------------------------------------------------------------

interface WallTime {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
}

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function getFormatter(timeZone: string): Intl.DateTimeFormat {
  let fmt = formatterCache.get(timeZone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
    formatterCache.set(timeZone, fmt);
  }
  return fmt;
}

/** The local wall-clock time in `timeZone` at a given UTC instant. */
function getWallTime(utcMs: number, timeZone: string): WallTime {
  const parts = getFormatter(timeZone).formatToParts(new Date(utcMs));
  const get = (type: string) =>
    Number(parts.find((p) => p.type === type)?.value ?? "0");
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour"),
    minute: get("minute"),
  };
}

/** Offset (minutes, local − UTC) of `timeZone` at a given UTC instant. */
function getOffsetMinutes(utcMs: number, timeZone: string): number {
  const w = getWallTime(utcMs, timeZone);
  const asUtc = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute);
  return (asUtc - utcMs) / MS_PER_MINUTE;
}

type WallClassification = "normal" | "skipped" | "ambiguous";

/**
 * Classify a wall-clock time in a timezone relative to DST transitions:
 *  - "skipped": the time doesn't exist (spring-forward gap) → a job set for it
 *    never runs that day.
 *  - "ambiguous": the time occurs twice (fall-back overlap) → a job may run
 *    twice or at an unexpected instant.
 *  - "normal": exists exactly once.
 *
 * Works by sampling the UTC offset on either side of the target time; if it
 * changes, a transition is nearby and we resolve which case applies.
 */
function classifyWallTime(wall: WallTime, timeZone: string): WallClassification {
  const guess = Date.UTC(
    wall.year,
    wall.month - 1,
    wall.day,
    wall.hour,
    wall.minute,
  );

  const offBefore = getOffsetMinutes(guess - 6 * MS_PER_HOUR, timeZone);
  const offAfter = getOffsetMinutes(guess + 6 * MS_PER_HOUR, timeZone);

  // No transition within the surrounding window → the time exists normally.
  if (offBefore === offAfter) return "normal";

  const utcUsingBefore = guess - offBefore * MS_PER_MINUTE;
  const utcUsingAfter = guess - offAfter * MS_PER_MINUTE;

  const matchesBefore = sameWall(getWallTime(utcUsingBefore, timeZone), wall);
  const matchesAfter = sameWall(getWallTime(utcUsingAfter, timeZone), wall);

  if (matchesBefore && matchesAfter && utcUsingBefore !== utcUsingAfter) {
    return "ambiguous";
  }
  if (!matchesBefore && !matchesAfter) {
    return "skipped";
  }
  return "normal";
}

function sameWall(a: WallTime, b: WallTime): boolean {
  return (
    a.year === b.year &&
    a.month === b.month &&
    a.day === b.day &&
    a.hour === b.hour &&
    a.minute === b.minute
  );
}

interface DstTransition {
  day: number; // day-of-month the transition lands on
  month: number; // 1-12
  type: "spring-forward" | "fall-back";
}

/**
 * Find the DST transitions in a year for a timezone by scanning day-to-day for
 * UTC-offset changes (sampled at local noon, away from the transition edge).
 */
function findDstTransitions(year: number, timeZone: string): DstTransition[] {
  const transitions: DstTransition[] = [];
  let prevOffset = getOffsetMinutes(Date.UTC(year, 0, 1, 12), timeZone);

  for (let dayIndex = 1; dayIndex < 366; dayIndex++) {
    const utcNoon = Date.UTC(year, 0, 1, 12) + dayIndex * MS_PER_DAY;
    const wall = getWallTime(utcNoon, timeZone);
    if (wall.year !== year) break; // rolled past the reference year

    const offset = getOffsetMinutes(utcNoon, timeZone);
    if (offset !== prevOffset) {
      transitions.push({
        day: wall.day,
        month: wall.month,
        type: offset > prevOffset ? "spring-forward" : "fall-back",
      });
      prevOffset = offset;
    }
  }
  return transitions;
}

// ---------------------------------------------------------------------------
// Edge-case detection
// ---------------------------------------------------------------------------

const isInteger = (field: string) => /^\d+$/.test(field);

export interface DetectOptions {
  timezone: string;
  year: number;
  /** Upcoming runs already computed by the caller (avoids recomputation). */
  nextRuns: Date[];
  /** Whether the expression is syntactically valid. */
  isValid: boolean;
}

/**
 * Inspect an expression for scheduling pitfalls that are syntactically valid
 * but rarely intended: phantom schedules, frequency surprises, day-of-month vs
 * day-of-week OR semantics, and DST skips/double-fires.
 */
export function detectEdgeCases(
  expression: string,
  options: DetectOptions,
): EdgeCase[] {
  const { timezone, year, nextRuns, isValid } = options;
  if (!isValid) return [];

  const { hour, dayOfMonth, month, dayOfWeek } = splitFields(expression);
  const edges: EdgeCase[] = [];

  // Phantom: parses fine but never fires (e.g. "0 0 30 2 *" — Feb 30).
  if (nextRuns.length === 0) {
    edges.push({
      kind: "phantom",
      severity: "warning",
      message:
        "This schedule never fires — the day/month combination doesn't exist (e.g. February 30th).",
    });
    return edges; // nothing else is meaningful for a never-firing schedule
  }

  // Rare: fires far less often than the expression suggests.
  if (dayOfMonth === "31") {
    edges.push({
      kind: "rare",
      severity: "warning",
      message:
        "Day 31 only exists in 7 months. This job won't run in Feb, Apr, Jun, Sep, or Nov.",
    });
  }
  if (dayOfMonth === "29" && month === "2") {
    edges.push({
      kind: "rare",
      severity: "warning",
      message: "Feb 29 only occurs in leap years. This job runs ~once every 4 years.",
    });
  }

  // Day-of-month AND day-of-week → cron uses OR semantics, a classic gotcha.
  if (dayOfMonth !== "*" && dayOfWeek !== "*") {
    edges.push({
      kind: "dom-dow-or",
      severity: "info",
      message:
        "When both day-of-month and day-of-week are set, the job runs when EITHER matches (OR logic, not AND).",
    });
  }

  // Frequency reality check, derived cheaply from the gap between the first two
  // runs. Only flagged at the extremes, where the first gap is representative.
  if (nextRuns.length >= 2) {
    const gapMs = nextRuns[1]!.getTime() - nextRuns[0]!.getTime();
    if (gapMs > 0 && gapMs <= 5 * MS_PER_MINUTE) {
      const perYear = Math.round(MS_PER_YEAR / gapMs);
      edges.push({
        kind: "frequency",
        severity: gapMs <= MS_PER_MINUTE ? "warning" : "info",
        message: `This fires very frequently — roughly ${perYear.toLocaleString("en-US")} times per year. Confirm the frequency is intended.`,
      });
    } else if (gapMs >= 60 * MS_PER_DAY) {
      const months = Math.round(gapMs / (30 * MS_PER_DAY));
      edges.push({
        kind: "frequency",
        severity: "info",
        message: `This fires rarely — roughly once every ${months} months. Double-check this is the intended cadence.`,
      });
    }
  }

  // DST detection: only meaningful when the schedule targets a fixed wall-clock
  // time every day (the classic "0 30 2 * * *" outage shape).
  if (isInteger(hour) && dayOfMonth === "*" && dayOfWeek === "*") {
    edges.push(...detectDstEdges(expression, timezone, year, month));
  }

  return edges;
}

function detectDstEdges(
  expression: string,
  timezone: string,
  year: number,
  month: string,
): EdgeCase[] {
  const { minute, hour } = splitFields(expression);
  if (!isInteger(minute) || !isInteger(hour)) return [];

  const targetHour = Number(hour);
  const targetMinute = Number(minute);
  const monthFilter = isInteger(month) ? Number(month) : null;
  const edges: EdgeCase[] = [];

  for (const transition of findDstTransitions(year, timezone)) {
    if (monthFilter !== null && monthFilter !== transition.month) continue;

    const wall: WallTime = {
      year,
      month: transition.month,
      day: transition.day,
      hour: targetHour,
      minute: targetMinute,
    };
    const classification = classifyWallTime(wall, timezone);
    const time = `${String(targetHour).padStart(2, "0")}:${String(targetMinute).padStart(2, "0")}`;

    if (transition.type === "spring-forward" && classification === "skipped") {
      edges.push({
        kind: "dst-skip",
        severity: "warning",
        message: `On the spring-forward day, ${time} doesn't exist in ${timezone} — this run is skipped that day.`,
      });
    } else if (transition.type === "fall-back" && classification === "ambiguous") {
      edges.push({
        kind: "dst-double",
        severity: "warning",
        message: `On the fall-back day, ${time} occurs twice in ${timezone} — this run may fire twice or at an ambiguous time.`,
      });
    }
  }

  return edges;
}

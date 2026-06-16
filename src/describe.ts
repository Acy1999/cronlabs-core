import { splitFields } from "./fields";

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

const DAYS = [
  "Sunday", "Monday", "Tuesday", "Wednesday",
  "Thursday", "Friday", "Saturday",
];

// Whole-expression shortcuts for the most common schedules.
const COMMON: Record<string, string> = {
  "* * * * *": "Every minute",
  "0 * * * *": "Every hour",
  "0 0 * * *": "Every day at midnight",
  "0 0 * * 0": "Every Sunday at midnight",
  "0 0 1 * *": "First day of every month at midnight",
};

/**
 * Produce a human-readable summary of a cron expression, e.g. "at 9:00 AM on
 * weekdays". Falls back to "Custom schedule" when no parts are recognized.
 */
export function describeCron(expression: string): string {
  const trimmed = expression.trim();
  const common = COMMON[trimmed];
  if (common) return common;

  const parts = trimmed.split(/\s+/);
  if (parts.length < 5) return "Invalid expression";

  const { minute, hour, dayOfMonth, month, dayOfWeek } = splitFields(trimmed);
  const out: string[] = [];

  // Minute
  if (minute === "*") {
    out.push("every minute");
  } else if (minute.startsWith("*/")) {
    out.push(`every ${minute.slice(2)} minutes`);
  } else if (minute !== "0") {
    out.push(`at minute ${minute}`);
  }
  // (minute === "0" is folded into the hour phrasing below)

  // Hour
  if (hour === "*") {
    if (minute !== "*" && !minute.startsWith("*/")) out.push("every hour");
  } else if (hour.startsWith("*/")) {
    out.push(`every ${hour.slice(2)} hours`);
  } else {
    const hourNum = parseInt(hour, 10);
    const ampm = hourNum >= 12 ? "PM" : "AM";
    const hour12 = hourNum % 12 || 12;
    out.push(`at ${hour12}:${minute.padStart(2, "0")} ${ampm}`);
  }

  // Day of month
  if (dayOfMonth !== "*") {
    if (dayOfMonth === "1") out.push("on the 1st");
    else if (dayOfMonth === "15") out.push("on the 15th");
    else out.push(`on day ${dayOfMonth}`);
  }

  // Month
  if (month !== "*") {
    const monthNum = parseInt(month, 10);
    if (monthNum >= 1 && monthNum <= 12) out.push(`in ${MONTHS[monthNum - 1]}`);
  }

  // Day of week
  if (dayOfWeek !== "*") {
    if (dayOfWeek === "1-5") out.push("on weekdays");
    else if (dayOfWeek === "0,6") out.push("on weekends");
    else {
      const dayNum = parseInt(dayOfWeek, 10);
      if (dayNum >= 0 && dayNum <= 6) out.push(`on ${DAYS[dayNum]}`);
    }
  }

  return out.join(" ") || "Custom schedule";
}

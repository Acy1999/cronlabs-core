import { describe, it, expect } from "vitest";
import {
  convertCron,
  convertAll,
  CONVERSION_TARGETS,
  expandDayOfWeek,
  compressRanges,
} from "../src/index";
import type { ConversionNote } from "../src/index";

const messages = (notes: ConversionNote[]) => notes.map((n) => n.message).join(" | ");
const hasSeverity = (notes: ConversionNote[], s: ConversionNote["severity"]) =>
  notes.some((n) => n.severity === s);

describe("expandDayOfWeek", () => {
  it("expands wildcard to every day", () => {
    expect(expandDayOfWeek("*")).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });
  it("expands weekdays range", () => {
    expect(expandDayOfWeek("1-5")).toEqual([1, 2, 3, 4, 5]);
  });
  it("expands a list", () => {
    expect(expandDayOfWeek("0,6")).toEqual([0, 6]);
  });
  it("treats 7 as Sunday (0)", () => {
    expect(expandDayOfWeek("7")).toEqual([0]);
  });
  it("expands names case-insensitively", () => {
    expect(expandDayOfWeek("MON-fri")).toEqual([1, 2, 3, 4, 5]);
  });
  it("expands steps to explicit days", () => {
    expect(expandDayOfWeek("*/2")).toEqual([0, 2, 4, 6]);
  });
  it("supports wrap-around ranges", () => {
    expect(expandDayOfWeek("5-1")).toEqual([0, 1, 5, 6]);
  });
  it("returns null for Quartz/AWS extensions it can't remap", () => {
    expect(expandDayOfWeek("6#3")).toBeNull();
    expect(expandDayOfWeek("L")).toBeNull();
  });
});

describe("compressRanges", () => {
  it("collapses contiguous runs into ranges", () => {
    expect(compressRanges([2, 3, 4, 5, 6])).toBe("2-6");
  });
  it("keeps gaps as a list", () => {
    expect(compressRanges([1, 7])).toBe("1,7");
  });
  it("mixes ranges and singles", () => {
    expect(compressRanges([1, 2, 3, 5])).toBe("1-3,5");
  });
});

describe("unix-cron", () => {
  it("passes the expression through unchanged", () => {
    expect(convertCron("0 9 * * 1-5", "unix-cron").schedule).toBe("0 9 * * 1-5");
  });
  it("adds CRON_TZ when a non-UTC timezone is given", () => {
    const c = convertCron("0 9 * * *", "unix-cron", { timezone: "America/New_York" });
    expect(c.snippet).toContain("CRON_TZ=America/New_York");
    expect(hasSeverity(c.notes, "warning")).toBe(true);
  });
});

describe("github-actions", () => {
  it("warns about UTC and sub-5-minute coalescing", () => {
    const c = convertCron("*/2 * * * *", "github-actions", { timezone: "Europe/London" });
    expect(c.format).toBe("yaml");
    expect(c.snippet).toContain("cron:");
    expect(messages(c.notes)).toMatch(/5 minutes/);
    expect(messages(c.notes)).toMatch(/UTC/);
  });
  it("does not warn about frequency for a daily schedule", () => {
    const c = convertCron("0 9 * * *", "github-actions");
    expect(messages(c.notes)).not.toMatch(/5 minutes/);
  });
});

describe("vercel", () => {
  it("flags sub-daily schedules as needing Pro", () => {
    const c = convertCron("*/15 * * * *", "vercel");
    expect(c.format).toBe("json");
    expect(messages(c.notes)).toMatch(/Hobby/);
    expect(hasSeverity(c.notes, "warning")).toBe(true);
  });
  it("does not flag a daily schedule", () => {
    const c = convertCron("0 9 * * *", "vercel");
    expect(hasSeverity(c.notes, "warning")).toBe(false);
  });
});

describe("kubernetes", () => {
  it("emits a CronJob manifest with timeZone when set", () => {
    const c = convertCron("0 9 * * *", "kubernetes", { timezone: "Asia/Tokyo" });
    expect(c.snippet).toContain("kind: CronJob");
    expect(c.snippet).toContain("timeZone: Asia/Tokyo");
  });
});

describe("aws-eventbridge", () => {
  it("produces a 6-field expression with a trailing year and ? in day-of-week", () => {
    // Every day at 09:00 → both day fields are *, so DOW becomes ?
    expect(convertCron("0 9 * * *", "aws-eventbridge").schedule).toBe("cron(0 9 * * ? *)");
  });

  it("reindexes day-of-week to 1-7 (1=Sunday) and ?'s day-of-month", () => {
    // Weekdays Mon-Fri (1-5) → AWS 2-6
    const c = convertCron("0 9 * * 1-5", "aws-eventbridge");
    expect(c.schedule).toBe("cron(0 9 ? * 2-6 *)");
    expect(messages(c.notes)).toMatch(/1=Sunday/);
  });

  it("maps standard Sunday (0) to AWS 1", () => {
    expect(convertCron("0 0 * * 0", "aws-eventbridge").schedule).toBe("cron(0 0 ? * 1 *)");
  });

  it("errors when both day fields are restricted (no OR semantics)", () => {
    const c = convertCron("0 0 13 * 5", "aws-eventbridge");
    expect(hasSeverity(c.notes, "error")).toBe(true);
    expect(c.schedule).toBe("cron(0 0 13 * ? *)");
  });

  it("keeps day-of-month and ?'s day-of-week when only DOM is set", () => {
    expect(convertCron("0 0 1 * *", "aws-eventbridge").schedule).toBe("cron(0 0 1 * ? *)");
  });
});

describe("quartz", () => {
  it("prepends a seconds field and reindexes day-of-week", () => {
    const c = convertCron("0 9 * * 1-5", "quartz");
    expect(c.schedule).toBe("0 0 9 ? * 2-6");
    expect(messages(c.notes)).toMatch(/seconds field/);
  });
  it("notes the Spring dialect difference", () => {
    expect(messages(convertCron("0 9 * * 1", "quartz").notes)).toMatch(/Spring/);
  });
});

describe("systemd", () => {
  it("converts a weekday morning job to OnCalendar", () => {
    const c = convertCron("0 9 * * 1-5", "systemd");
    expect(c.schedule).toBe("Mon..Fri *-*-* 09:00:00");
    expect(c.format).toBe("ini");
    expect(c.snippet).toContain("OnCalendar=Mon..Fri *-*-* 09:00:00");
  });
  it("converts an every-15-minutes job", () => {
    expect(convertCron("*/15 * * * *", "systemd").schedule).toBe("*-*-* *:0/15:00");
  });
  it("flags list expressions as approximate", () => {
    const c = convertCron("0,30 9 * * *", "systemd");
    expect(hasSeverity(c.notes, "warning")).toBe(true);
  });
});

describe("node-cron & celery", () => {
  it("node-cron passes through and adds timezone option", () => {
    const c = convertCron("0 9 * * *", "node-cron", { timezone: "America/Chicago" });
    expect(c.snippet).toContain('cron.schedule("0 9 * * *"');
    expect(c.snippet).toContain('timezone: "America/Chicago"');
  });
  it("celery emits crontab kwargs", () => {
    const c = convertCron("30 9 * * 1-5", "celery");
    expect(c.snippet).toContain('minute="30"');
    expect(c.snippet).toContain('day_of_week="1-5"');
    expect(c.format).toBe("python");
  });
});

describe("convertAll", () => {
  it("returns one conversion per registered target", () => {
    const all = convertAll("0 9 * * 1-5");
    expect(all).toHaveLength(CONVERSION_TARGETS.length);
    expect(new Set(all.map((c) => c.target.id)).size).toBe(CONVERSION_TARGETS.length);
    // Every conversion has a non-empty schedule and snippet.
    for (const c of all) {
      expect(c.schedule.length).toBeGreaterThan(0);
      expect(c.snippet.length).toBeGreaterThan(0);
    }
  });
  it("throws on an unknown target", () => {
    // @ts-expect-error testing runtime guard
    expect(() => convertCron("0 9 * * *", "fake-platform")).toThrow();
  });
});

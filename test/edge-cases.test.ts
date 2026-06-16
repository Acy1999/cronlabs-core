import { describe, it, expect } from "vitest";
import { validateCron } from "../src/index";
import type { EdgeCase } from "../src/index";

// 2026 reference year: US DST springs forward Mar 8, falls back Nov 1.
const YEAR = 2026;

const kinds = (edges: EdgeCase[]) => edges.map((e) => e.kind);

describe("phantom schedules", () => {
  it("flags a date that never occurs (Feb 30) and reports no runs", () => {
    const result = validateCron("0 0 30 2 *", { year: YEAR });
    expect(result.isValid).toBe(true);
    expect(result.nextRuns).toEqual([]);
    expect(kinds(result.edgeCases)).toContain("phantom");
  });

  it("flags April 31 as phantom", () => {
    const result = validateCron("0 0 31 4 *", { year: YEAR });
    expect(kinds(result.edgeCases)).toContain("phantom");
  });
});

describe("rare schedules", () => {
  it("warns that day 31 skips short months", () => {
    expect(kinds(validateCron("0 0 31 * *", { year: YEAR }).edgeCases)).toContain("rare");
  });

  it("warns that Feb 29 is leap-year only", () => {
    expect(kinds(validateCron("0 0 29 2 *", { year: YEAR }).edgeCases)).toContain("rare");
  });
});

describe("day-of-month + day-of-week OR semantics", () => {
  it("flags when both fields are restricted", () => {
    expect(kinds(validateCron("0 0 13 * 5", { year: YEAR }).edgeCases)).toContain("dom-dow-or");
  });

  it("does not flag when only one is restricted", () => {
    expect(kinds(validateCron("0 0 13 * *", { year: YEAR }).edgeCases)).not.toContain("dom-dow-or");
  });
});

describe("frequency reality check", () => {
  it("warns that every-minute fires extremely often", () => {
    const edge = validateCron("* * * * *", { year: YEAR }).edgeCases.find(
      (e) => e.kind === "frequency",
    );
    expect(edge).toBeDefined();
    expect(edge!.message).toMatch(/per year/);
  });

  it("does not flag an ordinary hourly schedule", () => {
    expect(kinds(validateCron("0 * * * *", { year: YEAR }).edgeCases)).not.toContain("frequency");
  });
});

describe("DST spring-forward detection", () => {
  it("flags a 02:30 daily job as skipped in America/New_York", () => {
    const edges = validateCron("30 2 * * *", {
      timezone: "America/New_York",
      year: YEAR,
    }).edgeCases;
    expect(kinds(edges)).toContain("dst-skip");
    expect(kinds(edges)).not.toContain("dst-double");
  });

  it("flags 01:00 in Europe/London (its spring transition is at 01:00)", () => {
    const edges = validateCron("0 1 * * *", {
      timezone: "Europe/London",
      year: YEAR,
    }).edgeCases;
    expect(kinds(edges)).toContain("dst-skip");
  });
});

describe("DST fall-back detection", () => {
  it("flags a 01:30 daily job as ambiguous in America/New_York", () => {
    const edges = validateCron("30 1 * * *", {
      timezone: "America/New_York",
      year: YEAR,
    }).edgeCases;
    expect(kinds(edges)).toContain("dst-double");
    expect(kinds(edges)).not.toContain("dst-skip");
  });
});

describe("no DST false positives", () => {
  it("does not flag a 02:30 job in UTC", () => {
    const edges = validateCron("30 2 * * *", { timezone: "UTC", year: YEAR }).edgeCases;
    expect(kinds(edges)).not.toContain("dst-skip");
    expect(kinds(edges)).not.toContain("dst-double");
  });

  it("does not flag a job in a DST-free zone (Asia/Tokyo)", () => {
    const edges = validateCron("30 2 * * *", {
      timezone: "Asia/Tokyo",
      year: YEAR,
    }).edgeCases;
    expect(kinds(edges)).not.toContain("dst-skip");
    expect(kinds(edges)).not.toContain("dst-double");
  });

  it("does not flag a safe time (12:00) in a DST zone", () => {
    const edges = validateCron("0 12 * * *", {
      timezone: "America/New_York",
      year: YEAR,
    }).edgeCases;
    expect(kinds(edges)).not.toContain("dst-skip");
    expect(kinds(edges)).not.toContain("dst-double");
  });

  it("does not attempt DST detection for stepped hours", () => {
    const edges = validateCron("0 */2 * * *", {
      timezone: "America/New_York",
      year: YEAR,
    }).edgeCases;
    expect(kinds(edges)).not.toContain("dst-skip");
    expect(kinds(edges)).not.toContain("dst-double");
  });
});

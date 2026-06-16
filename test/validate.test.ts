import { describe, it, expect } from "vitest";
import { validateCron, matchesPattern } from "../src/index";

describe("validateCron", () => {
  it("validates a correct expression and returns the requested run count", () => {
    const result = validateCron("0 * * * *", { count: 5 });
    expect(result.isValid).toBe(true);
    expect(result.error).toBeUndefined();
    expect(result.nextRuns).toHaveLength(5);
  });

  it("defaults to 10 upcoming runs", () => {
    expect(validateCron("0 0 * * *").nextRuns).toHaveLength(10);
  });

  it("returns runs in strictly increasing order", () => {
    const { nextRuns } = validateCron("*/10 * * * *");
    for (let i = 1; i < nextRuns.length; i++) {
      expect(nextRuns[i]!.getTime()).toBeGreaterThan(nextRuns[i - 1]!.getTime());
    }
  });

  it("flags an invalid expression without throwing", () => {
    const result = validateCron("not a cron");
    expect(result.isValid).toBe(false);
    expect(result.error).toBeTruthy();
    expect(result.nextRuns).toEqual([]);
  });

  it("includes a human description", () => {
    expect(validateCron("0 0 * * *").description).toBe("Every day at midnight");
  });

  it("mirrors edge-case messages into warnings for back-compat", () => {
    const result = validateCron("0 0 31 * *");
    expect(result.warnings).toEqual(result.edgeCases.map((e) => e.message));
    expect(result.warnings.length).toBeGreaterThan(0);
  });
});

describe("matchesPattern", () => {
  it("returns true for an exact run instant", () => {
    // 2026-03-10 is a Tuesday; "0 0 * * *" fires at midnight UTC.
    const midnight = new Date("2026-03-10T00:00:00.000Z");
    expect(matchesPattern("0 0 * * *", midnight, "UTC")).toBe(true);
  });

  it("returns false for a non-matching instant", () => {
    const notMidnight = new Date("2026-03-10T00:30:00.000Z");
    expect(matchesPattern("0 0 * * *", notMidnight, "UTC")).toBe(false);
  });
});

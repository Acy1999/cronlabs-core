import { describe, it, expect } from "vitest";
import { runsInRange, getDstTransitions } from "../src/index";

const utc = (y: number, m: number, d: number, h = 0, min = 0) =>
  new Date(Date.UTC(y, m - 1, d, h, min));

describe("runsInRange", () => {
  it("returns every daily fire across a month", () => {
    const { runs, truncated } = runsInRange("0 0 * * *", {
      from: utc(2026, 1, 1),
      to: utc(2026, 2, 1),
    });
    expect(runs).toHaveLength(31);
    expect(truncated).toBe(false);
    expect(runs[0]!.getTime()).toBe(utc(2026, 1, 1).getTime());
    expect(runs[30]!.getTime()).toBe(utc(2026, 1, 31).getTime());
  });

  it("includes a run landing exactly on `from`", () => {
    const { runs } = runsInRange("0 0 * * *", {
      from: utc(2026, 1, 1),
      to: utc(2026, 1, 2),
    });
    expect(runs).toHaveLength(1);
    expect(runs[0]!.getTime()).toBe(utc(2026, 1, 1).getTime());
  });

  it("excludes a run landing exactly on `to`", () => {
    const { runs } = runsInRange("0 0 * * *", {
      from: utc(2026, 1, 1, 0, 1),
      to: utc(2026, 1, 2),
    });
    expect(runs).toHaveLength(0);
  });

  it("counts 24 hourly fires in a day", () => {
    const { runs } = runsInRange("0 * * * *", {
      from: utc(2026, 3, 1),
      to: utc(2026, 3, 2),
    });
    expect(runs).toHaveLength(24);
  });

  it("returns empty for an inverted or empty window", () => {
    expect(
      runsInRange("0 0 * * *", { from: utc(2026, 2, 1), to: utc(2026, 1, 1) }).runs,
    ).toEqual([]);
  });

  it("returns empty for an invalid expression without throwing", () => {
    const res = runsInRange("not a cron", { from: utc(2026, 1, 1), to: utc(2026, 2, 1) });
    expect(res.runs).toEqual([]);
    expect(res.truncated).toBe(false);
  });

  it("caps output and flags truncation for high-frequency schedules", () => {
    const { runs, truncated } = runsInRange("* * * * *", {
      from: utc(2026, 1, 1),
      to: utc(2026, 2, 1),
      max: 10,
    });
    expect(runs).toHaveLength(10);
    expect(truncated).toBe(true);
  });

  it("evaluates the schedule in the requested timezone", () => {
    // Midnight in New York (EDT, UTC−4 in June) is 04:00 UTC.
    const { runs } = runsInRange("0 0 * * *", {
      timezone: "America/New_York",
      from: utc(2026, 6, 1),
      to: utc(2026, 6, 2, 12),
    });
    expect(runs).toHaveLength(2);
    expect(runs[0]!.getUTCHours()).toBe(4);
  });
});

describe("getDstTransitions", () => {
  it("finds spring-forward and fall-back for America/New_York in 2026", () => {
    const transitions = getDstTransitions(2026, "America/New_York");
    expect(transitions).toEqual([
      { month: 3, day: 8, type: "spring-forward" },
      { month: 11, day: 1, type: "fall-back" },
    ]);
  });

  it("returns none for a zone without DST", () => {
    expect(getDstTransitions(2026, "Asia/Tokyo")).toEqual([]);
    expect(getDstTransitions(2026, "UTC")).toEqual([]);
  });
});

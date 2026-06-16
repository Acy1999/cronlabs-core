import { describe, it, expect } from "vitest";
import { describeCron, parseCronFields, splitFields } from "../src/index";

describe("describeCron", () => {
  it.each([
    ["* * * * *", "Every minute"],
    ["0 * * * *", "Every hour"],
    ["0 0 * * *", "Every day at midnight"],
    ["0 0 1 * *", "First day of every month at midnight"],
  ])("describes the common pattern %s", (expr, expected) => {
    expect(describeCron(expr)).toBe(expected);
  });

  it("describes a weekday morning schedule", () => {
    expect(describeCron("0 9 * * 1-5")).toBe("at 9:00 AM on weekdays");
  });

  it("describes stepped minutes", () => {
    expect(describeCron("*/15 * * * *")).toBe("every 15 minutes");
  });

  it("returns a fallback for too-few fields", () => {
    expect(describeCron("0 0")).toBe("Invalid expression");
  });
});

describe("parseCronFields / splitFields", () => {
  it("labels the five fields", () => {
    const fields = parseCronFields("0 9 * * 1-5");
    expect(fields.map((f) => f.value)).toEqual(["0", "9", "*", "*", "1-5"]);
    expect(fields.map((f) => f.name)).toEqual([
      "Minute",
      "Hour",
      "Day of Month",
      "Month",
      "Day of Week",
    ]);
  });

  it("defaults missing fields to *", () => {
    expect(splitFields("30")).toEqual({
      minute: "30",
      hour: "*",
      dayOfMonth: "*",
      month: "*",
      dayOfWeek: "*",
    });
  });
});

import { describe, it, expect } from "vitest";
import { resolveDateRange } from "./date-range";

// Fixed "now" keeps every expectation a literal date (no clock dependency).
const now = new Date("2026-06-05T12:00:00.000Z");

describe("resolveDateRange", () => {
  it.each([
    {
      range: "7d",
      label: "Last 7 days",
      since: "2026-05-29T12:00:00.000Z",
      granularity: "daily",
    },
    {
      range: "30d",
      label: "Last 30 days",
      since: "2026-05-06T12:00:00.000Z",
      granularity: "daily",
    },
    {
      range: "90d",
      label: "Last 90 days",
      since: "2026-03-07T12:00:00.000Z",
      granularity: "weekly",
    },
    {
      range: "12m",
      label: "Last 12 months",
      since: "2025-06-05T12:00:00.000Z",
      granularity: "monthly",
    },
  ])(
    "resolves $range to since=$since with $granularity granularity",
    ({ range, label, since, granularity }) => {
      expect(resolveDateRange({ range, now })).toEqual({
        range,
        label,
        since,
        granularity,
      });
    }
  );

  it("resolves all to an unbounded window with monthly granularity", () => {
    expect(resolveDateRange({ range: "all", now })).toEqual({
      range: "all",
      label: "All time",
      since: null,
      granularity: "monthly",
    });
  });

  it("defaults to 30d when the param is absent", () => {
    expect(resolveDateRange({ range: null, now })).toEqual(
      resolveDateRange({ range: "30d", now })
    );
  });

  it.each(["14d", "", "7D", "last-week"])(
    "falls back to the default for invalid value %j",
    (range) => {
      expect(resolveDateRange({ range, now })).toEqual(
        resolveDateRange({ range: "30d", now })
      );
    }
  );
});

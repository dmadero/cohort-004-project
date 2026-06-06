// ─── Date-range helper ───
// Translates the `?range=` URL param shared by the analytics routes into a
// resolved time window. Pure — callers supply `now` — so every preset is
// testable without touching the clock. Presets, the default, and the
// granularity derivation are fixed by the PRD (docs/prd-analytics-feature.md).

export type RangePreset = "7d" | "30d" | "90d" | "12m" | "all";

/** Chart bucket size. Derives from the preset; never chosen independently. */
export type RangeGranularity = "daily" | "weekly" | "monthly";

export interface ResolvedDateRange {
  /** The preset actually applied — the default when the param was absent or invalid. */
  range: RangePreset;
  /** Human-readable scope for KPI captions, e.g. "Last 30 days". */
  label: string;
  /** Inclusive ISO-UTC lower bound, or null for an unbounded (all-time) window. */
  since: string | null;
  granularity: RangeGranularity;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function daysBefore(opts: { now: Date; days: number }): string {
  return new Date(opts.now.getTime() - opts.days * DAY_MS).toISOString();
}

function monthsBefore(opts: { now: Date; months: number }): string {
  // setUTCMonth normalizes overflow (e.g. a leap day rolls forward a day),
  // which is acceptable drift for a 12-month analytics window.
  const since = new Date(opts.now);
  since.setUTCMonth(since.getUTCMonth() - opts.months);
  return since.toISOString();
}

const PRESETS: Record<
  RangePreset,
  {
    label: string;
    shortLabel: string;
    granularity: RangeGranularity;
    since: (now: Date) => string | null;
  }
> = {
  "7d": {
    label: "Last 7 days",
    shortLabel: "7d",
    granularity: "daily",
    since: (now) => daysBefore({ now, days: 7 }),
  },
  "30d": {
    label: "Last 30 days",
    shortLabel: "30d",
    granularity: "daily",
    since: (now) => daysBefore({ now, days: 30 }),
  },
  "90d": {
    label: "Last 90 days",
    shortLabel: "90d",
    granularity: "weekly",
    since: (now) => daysBefore({ now, days: 90 }),
  },
  "12m": {
    label: "Last 12 months",
    shortLabel: "12m",
    granularity: "monthly",
    since: (now) => monthsBefore({ now, months: 12 }),
  },
  all: {
    label: "All time",
    shortLabel: "All",
    granularity: "monthly",
    since: () => null,
  },
};

export const DEFAULT_RANGE: RangePreset = "30d";

/** Presets in display order, for range selector UIs. */
export const RANGE_OPTIONS: ReadonlyArray<{
  value: RangePreset;
  label: string;
  shortLabel: string;
}> = (["7d", "30d", "90d", "12m", "all"] as const).map((value) => ({
  value,
  label: PRESETS[value].label,
  shortLabel: PRESETS[value].shortLabel,
}));

function isRangePreset(value: string | null): value is RangePreset {
  return value !== null && value in PRESETS;
}

/**
 * Resolve the raw `?range=` param into a concrete window. Unknown or missing
 * values fall back to the default preset rather than erroring — a malformed
 * shared link should still render a sensible dashboard.
 */
export function resolveDateRange(opts: {
  range: string | null;
  now: Date;
}): ResolvedDateRange {
  const range = isRangePreset(opts.range) ? opts.range : DEFAULT_RANGE;
  const preset = PRESETS[range];

  return {
    range,
    label: preset.label,
    since: preset.since(opts.now),
    granularity: preset.granularity,
  };
}

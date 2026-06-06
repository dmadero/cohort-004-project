import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "~/components/ui/chart";
import type { RangeGranularity } from "~/lib/date-range";
import type { TrendPoint } from "~/services/analyticsService";

interface TrendChartProps {
  /** Gapless series from the analytics service; [] renders the empty state. */
  points: TrendPoint[];
  /** Drives axis/tooltip date formatting — must match the series' bucketing. */
  granularity: RangeGranularity;
  /** Series name shown in the tooltip, e.g. "Enrollments". */
  label: string;
  /** Formats raw values for the axis and tooltip, e.g. cents → "$49". */
  formatValue?: (value: number) => string;
}

/**
 * Shared area-trend chart for the analytics dashboards: one time series of
 * pre-bucketed points. Bucket keys arrive in the service's UTC formats
 * (daily/weekly "YYYY-MM-DD", monthly "YYYY-MM") and are formatted for
 * display here, in UTC, so a bucket never shifts across the viewer's
 * midnight.
 */
export function TrendChart({
  points,
  granularity,
  label,
  formatValue = (value) => value.toLocaleString("en-US"),
}: TrendChartProps) {
  if (points.length === 0) {
    return (
      <div className="flex h-64 items-center justify-center text-sm text-muted-foreground">
        No activity in this period.
      </div>
    );
  }

  const chartConfig = {
    value: { label, color: "var(--chart-1)" },
  } satisfies ChartConfig;

  return (
    <ChartContainer config={chartConfig} className="h-64 w-full">
      <AreaChart data={points} margin={{ left: 4, right: 4 }}>
        <CartesianGrid vertical={false} />
        <XAxis
          dataKey="bucket"
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          tickFormatter={(bucket: string) => formatBucket({ bucket, granularity })}
        />
        <YAxis
          width={48}
          tickLine={false}
          axisLine={false}
          allowDecimals={false}
          tickFormatter={(value: number) => formatValue(value)}
        />
        <ChartTooltip
          content={
            <ChartTooltipContent
              labelFormatter={(_, payload) =>
                formatBucket({
                  bucket: String(payload[0]?.payload.bucket),
                  granularity,
                })
              }
              formatter={(value) => (
                <span className="flex w-full justify-between gap-4">
                  <span className="text-muted-foreground">{label}</span>
                  <span className="font-mono font-medium">
                    {formatValue(Number(value))}
                  </span>
                </span>
              )}
            />
          }
        />
        <Area
          dataKey="value"
          type="monotone"
          fill="var(--color-value)"
          fillOpacity={0.2}
          stroke="var(--color-value)"
          strokeWidth={2}
        />
      </AreaChart>
    </ChartContainer>
  );
}

/** "2026-06-01" → "Jun 1" (daily), "Jun 1" week start (weekly); "2026-06" → "Jun 2026". */
function formatBucket(opts: { bucket: string; granularity: RangeGranularity }): string {
  if (opts.granularity === "monthly") {
    const [year, month] = opts.bucket.split("-").map(Number);
    return new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString("en-US", {
      month: "short",
      year: "numeric",
      timeZone: "UTC",
    });
  }
  return new Date(`${opts.bucket}T00:00:00.000Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

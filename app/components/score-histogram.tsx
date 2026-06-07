import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "~/components/ui/chart";

interface ScoreHistogramProps {
  /**
   * First-attempt counts per decile from the analytics service: index i covers
   * scores in [i*10%, (i+1)*10%], length 10. An all-zero array renders the
   * empty state.
   */
  distribution: number[];
}

const chartConfig = {
  count: { label: "Students", color: "var(--chart-1)" },
} satisfies ChartConfig;

/** "0–10%", "10–20%", … "90–100%" for decile index i. */
function bucketLabel(index: number): string {
  return `${index * 10}–${(index + 1) * 10}%`;
}

/**
 * Score distribution histogram for the analytics drill-down: one bar per
 * decile of first-attempt scores, so an instructor can tell "everyone scored
 * 70" from "half scored 100, half scored 40". Purely presentational — the
 * service buckets the scores; this only draws them.
 */
export function ScoreHistogram({ distribution }: ScoreHistogramProps) {
  if (distribution.every((count) => count === 0)) {
    return (
      <div className="flex h-64 items-center justify-center text-sm text-muted-foreground">
        No quiz attempts yet.
      </div>
    );
  }

  const data = distribution.map((count, index) => ({
    bucket: bucketLabel(index),
    // Axis shows just the bin's lower edge ("0", "10", … "90") so all ten
    // labels stay legible on a phone; the tooltip carries the full range.
    tick: `${index * 10}`,
    count,
  }));

  return (
    <ChartContainer config={chartConfig} className="h-64 w-full">
      <BarChart data={data} margin={{ left: 4, right: 4 }}>
        <CartesianGrid vertical={false} />
        <XAxis
          dataKey="tick"
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          interval={0}
          unit="%"
        />
        <YAxis
          width={32}
          tickLine={false}
          axisLine={false}
          allowDecimals={false}
        />
        <ChartTooltip
          content={
            <ChartTooltipContent
              labelFormatter={(_, payload) =>
                `Scored ${payload[0]?.payload.bucket}`
              }
              formatter={(value) => (
                <span className="flex w-full justify-between gap-4">
                  <span className="text-muted-foreground">Students</span>
                  <span className="font-mono font-medium">
                    {Number(value).toLocaleString("en-US")}
                  </span>
                </span>
              )}
            />
          }
        />
        <Bar dataKey="count" fill="var(--color-count)" radius={4} />
      </BarChart>
    </ChartContainer>
  );
}

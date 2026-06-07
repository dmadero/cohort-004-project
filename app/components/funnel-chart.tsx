interface FunnelStage {
  label: string;
  count: number;
}

interface FunnelChartProps {
  /** Stages in funnel order; bars scale against the first stage's count. */
  stages: FunnelStage[];
}

/**
 * Horizontal stage funnel for the analytics drill-down: each stage renders a
 * bar sized as its share of the first (widest) stage, with the count and
 * percentage beside it. Purely presentational — callers compute the stages
 * and render their own empty state when the first stage is zero (an all-zero
 * funnel reads as broken, not empty).
 */
export function FunnelChart({ stages }: FunnelChartProps) {
  const baseline = stages[0]?.count ?? 0;

  return (
    <div className="space-y-4">
      {stages.map((stage) => {
        const share = baseline > 0 ? stage.count / baseline : 0;
        return (
          <div key={stage.label}>
            <div className="flex items-baseline justify-between gap-4 text-sm">
              <span className="font-medium">{stage.label}</span>
              <span className="text-muted-foreground">
                {stage.count.toLocaleString("en-US")} ·{" "}
                {Math.round(share * 100)}%
              </span>
            </div>
            <div className="mt-1.5 h-3 rounded-full bg-muted">
              <div
                className="h-3 rounded-full bg-primary"
                style={{ width: `${share * 100}%` }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

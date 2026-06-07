import { TrendingDown } from "lucide-react";
import type { LessonFunnelStep } from "~/services/analyticsService";

interface LessonDropoffFunnelProps {
  /** Steps in course order, as computed by the analytics service. */
  steps: LessonFunnelStep[];
  /**
   * All-time enrollments — the bar baseline, so widths read as "share of the
   * class that finished this lesson" rather than share of the first lesson.
   */
  enrolledCount: number;
}

function formatPercent(value: number) {
  return `${Math.round(value * 100)}%`;
}

/**
 * Lesson-by-lesson drop-off funnel for the analytics drill-down: one bar per
 * lesson in course order, with completion count and lesson-to-lesson
 * retention beside it. The service-flagged worst step carries a labeled
 * "Biggest drop-off" badge (text + icon, not color alone), and low-retention
 * lessons surface as insight callouts above the rows. Purely presentational —
 * callers render their own empty state when there are no lessons or no
 * completions (an all-zero funnel reads as broken, not empty).
 */
export function LessonDropoffFunnel({
  steps,
  enrolledCount,
}: LessonDropoffFunnelProps) {
  const insights = steps.filter((step) => step.isLowRetention);

  return (
    <div className="space-y-6">
      {insights.length > 0 && (
        <div className="space-y-2">
          {insights.map((step) => (
            <div
              key={step.lessonId}
              className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm"
            >
              <TrendingDown
                className="mt-0.5 size-4 shrink-0 text-destructive"
                aria-hidden="true"
              />
              <p>
                <span className="font-medium">{step.lessonTitle}</span> loses{" "}
                {formatPercent(1 - (step.retentionRate ?? 0))} of the students
                who completed the previous lesson — worth reviewing its content
                or difficulty.
              </p>
            </div>
          ))}
        </div>
      )}

      <ol className="space-y-4">
        {steps.map((step) => {
          const share =
            enrolledCount > 0 ? step.completedCount / enrolledCount : 0;
          return (
            <li key={step.lessonId}>
              <div className="flex items-baseline justify-between gap-4 text-sm">
                <span className="min-w-0">
                  <span className="font-medium">{step.lessonTitle}</span>{" "}
                  <span className="text-muted-foreground">
                    · {step.moduleTitle}
                  </span>
                  {step.isBiggestDropoff && (
                    <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-destructive/10 px-2 py-0.5 text-xs font-medium text-destructive">
                      <TrendingDown className="size-3" aria-hidden="true" />
                      Biggest drop-off
                    </span>
                  )}
                </span>
                <span className="shrink-0 text-muted-foreground">
                  {step.completedCount.toLocaleString("en-US")} ·{" "}
                  {step.retentionRate === null
                    ? "—"
                    : `${formatPercent(step.retentionRate)} retained`}
                </span>
              </div>
              <div className="mt-1.5 h-3 rounded-full bg-muted">
                <div
                  className={
                    step.isBiggestDropoff
                      ? "h-3 rounded-full bg-destructive"
                      : "h-3 rounded-full bg-primary"
                  }
                  style={{ width: `${share * 100}%` }}
                />
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

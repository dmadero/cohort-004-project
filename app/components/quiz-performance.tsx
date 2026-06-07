import { AlertTriangle } from "lucide-react";
import type { CourseQuizPerformance } from "~/services/analyticsService";
import { ScoreHistogram } from "~/components/score-histogram";

interface QuizPerformanceProps {
  /** Course quiz stats from the analytics service. */
  performance: CourseQuizPerformance;
}

/** 0–1 score → "73%"; null → an em dash so "no data" never reads as 0%. */
function formatScore(score: number | null): string {
  return score === null ? "—" : `${Math.round(score * 100)}%`;
}

/**
 * Quiz performance for the analytics drill-down: a course-wide first-attempt
 * average and score-distribution histogram, high-failure quizzes surfaced as
 * insight callouts (text + icon, not color alone), and a module → lesson →
 * quiz breakdown of average scores at every altitude. Purely presentational —
 * the service computes first-attempt averages, distributions, and flags;
 * callers render the empty state when the course has no quizzes.
 */
export function QuizPerformance({ performance }: QuizPerformanceProps) {
  return (
    <div className="space-y-6">
      {performance.flaggedQuizzes.length > 0 && (
        <div className="space-y-2">
          {performance.flaggedQuizzes.map((quiz) => (
            <div
              key={quiz.quizId}
              className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm"
            >
              <AlertTriangle
                className="mt-0.5 size-4 shrink-0 text-destructive"
                aria-hidden="true"
              />
              <p>
                <span className="font-medium">{quiz.lessonTitle}</span>’s quiz
                has a {formatScore(quiz.failRate)} first-attempt failure rate
                across {quiz.studentCount} students — worth reviewing whether
                the lesson teaches the material.
              </p>
            </div>
          ))}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <div>
          <div className="mb-2 flex items-baseline justify-between gap-4 text-sm">
            <span className="font-medium">Score distribution</span>
            <span className="text-muted-foreground">
              avg {formatScore(performance.avgScore)} ·{" "}
              {performance.attemptCount.toLocaleString("en-US")} first attempts
            </span>
          </div>
          <ScoreHistogram distribution={performance.distribution} />
        </div>

        <div className="space-y-4">
          {performance.modules.map((module) => (
            <div key={module.moduleId}>
              <div className="flex items-baseline justify-between gap-4 text-sm">
                <span className="font-medium">{module.moduleTitle}</span>
                <span className="text-muted-foreground">
                  {formatScore(module.avgScore)}
                </span>
              </div>
              <ul className="mt-1 space-y-1 border-l pl-3">
                {module.lessons.map((lesson) => (
                  <li key={lesson.lessonId}>
                    <div className="flex items-baseline justify-between gap-4 text-sm">
                      <span className="min-w-0 truncate text-muted-foreground">
                        {lesson.lessonTitle}
                      </span>
                      <span className="shrink-0 tabular-nums">
                        {formatScore(lesson.avgScore)}
                      </span>
                    </div>
                    {lesson.quizzes.map(
                      (quiz) =>
                        quiz.isHighFailure && (
                          <span
                            key={quiz.quizId}
                            className="ml-0 inline-flex items-center gap-1 rounded-full bg-destructive/10 px-2 py-0.5 text-xs font-medium text-destructive"
                          >
                            <AlertTriangle
                              className="size-3"
                              aria-hidden="true"
                            />
                            High failure rate
                          </span>
                        )
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

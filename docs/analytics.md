# Instructor Analytics — Metrics Reference

The definitive reference for every metric on the instructor analytics
dashboards. Source of truth for the *definitions* is the PRD
(`docs/prd-analytics-feature.md`); this document records how those definitions
are computed so future work doesn't re-litigate them. **Change the PRD first,
then update the service and this file.**

- **Routes**: `/instructor/analytics` (overview), `/instructor/:courseId/analytics` (drill-down).
- **Computation**: all metrics live in `app/services/analyticsService.ts`, one
  aggregate SQL query per dashboard section (no N+1); route loaders stay thin.
- **Aggregation strategy**: on-the-fly indexed SQLite aggregates. No
  pre-aggregated tables, materialized views, or caching — see
  [Scale-up path](#scale-up-path).
- **Time zone**: all date bucketing uses SQLite `strftime`/`date` in **UTC**,
  matched by UTC formatting in the chart components, so a bucket never shifts
  across the viewer's midnight.

## Money

- **Gross earnings** = `SUM(purchases.pricePaid)` in cents, dated by purchase
  date (`purchases.createdAt`). "Gross" = before any fees.
- A **team purchase** is one `purchases` row against many coupon-redeemed
  `enrollments`; earnings count the single purchase row, enrollments count
  every seat. Free-course enrollments add to enrollment counts with zero
  earnings.

## Overview KPIs (`getOverviewStats`)

Scoped to the resolved date range (period KPIs follow the range selector).

| Metric | Definition |
| --- | --- |
| Total enrollments | `COUNT(enrollments)` across the instructor's courses, within the period. |
| Gross earnings | `SUM(purchases.pricePaid)` across owned courses, within the period. |
| Avg. revenue / student (**blended**) | Gross earnings ÷ **all** enrollments (paid, coupon, and free). Labeled "blended" in the UI. `null` when there are no enrollments to average over — rendered as "—", never a fake `$0`. |
| Course count | `COUNT` of owned courses, **all-time** — a course doesn't stop existing when the period narrows; only its period activity goes to zero. |

Courses of every status (published, **draft**, **archived**) are included; their
revenue counts toward totals and they carry a status badge.

## Course comparison table (`getCourseStats`)

Structural — **all-time**, never range-filtered. One aggregate query;
enrollments and purchases are grouped in subqueries before joining so the two
one-to-many relations cannot fan out each other's sums.

| Column | Definition |
| --- | --- |
| Enrollments | All-time `COUNT(enrollments)` for the course. |
| Earnings | All-time `SUM(purchases.pricePaid)`. |
| Completion rate | Enrollments with `completedAt` set ÷ total enrollments. `null` (→ "—") when the course has no enrollments: "no data" ≠ "0% completion". |

Rows are ordered by earnings desc, then title — the head of the list doubles as
the **top-courses-by-revenue** ranking.

## Trend series (`getEnrollmentTrend`, `getRevenueTrend`, `getCompletionTrend`)

Range-scoped, bucketed by the range-derived granularity. `value` units:
enrollment trend = enrollment count (dated by `enrolledAt`); revenue trend =
cents (`SUM(pricePaid)`, dated by `createdAt`); completion trend = completions
(dated by `completedAt`, **not** enrollment date).

- **Bucket keys (UTC)**: daily → `YYYY-MM-DD`; weekly → that week's **Monday**
  as `YYYY-MM-DD` (weeks run Mon–Sun); monthly → `YYYY-MM`. Lexicographic order
  = chronological order within one granularity.
- **Zero-fill**: sparse SQL buckets are expanded into a gapless series so a
  chart never draws a straight line across a silent period. Span = window start
  (or first data point, for all-time) through `until` or the last data point,
  whichever is later.
- **Empty window** → empty series (`[]`), so the chart renders its empty state
  rather than a flat zero line.

## Course funnel (`getCourseFunnel`)

Structural — **all-time per course**.

| Stage | Definition |
| --- | --- |
| Enrolled | All-time `COUNT(enrollments)` on the course. |
| Started | Enrolled students with **≥1 `lessonProgress` row** on the course's lessons. A progress row only exists once a student opens or completes a lesson. |
| Completed | Enrollments with `completedAt` set (same basis as completion rate). |

The started-users subquery is `DISTINCT` per user, so its join matches at most
one row per enrollment and cannot inflate counts.

## Lesson drop-off funnel (`getLessonFunnel`)

Structural — **all-time per course**. Lessons listed in course order (module
position, then lesson position).

- **Completed(N)** = distinct **enrolled** students who completed lesson N. Each
  lesson counts independently: a student's stop point is their *furthest*
  completed lesson, so skipping a lesson doesn't erase credit for later ones.
- **Retention(N)** = `completed(N) ÷ completed(N−1)`. `null` for the first
  lesson and whenever the previous step has zero completions ("no one left to
  retain" ≠ 0% retention).
- **Biggest drop-off**: the single worst retention step; ties go to the
  earliest step. A lossless funnel (no step loses anyone) flags nothing.
- **Low-retention insight** (callout, not just a row): retention ≤
  `LOW_RETENTION_THRESHOLD` **AND** previous step ≥
  `MIN_PRIOR_COMPLETIONS_FOR_INSIGHT` completions.

### Constants (`app/services/analyticsService.ts`)

| Constant | Value | Meaning |
| --- | --- | --- |
| `LOW_RETENTION_THRESHOLD` | `0.5` | Flag a step that retains ≤ 50% of the prior lesson's finishers. |
| `MIN_PRIOR_COMPLETIONS_FOR_INSIGHT` | `5` | Minimum prior-lesson completions before a drop is signal, not noise. |

## Quiz performance (`getQuizPerformance`)

Structural — **all-time per course**. **Basis: each student's *first* attempt
per quiz** — the numbers measure how well the lesson taught, not how persistent
students are at retrying. First attempts are selected with a window over
`(quizId, userId)` ordered by `attemptedAt`, the row id breaking ties.

Unlike the funnels, quiz metrics are **not** scoped to current enrollment — the
PRD defines the basis as "each student's first attempt", full stop.

- **Average score**: scores are stored as a `0–1` fraction (displayed as a
  percentage). Averages are **attempt-weighted** means of first-attempt scores,
  computed at four altitudes: course, module, lesson, and quiz. `null` (→ "—")
  when nothing has been attempted at that altitude.
- **Score distribution**: first-attempt scores tallied into **ten deciles** —
  bucket `i` covers `[i/10, (i+1)/10)`, with a perfect `1.0` folded into the
  last bucket. Always length 10. Surfaced as a histogram at the course level;
  per-quiz distributions are also computed.
- **High-failure flag**: first-attempt **fail rate ≥ 50% AND ≥ 5 students**
  attempted (both bounds inclusive). Flagged quizzes surface as callouts and
  badges; quizzes below the sample-size floor are never flagged, however badly
  they read. Fail rate = first attempts that did not pass ÷ first attempts.
- **Empty states**: a course with no quizzes, and a course whose quizzes have no
  attempts, each render a distinct non-broken empty state. A never-attempted
  quiz still appears in the breakdown with `null` stats.

### Constants (`app/services/analyticsService.ts`)

| Constant | Value | Meaning |
| --- | --- | --- |
| `HIGH_FAILURE_RATE_THRESHOLD` | `0.5` | Flag at ≥ 50% first-attempt fail rate. |
| `MIN_ATTEMPTS_FOR_FAILURE_FLAG` | `5` | Minimum first-attempt takers before a fail rate is signal. |
| `DISTRIBUTION_BUCKET_COUNT` | `10` | Score-distribution deciles. |

## Date ranges & granularity (`app/lib/date-range.ts`)

The `?range=` URL param is the source of truth (shareable, bookmarkable,
survives reload). The helper is pure — callers pass `now`.

| Preset | Window | Granularity |
| --- | --- | --- |
| `7d` | Last 7 days | daily |
| `30d` | Last 30 days | daily |
| `90d` | Last 90 days | weekly |
| `12m` | Last 12 months | monthly |
| `all` | All time (`since = null`) | monthly |

- **Default** is `30d`. An absent or **invalid** param falls back to the
  default (and the selector highlights it).
- Granularity is **derived** from the preset, never chosen independently.
- The range filters **trend charts and period KPIs**. Structural metrics — the
  comparison table, both funnels, and all quiz stats — stay all-time.

## Schema & indexes

No analytics-specific tables. One index migration covers the hot paths:

| Table | Index |
| --- | --- |
| `enrollments` | `(courseId, enrolledAt)` |
| `purchases` | `(courseId, createdAt)` |
| `lessonProgress` | `(lessonId, status)` |
| `quizAttempts` | `(quizId, userId, attemptedAt)` |

## Scale-up path

Today every dashboard load runs live indexed aggregates over the operational
tables. This is correct and fast at the current scale, and keeps the metric
definitions in exactly one place (the service). When aggregate query latency
becomes the bottleneck, the migration path, in order of increasing effort:

1. **Materialized summary tables** (e.g. per-course daily rollups of
   enrollments, revenue, completions) refreshed on write or on a schedule;
   trend and KPI queries read the rollups, drill-downs still hit live tables.
2. **Read-through cache** keyed by `(instructorId | courseId, range)` with
   short TTL, invalidated on the relevant writes.
3. **Separate analytics store / warehouse** fed by CDC if reporting load starts
   competing with operational load.

Whatever the mechanism, the metric definitions above stay authoritative — a
rollup that disagrees with them is a bug in the rollup.

## Testing

`analyticsService` and the date-range helper are the testable boundary, with a
fresh in-memory DB per test (`vi.mock("~/db")` before importing the service).
Route loaders are not unit-tested; the UI is verified by typecheck and manual
run. Edge cases explicitly covered: zero-enrollment course; enrolled-but-never-
started students; team purchase (one purchase, many coupon enrollments);
free-course enrollments; multiple quiz attempts per student (first-attempt
selection); flag threshold boundaries; quiz below the minimum sample size;
empty date ranges.

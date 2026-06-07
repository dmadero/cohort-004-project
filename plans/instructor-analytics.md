# Plan: Instructor Analytics Dashboard

> Source PRD: `docs/prd-analytics-feature.md` (2026-06-05, supersedes issue #13 draft)

## Architectural decisions

Durable decisions that apply across all phases:

- **Routes**: `/instructor/analytics` (overview) and `/instructor/:courseId/analytics` (per-course drill-down), registered in `app/routes.ts` following the existing instructor route conventions: loader auth (session → 401, instructor role → 403, drill-down ownership → 403), `HydrateFallback` skeletons, `ErrorBoundary`.
- **Schema**: no new tables. One index migration on the analytics hot paths: enrollments (courseId, enrolledAt), purchases (courseId, createdAt), lessonProgress (lessonId, status), quizAttempts (quizId, userId, attemptedAt).
- **Key models**:
  - `analyticsService` (new, deep) — all metric computation behind a small interface; one aggregate SQL query per dashboard section; route loaders stay thin. All functions take an options object including the resolved date range.
  - Date-range helper (new, pure) — `?range=` param → `{ since, granularity }`. Presets `7d|30d|90d|12m|all`, default `30d`; granularity derives from range (7d/30d → daily, 90d → weekly, 12m/all → monthly).
  - Chart components (new) — thin wrappers over shadcn chart primitives + Recharts (line/area trend, bar/histogram, funnel), shared by both routes.
- **Metric definitions** (from PRD, recorded in `docs/analytics.md` in the final phase):
  - Gross earnings = `SUM(purchases.pricePaid)`, dated by purchase date.
  - ARPS = gross earnings ÷ all enrollments (blended; labeled as such).
  - Completion rate = enrollments with `completedAt` set ÷ total enrollments.
  - Started = enrolled student with ≥1 lessonProgress row on the course's lessons.
  - Quiz metrics = each student's **first attempt** per quiz.
  - High-failure flag = first-attempt fail rate ≥ 50% AND ≥ 5 students attempted (constants in the service).
  - Drop-off funnel = per lesson in course order, count of enrolled students who completed it; Retention(N) = completed(N) ÷ completed(N−1).
- **Time filtering**: range filters trend charts and period KPIs; structural metrics (funnel, quiz stats) are all-time per course. Bucketing via SQLite `strftime` in UTC.
- **Aggregation**: on-the-fly indexed SQLite aggregates — no pre-aggregated tables, views, or caching (documented as the future scale-up path).
- **Course scope**: all courses the instructor owns, including drafts and archived, with the existing status badge treatment.
- **Dependency**: `recharts` (via shadcn chart components) is the only new package, added in Phase 4.
- **Testing**: `analyticsService` and the date-range helper are the testable boundary, using the existing pattern (fresh in-memory test DB per test, `vi.mock("~/db")` before importing the service — as in `progressService.test.ts`). Route loaders are not unit tested; UI verified by typecheck and manual run.

---

## Phase 1: Overview route skeleton + first KPI

**User stories**: 2, 26, 27, 29, 30 (overview half)

### What to build

The tracer bullet: a working `/instructor/analytics` page reachable from the instructor navigation, protected by the standard loader auth (401 unauthenticated, 403 non-instructor), showing one real number — total enrollments across all the instructor's courses — computed by a new `analyticsService`. Includes the index migration, a loading skeleton, an error boundary, and an empty state for an instructor with no courses. Establishes every layer the remaining phases extend.

### Acceptance criteria

- [ ] `/instructor/analytics` renders for an instructor and shows their all-time total enrollments
- [ ] Unauthenticated → 401; authenticated non-instructor → 403
- [ ] Analytics link appears in the instructor navigation
- [ ] Index migration applied for the four hot paths
- [ ] Loading skeleton (`HydrateFallback`) and error state (`ErrorBoundary`) render
- [ ] Instructor with zero courses sees a sensible empty state
- [ ] Service test: total enrollments correct against seeded data, including the zero-enrollment course case

---

## Phase 2: Overview KPIs + course comparison table

**User stories**: 1, 3, 5, 6, 8, 9, 12, 25

### What to build

The full overview content (all-time at this point): KPI cards for total enrollments, gross earnings, and blended average revenue per student (labeled as blended); a top-performing-courses ranking by revenue; and a per-course comparison table covering every owned course — enrollments, earnings, completion rate, and status badges for draft/archived courses.

### Acceptance criteria

- [ ] KPI cards show gross earnings (`SUM(pricePaid)`) and blended ARPS (earnings ÷ all enrollments)
- [ ] Comparison table lists every owned course with enrollments, earnings, completion rate (`completedAt`-based), and status badge
- [ ] Draft and archived courses appear with status visible; their revenue is included in totals
- [ ] Top courses ranked by revenue
- [ ] Service tests: per-course stats correct against seeded data — team purchase (one purchase row, many coupon enrollments), free-course enrollments, zero-enrollment course
- [ ] Courses with no data render empty values, not broken UI

---

## Phase 3: Time-range filtering

**User stories**: 10, 11

### What to build

The pure date-range helper translating `?range=7d|30d|90d|12m|all` into `{ since, granularity }`, with `30d` as the default. A range selector on the overview writes the param to the URL (shareable/bookmarkable); period KPIs (enrollments, earnings, ARPS) become range-scoped while the comparison table's structural columns stay all-time.

### Acceptance criteria

- [ ] Range selector updates the URL and survives reload/sharing
- [ ] Default is `30d` when the param is absent; invalid values fall back to the default
- [ ] Period KPIs reflect the selected range
- [ ] Unit tests cover every preset, the default, and granularity derivation (7d/30d → daily, 90d → weekly, 12m/all → monthly)
- [ ] Empty ranges (no data in window) render zeros, not errors

---

## Phase 4: Trend charts

**User stories**: 4, 7

### What to build

Add `recharts` and the shared chart wrapper components. The overview gains enrollment and revenue trend charts, bucketed by the range-derived granularity via UTC `strftime`, responding to the existing range selector.

### Acceptance criteria

- [ ] Enrollment trend and revenue trend charts render on the overview, bucketed per the selected range's granularity
- [ ] Charts re-query when the range changes
- [ ] Service tests: trend series correct for a known seeded dataset at each granularity; empty range yields an empty series
- [ ] Chart empty state for courses/ranges with no data
- [ ] `recharts` is the only new package added

---

## Phase 5: Course drill-down — funnel + completion trend

**User stories**: 13, 14, 15, 30 (drill-down half)

### What to build

The second route, `/instructor/:courseId/analytics`, reachable by clicking a course in the overview table. Ownership enforced (403 for courses the instructor doesn't own). Shows the enrolled → started → completed funnel (started = ≥1 lessonProgress row) and a completion trend chart over time, reusing the chart components and range selector. Carries its own skeleton, error boundary, and empty state.

### Acceptance criteria

- [ ] Clicking a course in the overview navigates to its drill-down
- [ ] Requesting another instructor's course → 403
- [ ] Funnel distinguishes never-started from started-but-unfinished students
- [ ] Completion trend chart respects the URL range
- [ ] Service tests: funnel counts correct for seeded data including enrolled-but-never-started students
- [ ] Skeleton, error, and fresh-course empty states render

---

## Phase 6: Lesson drop-off funnel

**User stories**: 16, 17, 18, 19

### What to build

On the drill-down: a lesson-by-lesson funnel in course order (module position, then lesson position) showing how many enrolled students completed each lesson, with lesson-to-lesson retention rates. The single worst retention step is visually highlighted, and lessons with unusually low completion are surfaced as actionable insights. All-time per course (structural metric).

### Acceptance criteria

- [ ] Funnel lists lessons in course order with completion counts and Retention(N) = completed(N) ÷ completed(N−1)
- [ ] Biggest drop-off (worst retention step) is highlighted
- [ ] Low-completion lessons surfaced as insight callouts, not just rows
- [ ] Service tests: funnel and retention correct for seeded data; a student's stop point = furthest completed lesson
- [ ] Course with no lesson progress renders an empty state

---

## Phase 7: Quiz performance

**User stories**: 20, 21, 22, 23, 24

### What to build

The quiz section of the drill-down, all metrics based on each student's first attempt per quiz: average scores at course, module, and lesson level; score distribution histograms (reusing the chart components); and high-failure flags (first-attempt fail rate ≥ 50% AND ≥ 5 students, constants in the service). All-time per course.

### Acceptance criteria

- [x] Average first-attempt scores shown per course, per module, and per lesson
- [x] Score distribution histogram renders per quiz/course
- [x] Quizzes meeting the failure-flag thresholds are visibly flagged; below-sample-size quizzes are not
- [x] Service tests: first-attempt selection with multiple attempts per student; flag threshold boundaries; quiz below minimum sample size
- [x] Courses without quizzes render an empty state, not a broken section

---

## Phase 8: Polish + docs

**User stories**: 31

### What to build

A responsive pass across both views (KPI cards stack, tables scroll or collapse, charts resize on small screens), and the metrics reference document `docs/analytics.md` recording every formula from the architectural decisions so future sessions don't re-litigate them.

### Acceptance criteria

- [ ] Both routes are usable on small screens (no horizontal overflow, charts resize)
- [ ] `docs/analytics.md` documents every metric definition, the flag constants, range/granularity rules, and the pre-aggregation scale-up path
- [ ] Full test suite and typecheck pass

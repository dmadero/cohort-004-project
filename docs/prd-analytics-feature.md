# PRD: Instructor Analytics Dashboard

> **Status:** ready-for-agent
> **Supersedes** the 2026-06-03 PRD draft in [ai-hero-dev/cohort-004-project#13](https://github.com/ai-hero-dev/cohort-004-project/issues/13). Re-grilled 2026-06-05; scope widened (trends/charts, score distributions, drop-off retention, ARPS) and the completion-rate definition changed — see Implementation Decisions.

## Problem Statement

Instructors have no visibility into how their courses are performing. After publishing a course, an instructor cannot tell how many students enrolled, how much money the course made, whether students actually finish the content, where they stop, or which quizzes they fail. Without this data, instructors cannot make informed decisions about pricing, content improvement, or where to focus their energy — they are flying blind on everything except the raw course list.

## Solution

An instructor-only analytics dashboard with two levels of detail:

1. **Analytics Overview** (`/instructor/analytics`) — cross-course KPIs (total enrollments, gross earnings, blended average revenue per student, top-performing courses) with trend charts for enrollment growth and revenue, plus a per-course comparison table covering every course the instructor owns.
2. **Course Analytics** (`/instructor/:courseId/analytics`) — a drill-down for one course: the enrolled → started → completed funnel, completion trends, a lesson-by-lesson drop-off funnel with retention rates, and quiz performance (averages, score distributions, flagged high-failure quizzes).

All views are filterable by a preset time range carried in the URL. Access is strictly scoped: an instructor can only view analytics for courses where they are the listed instructor.

## User Stories

1. As an instructor, I want a single analytics overview of all my courses, so that I can compare their performance at a glance.
2. As an instructor, I want to see total enrollments across all my courses, so that I can gauge my overall reach.
3. As an instructor, I want to see enrollment counts per course, so that I can tell which courses attract students.
4. As an instructor, I want an enrollment trend chart over time, so that I can see whether my audience is growing.
5. As an instructor, I want to see my total gross earnings, so that I know what my teaching has made overall.
6. As an instructor, I want to see earnings broken down by course, so that I can identify which courses earn the most.
7. As an instructor, I want a revenue trend chart over time, so that I can spot growth or decline in income.
8. As an instructor, I want to see average revenue per student, so that I can reason about pricing and the value of each enrollment.
9. As an instructor, I want my top-performing courses ranked by revenue, so that I know where to focus my energy.
10. As an instructor, I want to filter all analytics by a preset time range, so that I can compare recent performance against the long term.
11. As an instructor, I want the selected time range reflected in the URL, so that I can share or bookmark a specific view.
12. As an instructor, I want to see the completion rate for each course, so that I can tell which courses students finish versus abandon.
13. As an instructor, I want to see how many enrolled students never started at all, separately from those who started but didn't finish, so that I can distinguish a marketing problem from a content problem.
14. As an instructor, I want a completion trend over time, so that I can see whether content changes improved finish rates.
15. As an instructor, I want to click into any course from the overview, so that I can investigate its detailed analytics.
16. As an instructor, I want a lesson-by-lesson drop-off funnel in course order, so that I can see exactly how far students get.
17. As an instructor, I want lesson-to-lesson retention rates, so that I can quantify how many students each lesson loses.
18. As an instructor, I want the single biggest drop-off point highlighted, so that I know which lesson to fix first without digging through raw data.
19. As an instructor, I want lessons with unusually low completion surfaced as actionable insights, so that the dashboard tells me where to act rather than just showing numbers.
20. As an instructor, I want average quiz scores per course, so that I can judge learning outcomes at a high level.
21. As an instructor, I want average quiz scores per lesson and module, so that I can locate weak teaching at the right altitude.
22. As an instructor, I want quiz score distributions visualized, so that I can distinguish "everyone scores 70" from "half score 100, half score 40".
23. As an instructor, I want quizzes with unusually high first-attempt failure rates flagged, so that I can find lessons that fail to teach the material.
24. As an instructor, I want quiz metrics based on first attempts, so that the numbers measure how well my lesson taught — not how persistent students are at retrying.
25. As an instructor, I want draft and archived courses included with their status visible, so that historical revenue never silently disappears from my totals.
26. As an instructor, I want to reach analytics from my existing instructor area, so that I don't have to remember a separate URL.
27. As an instructor, I want loading skeletons while analytics load, so that the page never appears broken.
28. As an instructor, I want sensible empty states for new courses with no data, so that a fresh course doesn't render a wall of broken charts.
29. As an instructor, I want clear error states when something fails, so that I know whether to retry or report a problem.
30. As an instructor, I want to be blocked (403) from viewing analytics for courses I don't own, so that my data stays private from other instructors.
31. As an instructor, I want the dashboard to work on smaller screens, so that I can check performance from any device.

## Implementation Decisions

### Modules

- **`analyticsService`** (new, deep) — encapsulates ALL metric computation behind a small interface; route loaders stay thin. One aggregate SQL query per dashboard section (no N+1). Exposes roughly: overview KPIs + per-course stats for an instructor, enrollment/revenue/completion trend series, course funnel (enrolled/started/completed), lesson drop-off funnel with retention, and quiz performance (per-course/module/lesson averages, distribution buckets, flagged quizzes). All functions take an options object (project convention for multi-parameter functions of the same type) including the resolved date range.
- **Date-range helper** (new, pure) — translates the `?range=` URL param into `{ since, granularity }`. Pure function, testable in isolation.
- **Chart components** (new) — thin wrappers over shadcn chart primitives + Recharts: line/area trend, bar/histogram, funnel. Reused by both routes.
- **Two new routes** — overview (`/instructor/analytics`) and per-course drill-down (`/instructor/:courseId/analytics`), following the existing instructor route conventions (loader auth, `HydrateFallback` skeletons, `ErrorBoundary`).
- **Index migration** — indexes on the analytics hot paths: enrollments (courseId, enrolledAt), purchases (courseId, createdAt), lessonProgress (lessonId, status), quizAttempts (quizId, userId, attemptedAt). No other schema changes.

### Metric definitions

- **Gross earnings** = `SUM(purchases.pricePaid)` over the instructor's courses, dated by purchase date. No platform fee, refunds, or revenue split exist in the system. Team purchases count fully at purchase time; coupon redemptions carry no money.
- **Average revenue per student** = gross earnings ÷ **all** enrollments (including coupon-redeemed and free students). Labeled as a blended metric in the UI.
- **Completion rate** = enrollments with `completedAt` set ÷ total enrollments. **Supersedes the previous draft's lessonProgress-derived definition**: `completedAt` is maintained by the enrollment service, and it is the only definition that yields completion *dates*, which the required completion-trend chart needs. (The previous draft cited ADR-0001 for the old definition; no such ADR exists in the repository.)
- **Started** = enrolled student with ≥1 lessonProgress row on the course's lessons. Shown as the middle tier of enrolled → started → completed.
- **Quiz metrics basis** = each student's **first attempt** per quiz, for averages, distributions, and failure rates.
- **High-failure flag** = first-attempt fail rate ≥ 50% AND ≥ 5 students attempted. Both constants live in the analytics service.
- **Drop-off funnel** = for each lesson in course order (module position, then lesson position): count of enrolled students who completed it. Retention(N) = completed(N) ÷ completed(N−1). Biggest drop-off = worst retention step. A student's stop point = their furthest completed lesson.

### Time filtering

- URL param `range=7d|30d|90d|12m|all`, default `30d`.
- Granularity derives from range: 7d/30d → daily, 90d → weekly, 12m/all → monthly. No independent granularity control.
- Bucketing via SQLite `strftime` in UTC (all timestamps are ISO-UTC strings).
- Range filters trend charts and period KPIs; structural metrics (funnel, quiz stats) are all-time per course.

### Architecture

- **On-the-fly aggregation** — no pre-aggregated tables, no views, no caching. At realistic scale for this platform, indexed SQLite aggregates are sub-millisecond and always fresh. Pre-aggregation is documented as the future scale-up path, not built.
- **Access control** — both loaders verify session → instructor role → (for drill-down) `course.instructorId === currentUserId`, throwing 401/403 exactly like the existing instructor routes. Admin bypass intentionally not included.
- **Course scope** — every course the instructor owns appears, including drafts and archived, with the existing status badge treatment.
- **New dependency** — `recharts` (via shadcn chart components). The only new package.

## Testing Decisions

A good test asserts external behavior — the computed result returned for a known seeded dataset — never the SQL or internal mechanics.

- **`analyticsService`** — full coverage of every exported function against a seeded test database. Edge cases explicitly covered: course with zero enrollments; enrolled-but-never-started students; team purchase (one purchase row, many coupon enrollments); free-course enrollments; students with multiple quiz attempts (first-attempt selection); quiz below the flag's minimum sample size; empty date ranges.
- **Date-range helper** — pure unit tests for every preset and the default.
- **Prior art**: the existing service test pattern (fresh test DB per test via `beforeEach`, `vi.mock` of the db module before importing the service under test — as in the enrollment and progress service tests).
- **Route loaders are not unit tested** — the service is the testable boundary; loader auth is ten proven lines copied from the existing instructor routes. UI verified by typecheck and manual run.

## Out of Scope

- **Net earnings / payouts / refunds** — no platform fee or refund model exists; gross revenue only.
- **Pre-aggregated analytics tables or caching** — documented as the scale-up path; not built now.
- **Stall detection ("inactive for X days")** — requires adding timestamps to lessonProgress; data would only accrue going forward. Future iteration.
- **Video-level drop-off** — videoWatchEvents is not used; drop-off is lesson-level only.
- **Admin override** — admins cannot view another instructor's analytics.
- **Custom date pickers** — presets only; a custom range is a natural fast-follow.
- **Per-seat attribution of team-purchase revenue** — revenue lands at purchase time, undivided.
- **CSV export, notifications, email digests.**
- **Student-level drill-down** — the existing Student Roster page serves that need.

## Further Notes

- A metrics reference document (`docs/analytics.md`) ships with the implementation, recording each formula above so future sessions don't re-litigate them.
- Future growth vectors (unprioritized): revenue by country (purchases already store country), coupon redemption-rate analytics, PPP impact analysis; video-level drop-off from videoWatchEvents; lessonProgress timestamps enabling stall detection and cohort analysis.

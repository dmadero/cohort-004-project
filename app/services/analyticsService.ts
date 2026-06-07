import {
  and,
  asc,
  desc,
  eq,
  gte,
  isNotNull,
  sql,
  type AnyColumn,
  type SQL,
} from "drizzle-orm";
import { db } from "~/db";
import {
  courses,
  enrollments,
  lessonProgress,
  LessonProgressStatus,
  lessons,
  modules,
  purchases,
  quizAttempts,
  quizzes,
} from "~/db/schema";
import type { RangeGranularity } from "~/lib/date-range";

// ─── Analytics Service ───
// All instructor-facing metric computation lives here, one aggregate query per
// dashboard section, so route loaders stay thin. Metric definitions are fixed
// by the PRD (docs/prd-analytics-feature.md); record changes there first.

export interface OverviewStats {
  /**
   * Courses the instructor owns, regardless of status (draft/archived
   * included). Always all-time — a course doesn't stop existing when the
   * period narrows; only its period activity goes to zero.
   */
  courseCount: number;
  /** Enrollments within the requested period across every owned course. */
  totalEnrollments: number;
  /**
   * Gross earnings in cents within the requested period:
   * SUM(purchases.pricePaid) over owned courses, dated by purchase date.
   */
  grossEarningsCents: number;
  /**
   * Blended average revenue per student in cents — gross earnings ÷ ALL
   * enrollments, including coupon-redeemed and free ones (PRD definition;
   * label it "blended" in the UI). Null when there is no enrollment to
   * average over, so callers render an empty value instead of a fake zero.
   */
  avgRevenuePerStudentCents: number | null;
}

export interface CourseStats {
  courseId: number;
  title: string;
  status: string;
  /** All-time enrollments on this course. */
  enrollmentCount: number;
  /** All-time gross earnings in cents: SUM(purchases.pricePaid) for this course. */
  grossEarningsCents: number;
  /**
   * Fraction (0–1) of enrollments with `completedAt` set. Null when the
   * course has no enrollments — "no data" is not the same as 0% completion.
   */
  completionRate: number | null;
}

/**
 * Cross-course overview KPIs for one instructor, scoped to the resolved date
 * range (PRD: period KPIs follow the range; the comparison table from
 * `getCourseStats` stays all-time). An instructor with no courses — or no
 * activity in the window — gets zeros, not an error.
 */
export function getOverviewStats(opts: {
  instructorId: number;
  /** Inclusive ISO-UTC lower bound for the period KPIs; null = all-time. */
  since: string | null;
}): OverviewStats {
  // The period filter applies inside the grouped subqueries; the outer query
  // over courses keeps courseCount all-time even when the window is empty.
  const enrollmentStats = db
    .select({
      courseId: enrollments.courseId,
      enrollmentCount: sql<number>`count(*)`.as("enrollment_count"),
    })
    .from(enrollments)
    .where(opts.since ? gte(enrollments.enrolledAt, opts.since) : undefined)
    .groupBy(enrollments.courseId)
    .as("enrollment_stats");

  const purchaseStats = db
    .select({
      courseId: purchases.courseId,
      grossEarningsCents: sql<number>`sum(${purchases.pricePaid})`.as(
        "gross_earnings_cents"
      ),
    })
    .from(purchases)
    .where(opts.since ? gte(purchases.createdAt, opts.since) : undefined)
    .groupBy(purchases.courseId)
    .as("purchase_stats");

  const totals = db
    .select({
      courseCount: sql<number>`count(*)`,
      totalEnrollments: sql<number>`coalesce(sum(${enrollmentStats.enrollmentCount}), 0)`,
      grossEarningsCents: sql<number>`coalesce(sum(${purchaseStats.grossEarningsCents}), 0)`,
    })
    .from(courses)
    .leftJoin(enrollmentStats, eq(enrollmentStats.courseId, courses.id))
    .leftJoin(purchaseStats, eq(purchaseStats.courseId, courses.id))
    .where(eq(courses.instructorId, opts.instructorId))
    .get();

  // An aggregate without GROUP BY always yields exactly one row.
  const { courseCount, totalEnrollments, grossEarningsCents } = totals!;

  return {
    courseCount,
    totalEnrollments,
    grossEarningsCents,
    avgRevenuePerStudentCents:
      totalEnrollments > 0
        ? Math.round(grossEarningsCents / totalEnrollments)
        : null,
  };
}

/**
 * Per-course comparison stats for every course the instructor owns (any
 * status), ordered by gross earnings descending then title — the same order
 * doubles as the top-courses-by-revenue ranking. One aggregate query:
 * enrollments and purchases are grouped in subqueries before joining, so the
 * two one-to-many relations cannot fan out each other's sums.
 */
export function getCourseStats(opts: { instructorId: number }): CourseStats[] {
  const enrollmentStats = db
    .select({
      courseId: enrollments.courseId,
      enrollmentCount: sql<number>`count(*)`.as("enrollment_count"),
      // count(col) skips NULLs, so this counts completed enrollments only.
      completedCount: sql<number>`count(${enrollments.completedAt})`.as(
        "completed_count"
      ),
    })
    .from(enrollments)
    .groupBy(enrollments.courseId)
    .as("enrollment_stats");

  const purchaseStats = db
    .select({
      courseId: purchases.courseId,
      grossEarningsCents: sql<number>`sum(${purchases.pricePaid})`.as(
        "gross_earnings_cents"
      ),
    })
    .from(purchases)
    .groupBy(purchases.courseId)
    .as("purchase_stats");

  const rows = db
    .select({
      courseId: courses.id,
      title: courses.title,
      status: courses.status,
      enrollmentCount: sql<number>`coalesce(${enrollmentStats.enrollmentCount}, 0)`,
      completedCount: sql<number>`coalesce(${enrollmentStats.completedCount}, 0)`,
      grossEarningsCents: sql<number>`coalesce(${purchaseStats.grossEarningsCents}, 0)`,
    })
    .from(courses)
    .leftJoin(enrollmentStats, eq(enrollmentStats.courseId, courses.id))
    .leftJoin(purchaseStats, eq(purchaseStats.courseId, courses.id))
    .where(eq(courses.instructorId, opts.instructorId))
    .orderBy(
      desc(sql`coalesce(${purchaseStats.grossEarningsCents}, 0)`),
      asc(courses.title)
    )
    .all();

  return rows.map(({ completedCount, ...row }) => ({
    ...row,
    completionRate:
      row.enrollmentCount > 0 ? completedCount / row.enrollmentCount : null,
  }));
}

// ─── Trend series ───

export interface TrendPoint {
  /**
   * Bucket key, UTC: daily → "YYYY-MM-DD", weekly → the week's Monday as
   * "YYYY-MM-DD", monthly → "YYYY-MM". Lexicographic order = chronological
   * order within one granularity.
   */
  bucket: string;
  /** The metric for this bucket — see the producing function for its unit. */
  value: number;
}

interface TrendWindow {
  /** Inclusive ISO-UTC lower bound, or null for all-time. */
  since: string | null;
  /**
   * ISO-UTC end of the window (the loader's "now"). Only used to zero-fill
   * trailing empty buckets — rows are never filtered by it.
   */
  until: string;
  granularity: RangeGranularity;
}

/** Window for instructor-wide trends, spanning every course they own. */
export interface TrendOptions extends TrendWindow {
  instructorId: number;
}

/** Window for single-course trends on the drill-down view. */
export interface CourseTrendOptions extends TrendWindow {
  courseId: number;
}

/**
 * SQLite bucket expression for an ISO-UTC timestamp column. Weekly buckets
 * run Monday–Sunday: 'weekday 0' advances to the next Sunday (or stays on
 * one), so minus 6 days lands on that week's Monday.
 */
function bucketExpr(opts: {
  column: AnyColumn;
  granularity: RangeGranularity;
}): SQL<string> {
  switch (opts.granularity) {
    case "daily":
      return sql<string>`date(${opts.column})`;
    case "weekly":
      return sql<string>`date(${opts.column}, 'weekday 0', '-6 days')`;
    case "monthly":
      return sql<string>`strftime('%Y-%m', ${opts.column})`;
  }
}

/** JS twin of `bucketExpr`, used to zero-fill buckets SQL never saw. */
function bucketKeyFor(opts: { iso: string; granularity: RangeGranularity }): string {
  if (opts.granularity === "monthly") return opts.iso.slice(0, 7);
  if (opts.granularity === "daily") return opts.iso.slice(0, 10);
  const date = new Date(opts.iso);
  // getUTCDay: 0 = Sunday … 6 = Saturday; rewind to the week's Monday.
  const daysSinceMonday = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - daysSinceMonday);
  return date.toISOString().slice(0, 10);
}

function nextBucketKey(opts: { bucket: string; granularity: RangeGranularity }): string {
  if (opts.granularity === "monthly") {
    const [year, month] = opts.bucket.split("-").map(Number);
    // `month` is 1-based, Date.UTC months are 0-based — passing it unshifted
    // is exactly "the first of the next month", overflow included.
    return new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 7);
  }
  const date = new Date(`${opts.bucket}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + (opts.granularity === "weekly" ? 7 : 1));
  return date.toISOString().slice(0, 10);
}

/**
 * Expand sparse SQL buckets into a gapless series so trend charts don't draw
 * a line straight across silent periods. Spans from the window start (or the
 * first data point, when all-time) through `until` or the last data point,
 * whichever is later. No data at all yields an empty series — the caller
 * renders an empty state, not a flat zero line.
 */
function zeroFill(opts: {
  rows: TrendPoint[];
  since: string | null;
  until: string;
  granularity: RangeGranularity;
}): TrendPoint[] {
  if (opts.rows.length === 0) return [];

  const valueByBucket = new Map(opts.rows.map((row) => [row.bucket, row.value]));
  const firstDataBucket = opts.rows[0].bucket;
  const lastDataBucket = opts.rows[opts.rows.length - 1].bucket;
  const start = opts.since
    ? bucketKeyFor({ iso: opts.since, granularity: opts.granularity })
    : firstDataBucket;
  const untilBucket = bucketKeyFor({ iso: opts.until, granularity: opts.granularity });
  const end = untilBucket > lastDataBucket ? untilBucket : lastDataBucket;

  const series: TrendPoint[] = [];
  for (
    let bucket = start;
    bucket <= end;
    bucket = nextBucketKey({ bucket, granularity: opts.granularity })
  ) {
    series.push({ bucket, value: valueByBucket.get(bucket) ?? 0 });
  }
  return series;
}

/**
 * Enrollment counts per time bucket across every course the instructor owns,
 * gapless within the window. `value` = number of enrollments, dated by
 * `enrolledAt`. Empty window → empty series.
 */
export function getEnrollmentTrend(opts: TrendOptions): TrendPoint[] {
  const bucket = bucketExpr({
    column: enrollments.enrolledAt,
    granularity: opts.granularity,
  });

  const rows = db
    .select({ bucket, value: sql<number>`count(*)` })
    .from(enrollments)
    .innerJoin(courses, eq(courses.id, enrollments.courseId))
    .where(
      and(
        eq(courses.instructorId, opts.instructorId),
        opts.since ? gte(enrollments.enrolledAt, opts.since) : undefined
      )
    )
    .groupBy(bucket)
    .orderBy(bucket)
    .all();

  return zeroFill({ rows, ...opts });
}

/**
 * Course completions per time bucket for one course, gapless within the
 * window. `value` = enrollments whose `completedAt` falls in the bucket, so
 * the range filters by completion date, not enrollment date. Empty window →
 * empty series.
 */
export function getCompletionTrend(opts: CourseTrendOptions): TrendPoint[] {
  const bucket = bucketExpr({
    column: enrollments.completedAt,
    granularity: opts.granularity,
  });

  const rows = db
    .select({ bucket, value: sql<number>`count(*)` })
    .from(enrollments)
    .where(
      and(
        eq(enrollments.courseId, opts.courseId),
        isNotNull(enrollments.completedAt),
        opts.since ? gte(enrollments.completedAt, opts.since) : undefined
      )
    )
    .groupBy(bucket)
    .orderBy(bucket)
    .all();

  return zeroFill({ rows, ...opts });
}

/**
 * Gross earnings per time bucket across every course the instructor owns,
 * gapless within the window. `value` = SUM(purchases.pricePaid) in cents,
 * dated by purchase date. Empty window → empty series.
 */
export function getRevenueTrend(opts: TrendOptions): TrendPoint[] {
  const bucket = bucketExpr({
    column: purchases.createdAt,
    granularity: opts.granularity,
  });

  const rows = db
    .select({ bucket, value: sql<number>`sum(${purchases.pricePaid})` })
    .from(purchases)
    .innerJoin(courses, eq(courses.id, purchases.courseId))
    .where(
      and(
        eq(courses.instructorId, opts.instructorId),
        opts.since ? gte(purchases.createdAt, opts.since) : undefined
      )
    )
    .groupBy(bucket)
    .orderBy(bucket)
    .all();

  return zeroFill({ rows, ...opts });
}

// ─── Course drill-down funnel ───

export interface CourseFunnel {
  /** All-time enrollments on the course. */
  enrolledCount: number;
  /**
   * Enrolled students with ≥1 lessonProgress row on this course's lessons
   * (the PRD's "started" definition). Progress rows only exist once a student
   * opens or completes a lesson, so row existence alone means activity.
   */
  startedCount: number;
  /** Enrollments with `completedAt` set — same definition as completion rate. */
  completedCount: number;
}

/**
 * Enrolled → started → completed funnel for one course. All-time: the PRD
 * classes the funnel as structural, exempt from range filtering. One
 * aggregate query — the started-users subquery is distinct per user, so its
 * left join matches at most one row per enrollment and cannot fan out the
 * counts. A course with no enrollments yields zeros, not an error.
 */
export function getCourseFunnel(opts: { courseId: number }): CourseFunnel {
  const startedUsers = db
    .selectDistinct({ userId: lessonProgress.userId })
    .from(lessonProgress)
    .innerJoin(lessons, eq(lessons.id, lessonProgress.lessonId))
    .innerJoin(modules, eq(modules.id, lessons.moduleId))
    .where(eq(modules.courseId, opts.courseId))
    .as("started_users");

  const funnel = db
    .select({
      enrolledCount: sql<number>`count(*)`,
      // count(col) skips NULLs: unmatched joins and never-completed rows.
      startedCount: sql<number>`count(${startedUsers.userId})`,
      completedCount: sql<number>`count(${enrollments.completedAt})`,
    })
    .from(enrollments)
    .leftJoin(startedUsers, eq(startedUsers.userId, enrollments.userId))
    .where(eq(enrollments.courseId, opts.courseId))
    .get();

  // An aggregate without GROUP BY always yields exactly one row.
  return funnel!;
}

// ─── Lesson drop-off funnel ───

/**
 * Insight thresholds, mirroring the quiz high-failure flag convention (PRD:
 * constants live in the service). A step is flagged when it loses at least
 * half the students who completed the previous lesson, and enough students
 * reached that point for the loss to be signal rather than noise.
 */
const LOW_RETENTION_THRESHOLD = 0.5;
const MIN_PRIOR_COMPLETIONS_FOR_INSIGHT = 5;

export interface LessonFunnelStep {
  lessonId: number;
  lessonTitle: string;
  moduleTitle: string;
  /**
   * Distinct enrolled students who completed this lesson, all-time (the PRD
   * classes the drop-off funnel as structural). A student's stop point is
   * their furthest completed lesson, so each lesson counts independently —
   * skipping a lesson doesn't erase credit for later ones.
   */
  completedCount: number;
  /**
   * Retention(N) = completed(N) ÷ completed(N−1). Null for the first lesson
   * and whenever the previous step has zero completions — "no one left to
   * retain" is not the same as 0% retention.
   */
  retentionRate: number | null;
  /**
   * The single worst retention step in the course. False everywhere when no
   * step actually loses students — a lossless funnel has nothing to fix.
   */
  isBiggestDropoff: boolean;
  /**
   * Retention at or below LOW_RETENTION_THRESHOLD with at least
   * MIN_PRIOR_COMPLETIONS_FOR_INSIGHT students completing the previous
   * lesson; surfaced as an actionable insight callout in the UI.
   */
  isLowRetention: boolean;
}

/**
 * Lesson-by-lesson drop-off funnel for one course, in course order (module
 * position, then lesson position). One aggregate query: completions are
 * grouped per lesson in a subquery before joining, and counted distinct per
 * user, so duplicate progress rows or double enrollments cannot inflate the
 * counts. A course with no lessons yields an empty array; lessons nobody
 * completed yield zero counts, not missing rows.
 */
export function getLessonFunnel(opts: { courseId: number }): LessonFunnelStep[] {
  const completionStats = db
    .select({
      lessonId: lessonProgress.lessonId,
      completedCount: sql<number>`count(distinct ${lessonProgress.userId})`.as(
        "completed_count"
      ),
    })
    .from(lessonProgress)
    // The enrollment join scopes counts to enrolled students, matching the
    // course funnel's treatment of progress from non-enrolled users.
    .innerJoin(
      enrollments,
      and(
        eq(enrollments.userId, lessonProgress.userId),
        eq(enrollments.courseId, opts.courseId)
      )
    )
    .where(eq(lessonProgress.status, LessonProgressStatus.Completed))
    .groupBy(lessonProgress.lessonId)
    .as("completion_stats");

  const rows = db
    .select({
      lessonId: lessons.id,
      lessonTitle: lessons.title,
      moduleTitle: modules.title,
      completedCount: sql<number>`coalesce(${completionStats.completedCount}, 0)`,
    })
    .from(lessons)
    .innerJoin(modules, eq(modules.id, lessons.moduleId))
    .leftJoin(completionStats, eq(completionStats.lessonId, lessons.id))
    .where(eq(modules.courseId, opts.courseId))
    .orderBy(asc(modules.position), asc(lessons.position))
    .all();

  return annotateLessonFunnel(rows);
}

/** Pure post-pass: derive retention and the two flags from ordered counts. */
function annotateLessonFunnel(
  rows: Array<Pick<LessonFunnelStep, "lessonId" | "lessonTitle" | "moduleTitle" | "completedCount">>
): LessonFunnelStep[] {
  const retentionRates = rows.map((row, index) => {
    if (index === 0) return null;
    const priorCompleted = rows[index - 1].completedCount;
    return priorCompleted > 0 ? row.completedCount / priorCompleted : null;
  });

  // Lowest retention wins; ties go to the earliest step, where the loss hits
  // first. Steps with retention ≥ 1 lose nobody, so they never qualify.
  let biggestDropoffIndex = -1;
  let worstRetention = 1;
  retentionRates.forEach((retentionRate, index) => {
    if (retentionRate !== null && retentionRate < worstRetention) {
      worstRetention = retentionRate;
      biggestDropoffIndex = index;
    }
  });

  return rows.map((row, index) => {
    const retentionRate = retentionRates[index];
    const priorCompleted = index > 0 ? rows[index - 1].completedCount : 0;
    return {
      ...row,
      retentionRate,
      isBiggestDropoff: index === biggestDropoffIndex,
      isLowRetention:
        retentionRate !== null &&
        retentionRate <= LOW_RETENTION_THRESHOLD &&
        priorCompleted >= MIN_PRIOR_COMPLETIONS_FOR_INSIGHT,
    };
  });
}

// ─── Quiz performance ───

/**
 * High-failure flag thresholds (PRD: constants live in the service). A quiz is
 * flagged when at least half its first-attempt takers failed AND enough
 * students attempted for that rate to be signal rather than noise. Both bounds
 * are inclusive, so a quiz exactly on either edge still qualifies.
 */
const HIGH_FAILURE_RATE_THRESHOLD = 0.5;
const MIN_ATTEMPTS_FOR_FAILURE_FLAG = 5;

/** Score distribution buckets: ten deciles spanning [0, 1]. */
const DISTRIBUTION_BUCKET_COUNT = 10;

export interface QuizScoreStats {
  quizId: number;
  quizTitle: string;
  lessonId: number;
  lessonTitle: string;
  /** Distinct students with a first attempt on this quiz; 0 when none. */
  studentCount: number;
  /**
   * Mean first-attempt score (0–1) across those students. Null when nobody has
   * attempted — "no data" is not a zero average.
   */
  avgScore: number | null;
  /**
   * Fraction (0–1) of first attempts that did not pass. Null when nobody has
   * attempted.
   */
  failRate: number | null;
  /**
   * PRD high-failure flag: failRate ≥ 0.5 AND studentCount ≥ 5. Quizzes below
   * the sample-size floor are never flagged, however badly they read.
   */
  isHighFailure: boolean;
  /**
   * First-attempt score counts across ten deciles: index i covers scores in
   * [i/10, (i+1)/10), with a perfect 1.0 folded into the last bucket. Always
   * length 10, even with no attempts (all zeros).
   */
  distribution: number[];
}

export interface LessonQuizStats {
  lessonId: number;
  lessonTitle: string;
  /** Attempt-weighted mean first-attempt score across the lesson's quizzes. */
  avgScore: number | null;
  /** Total distinct first attempts across the lesson's quizzes. */
  studentCount: number;
  quizzes: QuizScoreStats[];
}

export interface ModuleQuizStats {
  moduleId: number;
  moduleTitle: string;
  /** Attempt-weighted mean first-attempt score across the module's quizzes. */
  avgScore: number | null;
  /** Total distinct first attempts across the module's quizzes. */
  studentCount: number;
  lessons: LessonQuizStats[];
}

export interface CourseQuizPerformance {
  /** Quizzes attached to the course's lessons; 0 → render an empty state. */
  quizCount: number;
  /** Attempt-weighted mean first-attempt score across every quiz; null when none. */
  avgScore: number | null;
  /** Total distinct first attempts across the course's quizzes. */
  attemptCount: number;
  /** Course-wide first-attempt score distribution, same decile scheme as a quiz. */
  distribution: number[];
  /** Quizzes meeting the high-failure thresholds, in course order. */
  flaggedQuizzes: QuizScoreStats[];
  /** Course structure with averages at every altitude (module → lesson → quiz). */
  modules: ModuleQuizStats[];
}

interface FirstAttempt {
  quizId: number;
  score: number;
  passed: boolean;
}

/** Decile bucket for a 0–1 score; a perfect 1.0 folds into the top bucket. */
function scoreBucket(score: number): number {
  const index = Math.floor(score * DISTRIBUTION_BUCKET_COUNT);
  return Math.min(Math.max(index, 0), DISTRIBUTION_BUCKET_COUNT - 1);
}

/** Tally first-attempt scores into the fixed-length decile distribution. */
function buildDistribution(attempts: FirstAttempt[]): number[] {
  const buckets = new Array<number>(DISTRIBUTION_BUCKET_COUNT).fill(0);
  for (const attempt of attempts) buckets[scoreBucket(attempt.score)] += 1;
  return buckets;
}

/**
 * Quiz performance for one course — averages at course, module, lesson, and
 * quiz altitude, score distributions, and high-failure flags — all on each
 * student's FIRST attempt per quiz (PRD: measures teaching, not persistence).
 * All-time: the PRD classes quiz stats as structural, exempt from range
 * filtering.
 *
 * Two queries, then a pure roll-up: a catalog of every quiz in the course (so
 * quizzes nobody attempted still appear, with null averages) and one
 * first-attempt-per-student row set. First attempts are picked with a window
 * over (quizId, userId) ordered by attempt time, the row id breaking ties, so
 * retries never count. Unlike the funnels, attempts are NOT scoped to current
 * enrollment — the PRD defines the basis as "each student's first attempt",
 * full stop. A course with no quizzes yields an empty, non-broken result.
 */
export function getQuizPerformance(opts: {
  courseId: number;
}): CourseQuizPerformance {
  const quizRows = db
    .select({
      quizId: quizzes.id,
      quizTitle: quizzes.title,
      lessonId: lessons.id,
      lessonTitle: lessons.title,
      moduleId: modules.id,
      moduleTitle: modules.title,
    })
    .from(quizzes)
    .innerJoin(lessons, eq(lessons.id, quizzes.lessonId))
    .innerJoin(modules, eq(modules.id, lessons.moduleId))
    .where(eq(modules.courseId, opts.courseId))
    .orderBy(asc(modules.position), asc(lessons.position), asc(quizzes.id))
    .all();

  if (quizRows.length === 0) {
    return {
      quizCount: 0,
      avgScore: null,
      attemptCount: 0,
      distribution: new Array<number>(DISTRIBUTION_BUCKET_COUNT).fill(0),
      flaggedQuizzes: [],
      modules: [],
    };
  }

  const ranked = db
    .select({
      quizId: quizAttempts.quizId,
      score: quizAttempts.score,
      passed: quizAttempts.passed,
      rank: sql<number>`row_number() over (
        partition by ${quizAttempts.quizId}, ${quizAttempts.userId}
        order by ${quizAttempts.attemptedAt} asc, ${quizAttempts.id} asc
      )`.as("rank"),
    })
    .from(quizAttempts)
    .innerJoin(quizzes, eq(quizzes.id, quizAttempts.quizId))
    .innerJoin(lessons, eq(lessons.id, quizzes.lessonId))
    .innerJoin(modules, eq(modules.id, lessons.moduleId))
    .where(eq(modules.courseId, opts.courseId))
    .as("ranked");

  const firstAttempts = db
    .select({
      quizId: ranked.quizId,
      score: ranked.score,
      passed: ranked.passed,
    })
    .from(ranked)
    .where(eq(ranked.rank, 1))
    .all();

  return rollUpQuizPerformance({ quizRows, firstAttempts });
}

/** Pure roll-up: fold first attempts into the course's quiz → lesson → module tree. */
function rollUpQuizPerformance(opts: {
  quizRows: Array<{
    quizId: number;
    quizTitle: string;
    lessonId: number;
    lessonTitle: string;
    moduleId: number;
    moduleTitle: string;
  }>;
  firstAttempts: FirstAttempt[];
}): CourseQuizPerformance {
  const attemptsByQuiz = new Map<number, FirstAttempt[]>();
  for (const attempt of opts.firstAttempts) {
    const list = attemptsByQuiz.get(attempt.quizId) ?? [];
    list.push(attempt);
    attemptsByQuiz.set(attempt.quizId, list);
  }

  const mean = (sum: number, count: number) => (count > 0 ? sum / count : null);

  // Module/lesson order follows quizRows, which the query sorted by position.
  const moduleOrder: number[] = [];
  const moduleMap = new Map<
    number,
    {
      moduleId: number;
      moduleTitle: string;
      lessonOrder: number[];
      lessons: Map<
        number,
        { lessonId: number; lessonTitle: string; quizzes: QuizScoreStats[] }
      >;
    }
  >();

  for (const row of opts.quizRows) {
    const attempts = attemptsByQuiz.get(row.quizId) ?? [];
    const failures = attempts.filter((a) => !a.passed).length;
    const scoreSum = attempts.reduce((sum, a) => sum + a.score, 0);
    const studentCount = attempts.length;
    const failRate = studentCount > 0 ? failures / studentCount : null;

    const quizStats: QuizScoreStats = {
      quizId: row.quizId,
      quizTitle: row.quizTitle,
      lessonId: row.lessonId,
      lessonTitle: row.lessonTitle,
      studentCount,
      avgScore: mean(scoreSum, studentCount),
      failRate,
      isHighFailure:
        failRate !== null &&
        failRate >= HIGH_FAILURE_RATE_THRESHOLD &&
        studentCount >= MIN_ATTEMPTS_FOR_FAILURE_FLAG,
      distribution: buildDistribution(attempts),
    };

    let module = moduleMap.get(row.moduleId);
    if (!module) {
      module = {
        moduleId: row.moduleId,
        moduleTitle: row.moduleTitle,
        lessonOrder: [],
        lessons: new Map(),
      };
      moduleMap.set(row.moduleId, module);
      moduleOrder.push(row.moduleId);
    }

    let lesson = module.lessons.get(row.lessonId);
    if (!lesson) {
      lesson = {
        lessonId: row.lessonId,
        lessonTitle: row.lessonTitle,
        quizzes: [],
      };
      module.lessons.set(row.lessonId, lesson);
      module.lessonOrder.push(row.lessonId);
    }
    lesson.quizzes.push(quizStats);
  }

  const modules: ModuleQuizStats[] = moduleOrder.map((moduleId) => {
    const module = moduleMap.get(moduleId)!;
    const lessons: LessonQuizStats[] = module.lessonOrder.map((lessonId) => {
      const lesson = module.lessons.get(lessonId)!;
      const studentCount = lesson.quizzes.reduce(
        (sum, q) => sum + q.studentCount,
        0
      );
      const scoreSum = lesson.quizzes.reduce(
        (sum, q) => sum + (q.avgScore ?? 0) * q.studentCount,
        0
      );
      return {
        lessonId: lesson.lessonId,
        lessonTitle: lesson.lessonTitle,
        studentCount,
        avgScore: mean(scoreSum, studentCount),
        quizzes: lesson.quizzes,
      };
    });
    const studentCount = lessons.reduce((sum, l) => sum + l.studentCount, 0);
    const scoreSum = lessons.reduce(
      (sum, l) => sum + (l.avgScore ?? 0) * l.studentCount,
      0
    );
    return {
      moduleId: module.moduleId,
      moduleTitle: module.moduleTitle,
      studentCount,
      avgScore: mean(scoreSum, studentCount),
      lessons,
    };
  });

  const attemptCount = opts.firstAttempts.length;
  const scoreSum = opts.firstAttempts.reduce((sum, a) => sum + a.score, 0);
  const flaggedQuizzes = modules
    .flatMap((m) => m.lessons)
    .flatMap((l) => l.quizzes)
    .filter((q) => q.isHighFailure);

  return {
    quizCount: opts.quizRows.length,
    avgScore: mean(scoreSum, attemptCount),
    attemptCount,
    distribution: buildDistribution(opts.firstAttempts),
    flaggedQuizzes,
    modules,
  };
}

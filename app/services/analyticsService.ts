import { and, asc, desc, eq, gte, sql, type AnyColumn, type SQL } from "drizzle-orm";
import { db } from "~/db";
import { courses, enrollments, purchases } from "~/db/schema";
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

export interface TrendOptions {
  instructorId: number;
  /** Inclusive ISO-UTC lower bound, or null for all-time. */
  since: string | null;
  /**
   * ISO-UTC end of the window (the loader's "now"). Only used to zero-fill
   * trailing empty buckets — rows are never filtered by it.
   */
  until: string;
  granularity: RangeGranularity;
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

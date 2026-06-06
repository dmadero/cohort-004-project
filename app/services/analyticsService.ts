import { asc, desc, eq, sql } from "drizzle-orm";
import { db } from "~/db";
import { courses, enrollments, purchases } from "~/db/schema";

// ─── Analytics Service ───
// All instructor-facing metric computation lives here, one aggregate query per
// dashboard section, so route loaders stay thin. Metric definitions are fixed
// by the PRD (docs/prd-analytics-feature.md); record changes there first.

export interface OverviewStats {
  /** Courses the instructor owns, regardless of status (draft/archived included). */
  courseCount: number;
  /** All-time enrollments across every owned course. */
  totalEnrollments: number;
  /** All-time gross earnings in cents: SUM(purchases.pricePaid) over owned courses. */
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
 * Cross-course overview KPIs for one instructor, derived from the same
 * per-course aggregates the comparison table shows so the two sections can
 * never disagree. An instructor with no courses gets zeros, not an error.
 */
export function getOverviewStats(opts: { instructorId: number }): OverviewStats {
  const courseStats = getCourseStats(opts);

  const totalEnrollments = courseStats.reduce(
    (sum, course) => sum + course.enrollmentCount,
    0
  );
  const grossEarningsCents = courseStats.reduce(
    (sum, course) => sum + course.grossEarningsCents,
    0
  );

  return {
    courseCount: courseStats.length,
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

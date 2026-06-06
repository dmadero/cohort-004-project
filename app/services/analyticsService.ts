import { eq, sql } from "drizzle-orm";
import { db } from "~/db";
import { courses, enrollments } from "~/db/schema";

// ─── Analytics Service ───
// All instructor-facing metric computation lives here, one aggregate query per
// dashboard section, so route loaders stay thin. Metric definitions are fixed
// by the PRD (docs/prd-analytics-feature.md); record changes there first.

export interface OverviewStats {
  /** Courses the instructor owns, regardless of status (draft/archived included). */
  courseCount: number;
  /** All-time enrollments across every owned course. */
  totalEnrollments: number;
}

/**
 * Cross-course overview KPIs for one instructor.
 *
 * Counts every course the instructor owns (any status) and every enrollment
 * on those courses, in a single aggregate query. An instructor with no
 * courses gets zeros, not an error.
 */
export function getOverviewStats(opts: { instructorId: number }): OverviewStats {
  const result = db
    .select({
      courseCount: sql<number>`count(distinct ${courses.id})`,
      totalEnrollments: sql<number>`count(${enrollments.id})`,
    })
    .from(courses)
    .leftJoin(enrollments, eq(enrollments.courseId, courses.id))
    .where(eq(courses.instructorId, opts.instructorId))
    .get();

  return {
    courseCount: result?.courseCount ?? 0,
    totalEnrollments: result?.totalEnrollments ?? 0,
  };
}

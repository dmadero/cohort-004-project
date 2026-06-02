import { eq, and, sql } from "drizzle-orm";
import { db } from "~/db";
import { courseReviews } from "~/db/schema";
import { findEnrollment } from "./enrollmentService";

// ─── Review Service ───
// Handles course star ratings (1–5). One rating per student per course,
// editable via upsert. Only students who completed the course may rate.
// Uses positional parameters (project convention).

/** A student may review a course only once they have completed it. */
export function hasUserCompletedCourse(
  userId: number,
  courseId: number
): boolean {
  const enrollment = findEnrollment(userId, courseId);
  return !!enrollment?.completedAt;
}

export function getReviewByUserAndCourse(userId: number, courseId: number) {
  return db
    .select()
    .from(courseReviews)
    .where(
      and(
        eq(courseReviews.userId, userId),
        eq(courseReviews.courseId, courseId)
      )
    )
    .get();
}

export function getCourseRatingSummary(courseId: number): {
  average: number | null;
  count: number;
} {
  const result = db
    .select({
      average: sql<number | null>`avg(${courseReviews.rating})`,
      count: sql<number>`count(*)`,
    })
    .from(courseReviews)
    .where(eq(courseReviews.courseId, courseId))
    .get();

  return {
    average: result?.average ?? null,
    count: result?.count ?? 0,
  };
}

export function upsertReview(
  userId: number,
  courseId: number,
  rating: number
) {
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    throw new Error("Rating must be an integer between 1 and 5");
  }

  // Only students who have completed the course may rate it.
  const enrollment = findEnrollment(userId, courseId);
  if (!enrollment?.completedAt) {
    throw new Error("Must complete the course before rating it");
  }

  return db
    .insert(courseReviews)
    .values({ userId, courseId, rating })
    .onConflictDoUpdate({
      target: [courseReviews.userId, courseReviews.courseId],
      set: { rating, updatedAt: new Date().toISOString() },
    })
    .returning()
    .get();
}

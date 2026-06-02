import { describe, it, expect, beforeEach, vi } from "vitest";
import { createTestDb, seedBaseData } from "~/test/setup";
import * as schema from "~/db/schema";

let testDb: ReturnType<typeof createTestDb>;
let base: ReturnType<typeof seedBaseData>;

vi.mock("~/db", () => ({
  get db() {
    return testDb;
  },
}));

// Import after mock so the module picks up our test db
import {
  getReviewByUserAndCourse,
  getCourseRatingSummary,
  upsertReview,
  hasUserCompletedCourse,
} from "./reviewService";

/** Enroll the base user and mark the enrollment complete. */
function enrollAndComplete(userId: number, courseId: number) {
  testDb
    .insert(schema.enrollments)
    .values({ userId, courseId, completedAt: new Date().toISOString() })
    .run();
}

describe("reviewService", () => {
  beforeEach(() => {
    testDb = createTestDb();
    base = seedBaseData(testDb);
  });

  describe("hasUserCompletedCourse", () => {
    it("is false when not enrolled", () => {
      expect(hasUserCompletedCourse(base.user.id, base.course.id)).toBe(false);
    });

    it("is false when enrolled but not completed", () => {
      testDb
        .insert(schema.enrollments)
        .values({ userId: base.user.id, courseId: base.course.id })
        .run();
      expect(hasUserCompletedCourse(base.user.id, base.course.id)).toBe(false);
    });

    it("is true when the enrollment is completed", () => {
      enrollAndComplete(base.user.id, base.course.id);
      expect(hasUserCompletedCourse(base.user.id, base.course.id)).toBe(true);
    });
  });

  describe("upsertReview", () => {
    it("creates a review for a completed enrollment", () => {
      enrollAndComplete(base.user.id, base.course.id);

      const review = upsertReview(base.user.id, base.course.id, 4);

      expect(review).toBeDefined();
      expect(review.userId).toBe(base.user.id);
      expect(review.courseId).toBe(base.course.id);
      expect(review.rating).toBe(4);
    });

    it("updates the existing review instead of creating a duplicate (upsert)", () => {
      enrollAndComplete(base.user.id, base.course.id);

      const first = upsertReview(base.user.id, base.course.id, 3);
      const second = upsertReview(base.user.id, base.course.id, 5);

      expect(second.id).toBe(first.id);
      expect(second.rating).toBe(5);

      const summary = getCourseRatingSummary(base.course.id);
      expect(summary.count).toBe(1);
      expect(summary.average).toBe(5);
    });

    it("rejects a rating below 1", () => {
      enrollAndComplete(base.user.id, base.course.id);
      expect(() => upsertReview(base.user.id, base.course.id, 0)).toThrowError(
        "Rating must be an integer between 1 and 5"
      );
    });

    it("rejects a rating above 5", () => {
      enrollAndComplete(base.user.id, base.course.id);
      expect(() => upsertReview(base.user.id, base.course.id, 6)).toThrowError(
        "Rating must be an integer between 1 and 5"
      );
    });

    it("rejects a non-integer rating", () => {
      enrollAndComplete(base.user.id, base.course.id);
      expect(() => upsertReview(base.user.id, base.course.id, 4.5)).toThrowError(
        "Rating must be an integer between 1 and 5"
      );
    });

    it("rejects rating when the user has not enrolled", () => {
      expect(() => upsertReview(base.user.id, base.course.id, 4)).toThrowError(
        "Must complete the course before rating it"
      );
    });

    it("rejects rating when the user enrolled but has not completed", () => {
      testDb
        .insert(schema.enrollments)
        .values({ userId: base.user.id, courseId: base.course.id })
        .run();

      expect(() => upsertReview(base.user.id, base.course.id, 4)).toThrowError(
        "Must complete the course before rating it"
      );
    });
  });

  describe("getReviewByUserAndCourse", () => {
    it("returns undefined when no review exists", () => {
      expect(
        getReviewByUserAndCourse(base.user.id, base.course.id)
      ).toBeUndefined();
    });

    it("returns the user's review when it exists", () => {
      enrollAndComplete(base.user.id, base.course.id);
      upsertReview(base.user.id, base.course.id, 2);

      const review = getReviewByUserAndCourse(base.user.id, base.course.id);
      expect(review?.rating).toBe(2);
    });
  });

  describe("getCourseRatingSummary", () => {
    it("returns null average and zero count with no reviews", () => {
      const summary = getCourseRatingSummary(base.course.id);
      expect(summary.average).toBeNull();
      expect(summary.count).toBe(0);
    });

    it("averages multiple students' ratings", () => {
      const other = testDb
        .insert(schema.users)
        .values({
          name: "Second Student",
          email: "second@example.com",
          role: schema.UserRole.Student,
        })
        .returning()
        .get();

      enrollAndComplete(base.user.id, base.course.id);
      enrollAndComplete(other.id, base.course.id);

      upsertReview(base.user.id, base.course.id, 2);
      upsertReview(other.id, base.course.id, 4);

      const summary = getCourseRatingSummary(base.course.id);
      expect(summary.count).toBe(2);
      expect(summary.average).toBe(3);
    });
  });
});

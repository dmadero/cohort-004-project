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
  getCourseStats,
  getEnrollmentTrend,
  getOverviewStats,
  getRevenueTrend,
} from "./analyticsService";

function createStudent(email: string) {
  return testDb
    .insert(schema.users)
    .values({ name: `Student ${email}`, email, role: schema.UserRole.Student })
    .returning()
    .get();
}

function createCourse(opts: {
  instructorId: number;
  slug: string;
  status?: schema.CourseStatus;
}) {
  return testDb
    .insert(schema.courses)
    .values({
      title: `Course ${opts.slug}`,
      slug: opts.slug,
      description: "A course",
      instructorId: opts.instructorId,
      categoryId: base.category.id,
      status: opts.status ?? schema.CourseStatus.Published,
    })
    .returning()
    .get();
}

function enroll(opts: {
  userId: number;
  courseId: number;
  enrolledAt?: string;
  completedAt?: string;
}) {
  return testDb.insert(schema.enrollments).values(opts).returning().get();
}

function purchase(opts: {
  userId: number;
  courseId: number;
  pricePaidCents: number;
  createdAt?: string;
}) {
  return testDb
    .insert(schema.purchases)
    .values({
      userId: opts.userId,
      courseId: opts.courseId,
      pricePaid: opts.pricePaidCents,
      createdAt: opts.createdAt,
    })
    .returning()
    .get();
}

describe("analyticsService", () => {
  beforeEach(() => {
    testDb = createTestDb();
    base = seedBaseData(testDb);
  });

  describe("getOverviewStats", () => {
    it("returns total enrollments summed across all of the instructor's courses", () => {
      const second = createCourse({
        instructorId: base.instructor.id,
        slug: "second-course",
      });
      const studentB = createStudent("b@example.com");
      const studentC = createStudent("c@example.com");
      enroll({ userId: base.user.id, courseId: base.course.id });
      enroll({ userId: studentB.id, courseId: base.course.id });
      enroll({ userId: studentC.id, courseId: second.id });

      const stats = getOverviewStats({ instructorId: base.instructor.id, since: null });

      expect(stats).toMatchObject({ courseCount: 2, totalEnrollments: 3 });
    });

    it("counts a zero-enrollment course without skewing the enrollment total", () => {
      createCourse({
        instructorId: base.instructor.id,
        slug: "empty-course",
        status: schema.CourseStatus.Draft,
      });
      enroll({ userId: base.user.id, courseId: base.course.id });

      const stats = getOverviewStats({ instructorId: base.instructor.id, since: null });

      expect(stats).toMatchObject({ courseCount: 2, totalEnrollments: 1 });
    });

    it("excludes courses and enrollments owned by other instructors", () => {
      const otherInstructor = testDb
        .insert(schema.users)
        .values({
          name: "Other Instructor",
          email: "other@example.com",
          role: schema.UserRole.Instructor,
        })
        .returning()
        .get();
      const otherCourse = createCourse({
        instructorId: otherInstructor.id,
        slug: "other-course",
      });
      enroll({ userId: base.user.id, courseId: otherCourse.id });
      purchase({
        userId: base.user.id,
        courseId: otherCourse.id,
        pricePaidCents: 9900,
      });

      const stats = getOverviewStats({ instructorId: base.instructor.id, since: null });

      expect(stats).toEqual({
        courseCount: 1,
        totalEnrollments: 0,
        grossEarningsCents: 0,
        avgRevenuePerStudentCents: null,
      });
    });

    it("returns zeros for an instructor with no courses", () => {
      const newInstructor = testDb
        .insert(schema.users)
        .values({
          name: "Fresh Instructor",
          email: "fresh@example.com",
          role: schema.UserRole.Instructor,
        })
        .returning()
        .get();

      const stats = getOverviewStats({ instructorId: newInstructor.id, since: null });

      expect(stats).toEqual({
        courseCount: 0,
        totalEnrollments: 0,
        grossEarningsCents: 0,
        avgRevenuePerStudentCents: null,
      });
    });

    it("sums gross earnings across courses from purchase amounts", () => {
      const second = createCourse({
        instructorId: base.instructor.id,
        slug: "second-course",
      });
      const studentB = createStudent("b@example.com");
      enroll({ userId: base.user.id, courseId: base.course.id });
      enroll({ userId: studentB.id, courseId: second.id });
      purchase({
        userId: base.user.id,
        courseId: base.course.id,
        pricePaidCents: 4900,
      });
      purchase({ userId: studentB.id, courseId: second.id, pricePaidCents: 9900 });

      const stats = getOverviewStats({ instructorId: base.instructor.id, since: null });

      expect(stats).toMatchObject({
        grossEarningsCents: 14800,
        avgRevenuePerStudentCents: 7400,
      });
    });

    it("blends a team purchase across its coupon enrollments in average revenue per student", () => {
      // Team purchase: one purchase row carries all the money, while each
      // redeemed coupon creates an enrollment with no purchase of its own.
      const buyer = createStudent("buyer@example.com");
      const seatA = createStudent("seat-a@example.com");
      const seatB = createStudent("seat-b@example.com");
      purchase({ userId: buyer.id, courseId: base.course.id, pricePaidCents: 30000 });
      enroll({ userId: base.user.id, courseId: base.course.id });
      enroll({ userId: seatA.id, courseId: base.course.id });
      enroll({ userId: seatB.id, courseId: base.course.id });

      const stats = getOverviewStats({ instructorId: base.instructor.id, since: null });

      expect(stats).toMatchObject({
        totalEnrollments: 3,
        grossEarningsCents: 30000,
        avgRevenuePerStudentCents: 10000,
      });
    });

    it("reports zero average revenue per student when all enrollments are free", () => {
      enroll({ userId: base.user.id, courseId: base.course.id });

      const stats = getOverviewStats({ instructorId: base.instructor.id, since: null });

      expect(stats).toMatchObject({
        totalEnrollments: 1,
        grossEarningsCents: 0,
        avgRevenuePerStudentCents: 0,
      });
    });

    it("excludes enrollments and purchases dated before the range start", () => {
      const studentB = createStudent("b@example.com");
      enroll({
        userId: base.user.id,
        courseId: base.course.id,
        enrolledAt: "2026-01-15T00:00:00.000Z", // before the window
      });
      enroll({
        userId: studentB.id,
        courseId: base.course.id,
        enrolledAt: "2026-05-20T00:00:00.000Z", // inside the window
      });
      purchase({
        userId: base.user.id,
        courseId: base.course.id,
        pricePaidCents: 4900,
        createdAt: "2026-01-15T00:00:00.000Z", // before the window
      });
      purchase({
        userId: studentB.id,
        courseId: base.course.id,
        pricePaidCents: 9900,
        createdAt: "2026-05-20T00:00:00.000Z", // inside the window
      });

      const stats = getOverviewStats({
        instructorId: base.instructor.id,
        since: "2026-05-01T00:00:00.000Z",
      });

      expect(stats).toEqual({
        courseCount: 1,
        totalEnrollments: 1,
        grossEarningsCents: 9900,
        avgRevenuePerStudentCents: 9900,
      });
    });

    it("includes activity dated exactly at the range start", () => {
      const since = "2026-05-01T00:00:00.000Z";
      enroll({ userId: base.user.id, courseId: base.course.id, enrolledAt: since });
      purchase({
        userId: base.user.id,
        courseId: base.course.id,
        pricePaidCents: 4900,
        createdAt: since,
      });

      const stats = getOverviewStats({ instructorId: base.instructor.id, since });

      expect(stats).toMatchObject({
        totalEnrollments: 1,
        grossEarningsCents: 4900,
      });
    });

    it("returns zeros and a null average for a window with no activity, keeping the all-time course count", () => {
      enroll({
        userId: base.user.id,
        courseId: base.course.id,
        enrolledAt: "2026-01-15T00:00:00.000Z",
      });
      purchase({
        userId: base.user.id,
        courseId: base.course.id,
        pricePaidCents: 4900,
        createdAt: "2026-01-15T00:00:00.000Z",
      });

      const stats = getOverviewStats({
        instructorId: base.instructor.id,
        since: "2026-06-01T00:00:00.000Z",
      });

      expect(stats).toEqual({
        courseCount: 1,
        totalEnrollments: 0,
        grossEarningsCents: 0,
        avgRevenuePerStudentCents: null,
      });
    });
  });

  describe("getCourseStats", () => {
    it("returns enrollments, earnings, and completion rate per course", () => {
      const second = createCourse({
        instructorId: base.instructor.id,
        slug: "second-course",
      });
      const studentB = createStudent("b@example.com");
      enroll({
        userId: base.user.id,
        courseId: base.course.id,
        completedAt: "2026-05-01T00:00:00.000Z",
      });
      enroll({ userId: studentB.id, courseId: base.course.id });
      purchase({
        userId: base.user.id,
        courseId: base.course.id,
        pricePaidCents: 4900,
      });
      enroll({ userId: studentB.id, courseId: second.id });

      const stats = getCourseStats({ instructorId: base.instructor.id });

      expect(stats).toEqual([
        {
          courseId: base.course.id,
          title: base.course.title,
          status: schema.CourseStatus.Published,
          enrollmentCount: 2,
          grossEarningsCents: 4900,
          completionRate: 0.5,
        },
        {
          courseId: second.id,
          title: second.title,
          status: schema.CourseStatus.Published,
          enrollmentCount: 1,
          grossEarningsCents: 0,
          completionRate: 0,
        },
      ]);
    });

    it("orders courses by gross earnings descending, then title", () => {
      const cheap = createCourse({
        instructorId: base.instructor.id,
        slug: "a-cheap-course",
      });
      const top = createCourse({
        instructorId: base.instructor.id,
        slug: "z-top-course",
      });
      purchase({ userId: base.user.id, courseId: cheap.id, pricePaidCents: 1000 });
      purchase({ userId: base.user.id, courseId: top.id, pricePaidCents: 5000 });

      const stats = getCourseStats({ instructorId: base.instructor.id });

      expect(stats.map((c) => c.courseId)).toEqual([
        top.id,
        cheap.id,
        base.course.id,
      ]);
    });

    it("counts a team purchase's money once while counting every coupon enrollment", () => {
      const buyer = createStudent("buyer@example.com");
      const seatA = createStudent("seat-a@example.com");
      purchase({ userId: buyer.id, courseId: base.course.id, pricePaidCents: 20000 });
      enroll({ userId: base.user.id, courseId: base.course.id });
      enroll({ userId: seatA.id, courseId: base.course.id });

      const stats = getCourseStats({ instructorId: base.instructor.id });

      expect(stats).toEqual([
        expect.objectContaining({
          courseId: base.course.id,
          enrollmentCount: 2,
          grossEarningsCents: 20000,
        }),
      ]);
    });

    it("returns a null completion rate for a course with no enrollments", () => {
      const draft = createCourse({
        instructorId: base.instructor.id,
        slug: "draft-course",
        status: schema.CourseStatus.Draft,
      });

      const stats = getCourseStats({ instructorId: base.instructor.id });

      expect(stats).toContainEqual({
        courseId: draft.id,
        title: draft.title,
        status: schema.CourseStatus.Draft,
        enrollmentCount: 0,
        grossEarningsCents: 0,
        completionRate: null,
      });
    });

    it("includes draft and archived courses with their status", () => {
      createCourse({
        instructorId: base.instructor.id,
        slug: "archived-course",
        status: schema.CourseStatus.Archived,
      });

      const stats = getCourseStats({ instructorId: base.instructor.id });

      expect(stats.map((c) => c.status).sort()).toEqual([
        schema.CourseStatus.Archived,
        schema.CourseStatus.Published,
      ]);
    });

    it("excludes courses owned by other instructors", () => {
      const otherInstructor = testDb
        .insert(schema.users)
        .values({
          name: "Other Instructor",
          email: "other@example.com",
          role: schema.UserRole.Instructor,
        })
        .returning()
        .get();
      createCourse({ instructorId: otherInstructor.id, slug: "other-course" });

      const stats = getCourseStats({ instructorId: base.instructor.id });

      expect(stats.map((c) => c.courseId)).toEqual([base.course.id]);
    });
  });

  describe("getEnrollmentTrend", () => {
    it("buckets enrollments per day with zero-filled gaps through the window end", () => {
      const studentB = createStudent("b@example.com");
      const studentC = createStudent("c@example.com");
      enroll({
        userId: base.user.id,
        courseId: base.course.id,
        enrolledAt: "2026-06-01T08:00:00.000Z",
      });
      enroll({
        userId: studentB.id,
        courseId: base.course.id,
        enrolledAt: "2026-06-01T20:00:00.000Z",
      });
      enroll({
        userId: studentC.id,
        courseId: base.course.id,
        enrolledAt: "2026-06-03T12:00:00.000Z",
      });

      const series = getEnrollmentTrend({
        instructorId: base.instructor.id,
        since: "2026-06-01T00:00:00.000Z",
        until: "2026-06-04T12:00:00.000Z",
        granularity: "daily",
      });

      expect(series).toEqual([
        { bucket: "2026-06-01", value: 2 },
        { bucket: "2026-06-02", value: 0 },
        { bucket: "2026-06-03", value: 1 },
        { bucket: "2026-06-04", value: 0 },
      ]);
    });

    it("buckets enrollments into Monday-keyed weeks", () => {
      const studentB = createStudent("b@example.com");
      const studentC = createStudent("c@example.com");
      // 2026-06-01 is a Monday; the 3rd and the Sunday 7th share its week.
      enroll({
        userId: base.user.id,
        courseId: base.course.id,
        enrolledAt: "2026-06-03T10:00:00.000Z",
      });
      enroll({
        userId: studentB.id,
        courseId: base.course.id,
        enrolledAt: "2026-06-07T23:00:00.000Z",
      });
      enroll({
        userId: studentC.id,
        courseId: base.course.id,
        enrolledAt: "2026-06-08T00:00:00.000Z", // Monday — next week
      });

      const series = getEnrollmentTrend({
        instructorId: base.instructor.id,
        since: "2026-06-01T00:00:00.000Z",
        until: "2026-06-08T12:00:00.000Z",
        granularity: "weekly",
      });

      expect(series).toEqual([
        { bucket: "2026-06-01", value: 2 },
        { bucket: "2026-06-08", value: 1 },
      ]);
    });

    it("buckets enrollments per month with zero-filled gap months", () => {
      const studentB = createStudent("b@example.com");
      enroll({
        userId: base.user.id,
        courseId: base.course.id,
        enrolledAt: "2026-04-10T00:00:00.000Z",
      });
      enroll({
        userId: studentB.id,
        courseId: base.course.id,
        enrolledAt: "2026-06-02T00:00:00.000Z",
      });

      const series = getEnrollmentTrend({
        instructorId: base.instructor.id,
        since: "2026-04-01T00:00:00.000Z",
        until: "2026-06-05T00:00:00.000Z",
        granularity: "monthly",
      });

      expect(series).toEqual([
        { bucket: "2026-04", value: 1 },
        { bucket: "2026-05", value: 0 },
        { bucket: "2026-06", value: 1 },
      ]);
    });

    it("starts an all-time series at the first enrollment instead of the window start", () => {
      enroll({
        userId: base.user.id,
        courseId: base.course.id,
        enrolledAt: "2026-05-20T00:00:00.000Z",
      });

      const series = getEnrollmentTrend({
        instructorId: base.instructor.id,
        since: null,
        until: "2026-06-05T00:00:00.000Z",
        granularity: "monthly",
      });

      expect(series).toEqual([
        { bucket: "2026-05", value: 1 },
        { bucket: "2026-06", value: 0 },
      ]);
    });

    it("excludes enrollments before the window start", () => {
      const studentB = createStudent("b@example.com");
      enroll({
        userId: base.user.id,
        courseId: base.course.id,
        enrolledAt: "2026-05-30T00:00:00.000Z",
      });
      enroll({
        userId: studentB.id,
        courseId: base.course.id,
        enrolledAt: "2026-06-02T00:00:00.000Z",
      });

      const series = getEnrollmentTrend({
        instructorId: base.instructor.id,
        since: "2026-06-01T00:00:00.000Z",
        until: "2026-06-02T00:00:00.000Z",
        granularity: "daily",
      });

      expect(series).toEqual([
        { bucket: "2026-06-01", value: 0 },
        { bucket: "2026-06-02", value: 1 },
      ]);
    });

    it("excludes enrollments on other instructors' courses", () => {
      const otherInstructor = testDb
        .insert(schema.users)
        .values({
          name: "Other Instructor",
          email: "other@example.com",
          role: schema.UserRole.Instructor,
        })
        .returning()
        .get();
      const otherCourse = createCourse({
        instructorId: otherInstructor.id,
        slug: "other-course",
      });
      enroll({
        userId: base.user.id,
        courseId: otherCourse.id,
        enrolledAt: "2026-06-02T00:00:00.000Z",
      });

      const series = getEnrollmentTrend({
        instructorId: base.instructor.id,
        since: "2026-06-01T00:00:00.000Z",
        until: "2026-06-05T00:00:00.000Z",
        granularity: "daily",
      });

      expect(series).toEqual([]);
    });

    it("returns an empty series for a window with no enrollments", () => {
      enroll({
        userId: base.user.id,
        courseId: base.course.id,
        enrolledAt: "2026-01-15T00:00:00.000Z",
      });

      const series = getEnrollmentTrend({
        instructorId: base.instructor.id,
        since: "2026-06-01T00:00:00.000Z",
        until: "2026-06-05T00:00:00.000Z",
        granularity: "daily",
      });

      expect(series).toEqual([]);
    });
  });

  describe("getRevenueTrend", () => {
    it("sums purchase amounts per bucket with zero-filled gaps", () => {
      const studentB = createStudent("b@example.com");
      purchase({
        userId: base.user.id,
        courseId: base.course.id,
        pricePaidCents: 4900,
        createdAt: "2026-06-01T08:00:00.000Z",
      });
      purchase({
        userId: studentB.id,
        courseId: base.course.id,
        pricePaidCents: 9900,
        createdAt: "2026-06-01T20:00:00.000Z",
      });
      purchase({
        userId: studentB.id,
        courseId: base.course.id,
        pricePaidCents: 1000,
        createdAt: "2026-06-03T00:00:00.000Z",
      });

      const series = getRevenueTrend({
        instructorId: base.instructor.id,
        since: "2026-06-01T00:00:00.000Z",
        until: "2026-06-03T12:00:00.000Z",
        granularity: "daily",
      });

      expect(series).toEqual([
        { bucket: "2026-06-01", value: 14800 },
        { bucket: "2026-06-02", value: 0 },
        { bucket: "2026-06-03", value: 1000 },
      ]);
    });

    it("excludes purchases before the window and on other instructors' courses", () => {
      const otherInstructor = testDb
        .insert(schema.users)
        .values({
          name: "Other Instructor",
          email: "other@example.com",
          role: schema.UserRole.Instructor,
        })
        .returning()
        .get();
      const otherCourse = createCourse({
        instructorId: otherInstructor.id,
        slug: "other-course",
      });
      purchase({
        userId: base.user.id,
        courseId: base.course.id,
        pricePaidCents: 4900,
        createdAt: "2026-05-20T00:00:00.000Z", // before the window
      });
      purchase({
        userId: base.user.id,
        courseId: otherCourse.id,
        pricePaidCents: 9900,
        createdAt: "2026-06-02T00:00:00.000Z", // someone else's course
      });
      purchase({
        userId: base.user.id,
        courseId: base.course.id,
        pricePaidCents: 1000,
        createdAt: "2026-06-02T00:00:00.000Z",
      });

      const series = getRevenueTrend({
        instructorId: base.instructor.id,
        since: "2026-06-01T00:00:00.000Z",
        until: "2026-06-02T00:00:00.000Z",
        granularity: "daily",
      });

      expect(series).toEqual([
        { bucket: "2026-06-01", value: 0 },
        { bucket: "2026-06-02", value: 1000 },
      ]);
    });

    it("returns an empty series for a window with no purchases", () => {
      const series = getRevenueTrend({
        instructorId: base.instructor.id,
        since: "2026-06-01T00:00:00.000Z",
        until: "2026-06-05T00:00:00.000Z",
        granularity: "daily",
      });

      expect(series).toEqual([]);
    });
  });
});

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
  getCompletionTrend,
  getCourseFunnel,
  getCourseStats,
  getEnrollmentTrend,
  getLessonFunnel,
  getOverviewStats,
  getPlatformCourseBreakdown,
  getPlatformInstructors,
  getPlatformOverviewStats,
  getPlatformRevenueTrend,
  getQuizPerformance,
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
  price?: number;
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
      price: opts.price ?? 0,
    })
    .returning()
    .get();
}

function createInstructor(email: string) {
  return testDb
    .insert(schema.users)
    .values({
      name: `Instructor ${email}`,
      email,
      role: schema.UserRole.Instructor,
    })
    .returning()
    .get();
}

function review(opts: { userId: number; courseId: number; rating: number }) {
  return testDb
    .insert(schema.courseReviews)
    .values({
      userId: opts.userId,
      courseId: opts.courseId,
      rating: opts.rating,
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

/** Creates a module + lesson in the course; returns the lesson. */
function createLessonInCourse(opts: { courseId: number }) {
  const module = testDb
    .insert(schema.modules)
    .values({ courseId: opts.courseId, title: "Module", position: 1 })
    .returning()
    .get();
  return testDb
    .insert(schema.lessons)
    .values({ moduleId: module.id, title: "Lesson", position: 1 })
    .returning()
    .get();
}

function recordProgress(opts: { userId: number; lessonId: number }) {
  return testDb
    .insert(schema.lessonProgress)
    .values({
      userId: opts.userId,
      lessonId: opts.lessonId,
      status: schema.LessonProgressStatus.InProgress,
    })
    .returning()
    .get();
}

function completeLesson(opts: { userId: number; lessonId: number }) {
  return testDb
    .insert(schema.lessonProgress)
    .values({
      userId: opts.userId,
      lessonId: opts.lessonId,
      status: schema.LessonProgressStatus.Completed,
      completedAt: "2026-06-01T00:00:00.000Z",
    })
    .returning()
    .get();
}

/** Creates a module at the given position with `lessonCount` ordered lessons. */
function createModuleWithLessons(opts: {
  courseId: number;
  modulePosition: number;
  lessonCount: number;
}) {
  const module = testDb
    .insert(schema.modules)
    .values({
      courseId: opts.courseId,
      title: `Module ${opts.modulePosition}`,
      position: opts.modulePosition,
    })
    .returning()
    .get();
  return Array.from({ length: opts.lessonCount }, (_, i) =>
    testDb
      .insert(schema.lessons)
      .values({
        moduleId: module.id,
        title: `Lesson ${opts.modulePosition}.${i + 1}`,
        position: i + 1,
      })
      .returning()
      .get()
  );
}

/** Creates a quiz on the given lesson; passingScore defaults to 0.6. */
function createQuiz(opts: { lessonId: number; passingScore?: number }) {
  return testDb
    .insert(schema.quizzes)
    .values({
      lessonId: opts.lessonId,
      title: "Quiz",
      passingScore: opts.passingScore ?? 0.6,
    })
    .returning()
    .get();
}

/** Records one quiz attempt; `passed` defaults to score ≥ 0.6. */
function attemptQuiz(opts: {
  userId: number;
  quizId: number;
  score: number;
  passed?: boolean;
  attemptedAt?: string;
}) {
  return testDb
    .insert(schema.quizAttempts)
    .values({
      userId: opts.userId,
      quizId: opts.quizId,
      score: opts.score,
      passed: opts.passed ?? opts.score >= 0.6,
      attemptedAt: opts.attemptedAt,
    })
    .returning()
    .get();
}

/** Creates and enrolls `count` students in the course. */
function enrollStudents(opts: { courseId: number; count: number }) {
  return Array.from({ length: opts.count }, (_, i) => {
    const student = createStudent(`student-${i}@example.com`);
    enroll({ userId: student.id, courseId: opts.courseId });
    return student;
  });
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

      const stats = getOverviewStats({
        instructorId: base.instructor.id,
        since: null,
      });

      expect(stats).toMatchObject({ courseCount: 2, totalEnrollments: 3 });
    });

    it("counts a zero-enrollment course without skewing the enrollment total", () => {
      createCourse({
        instructorId: base.instructor.id,
        slug: "empty-course",
        status: schema.CourseStatus.Draft,
      });
      enroll({ userId: base.user.id, courseId: base.course.id });

      const stats = getOverviewStats({
        instructorId: base.instructor.id,
        since: null,
      });

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

      const stats = getOverviewStats({
        instructorId: base.instructor.id,
        since: null,
      });

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

      const stats = getOverviewStats({
        instructorId: newInstructor.id,
        since: null,
      });

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
      purchase({
        userId: studentB.id,
        courseId: second.id,
        pricePaidCents: 9900,
      });

      const stats = getOverviewStats({
        instructorId: base.instructor.id,
        since: null,
      });

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
      purchase({
        userId: buyer.id,
        courseId: base.course.id,
        pricePaidCents: 30000,
      });
      enroll({ userId: base.user.id, courseId: base.course.id });
      enroll({ userId: seatA.id, courseId: base.course.id });
      enroll({ userId: seatB.id, courseId: base.course.id });

      const stats = getOverviewStats({
        instructorId: base.instructor.id,
        since: null,
      });

      expect(stats).toMatchObject({
        totalEnrollments: 3,
        grossEarningsCents: 30000,
        avgRevenuePerStudentCents: 10000,
      });
    });

    it("reports zero average revenue per student when all enrollments are free", () => {
      enroll({ userId: base.user.id, courseId: base.course.id });

      const stats = getOverviewStats({
        instructorId: base.instructor.id,
        since: null,
      });

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
      enroll({
        userId: base.user.id,
        courseId: base.course.id,
        enrolledAt: since,
      });
      purchase({
        userId: base.user.id,
        courseId: base.course.id,
        pricePaidCents: 4900,
        createdAt: since,
      });

      const stats = getOverviewStats({
        instructorId: base.instructor.id,
        since,
      });

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
      purchase({
        userId: base.user.id,
        courseId: cheap.id,
        pricePaidCents: 1000,
      });
      purchase({
        userId: base.user.id,
        courseId: top.id,
        pricePaidCents: 5000,
      });

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
      purchase({
        userId: buyer.id,
        courseId: base.course.id,
        pricePaidCents: 20000,
      });
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

  describe("getPlatformRevenueTrend", () => {
    it("sums purchases across all instructors' courses per bucket with zero-filled gaps", () => {
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
      const studentB = createStudent("b@example.com");
      // Two courses, two instructors — revenue is combined platform-wide.
      purchase({
        userId: base.user.id,
        courseId: base.course.id,
        pricePaidCents: 4900,
        createdAt: "2026-06-01T08:00:00.000Z",
      });
      purchase({
        userId: studentB.id,
        courseId: otherCourse.id,
        pricePaidCents: 9900,
        createdAt: "2026-06-01T20:00:00.000Z",
      });
      purchase({
        userId: studentB.id,
        courseId: otherCourse.id,
        pricePaidCents: 1000,
        createdAt: "2026-06-03T00:00:00.000Z",
      });

      const series = getPlatformRevenueTrend({
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

    it("buckets monthly with zero-revenue months filled as $0 over all-time", () => {
      purchase({
        userId: base.user.id,
        courseId: base.course.id,
        pricePaidCents: 5000,
        createdAt: "2026-04-15T00:00:00.000Z",
      });
      purchase({
        userId: base.user.id,
        courseId: base.course.id,
        pricePaidCents: 2500,
        createdAt: "2026-06-10T00:00:00.000Z",
      });

      const series = getPlatformRevenueTrend({
        since: null,
        until: "2026-06-30T00:00:00.000Z",
        granularity: "monthly",
      });

      expect(series).toEqual([
        { bucket: "2026-04", value: 5000 },
        { bucket: "2026-05", value: 0 },
        { bucket: "2026-06", value: 2500 },
      ]);
    });

    it("returns an empty series for a window with no purchases", () => {
      const series = getPlatformRevenueTrend({
        since: "2026-06-01T00:00:00.000Z",
        until: "2026-06-05T00:00:00.000Z",
        granularity: "daily",
      });

      expect(series).toEqual([]);
    });
  });

  describe("getPlatformInstructors", () => {
    it("returns only instructors who own at least one course, sorted by name", () => {
      // base.instructor owns base.course. Add one more instructor with a
      // course and one instructor with no courses.
      const withCourse = createInstructor("aaron@example.com");
      createCourse({ instructorId: withCourse.id, slug: "aaron-course" });
      createInstructor("zoe-no-courses@example.com");

      const instructors = getPlatformInstructors();

      expect(instructors).toEqual([
        { id: withCourse.id, name: "Instructor aaron@example.com" },
        { id: base.instructor.id, name: "Test Instructor" },
      ]);
    });
  });

  describe("getPlatformCourseBreakdown", () => {
    it("aggregates revenue, sales, enrollments, price and rating per course across instructors, ranked by revenue", () => {
      const otherInstructor = createInstructor("other@example.com");
      const otherCourse = createCourse({
        instructorId: otherInstructor.id,
        slug: "other-course",
        price: 9900,
      });
      const studentA = createStudent("a@example.com");
      const studentB = createStudent("b@example.com");

      // base.course: one $49 sale, one enrollment, ratings 4 and 2 → avg 3.
      purchase({
        userId: studentA.id,
        courseId: base.course.id,
        pricePaidCents: 4900,
      });
      enroll({ userId: studentA.id, courseId: base.course.id });
      review({ userId: studentA.id, courseId: base.course.id, rating: 4 });
      review({ userId: studentB.id, courseId: base.course.id, rating: 2 });

      // otherCourse: two sales totalling $198, two enrollments, no ratings.
      purchase({
        userId: studentA.id,
        courseId: otherCourse.id,
        pricePaidCents: 9900,
      });
      purchase({
        userId: studentB.id,
        courseId: otherCourse.id,
        pricePaidCents: 9900,
      });
      enroll({ userId: studentA.id, courseId: otherCourse.id });
      enroll({ userId: studentB.id, courseId: otherCourse.id });

      const rows = getPlatformCourseBreakdown({ since: null });

      expect(rows).toEqual([
        {
          courseId: otherCourse.id,
          title: "Course other-course",
          instructorName: "Instructor other@example.com",
          listPriceCents: 9900,
          revenueCents: 19800,
          salesCount: 2,
          enrollmentCount: 2,
          avgRating: null,
        },
        {
          courseId: base.course.id,
          title: "Test Course",
          instructorName: "Test Instructor",
          listPriceCents: 0,
          revenueCents: 4900,
          salesCount: 1,
          enrollmentCount: 1,
          avgRating: 3,
        },
      ]);
    });

    it("includes courses with no activity as zero rows with a null rating", () => {
      const rows = getPlatformCourseBreakdown({ since: null });

      expect(rows).toEqual([
        {
          courseId: base.course.id,
          title: "Test Course",
          instructorName: "Test Instructor",
          listPriceCents: 0,
          revenueCents: 0,
          salesCount: 0,
          enrollmentCount: 0,
          avgRating: null,
        },
      ]);
    });

    it("counts only revenue, sales and enrollments within the period", () => {
      const student = createStudent("a@example.com");
      // Inside the window.
      purchase({
        userId: student.id,
        courseId: base.course.id,
        pricePaidCents: 4900,
        createdAt: "2026-06-10T00:00:00.000Z",
      });
      enroll({
        userId: student.id,
        courseId: base.course.id,
        enrolledAt: "2026-06-10T00:00:00.000Z",
      });
      // Before the window — excluded.
      purchase({
        userId: student.id,
        courseId: base.course.id,
        pricePaidCents: 9900,
        createdAt: "2026-05-01T00:00:00.000Z",
      });
      enroll({
        userId: student.id,
        courseId: base.course.id,
        enrolledAt: "2026-05-01T00:00:00.000Z",
      });

      const rows = getPlatformCourseBreakdown({
        since: "2026-06-01T00:00:00.000Z",
      });

      expect(rows[0].revenueCents).toBe(4900);
      expect(rows[0].salesCount).toBe(1);
      expect(rows[0].enrollmentCount).toBe(1);
    });

    it("limits to one instructor's courses when instructorId is given", () => {
      const otherInstructor = createInstructor("other@example.com");
      const otherCourse = createCourse({
        instructorId: otherInstructor.id,
        slug: "other-course",
      });

      const rows = getPlatformCourseBreakdown({
        since: null,
        instructorId: otherInstructor.id,
      });

      expect(rows.map((r) => r.courseId)).toEqual([otherCourse.id]);
    });
  });

  describe("getCourseFunnel", () => {
    it("counts enrolled, started, and completed including enrolled-but-never-started students", () => {
      const lesson = createLessonInCourse({ courseId: base.course.id });
      const studentB = createStudent("b@example.com");
      const studentC = createStudent("c@example.com");
      // base.user completed; studentB started but unfinished; studentC never started.
      enroll({
        userId: base.user.id,
        courseId: base.course.id,
        completedAt: "2026-06-01T00:00:00.000Z",
      });
      recordProgress({ userId: base.user.id, lessonId: lesson.id });
      enroll({ userId: studentB.id, courseId: base.course.id });
      recordProgress({ userId: studentB.id, lessonId: lesson.id });
      enroll({ userId: studentC.id, courseId: base.course.id });

      const funnel = getCourseFunnel({ courseId: base.course.id });

      expect(funnel).toEqual({
        enrolledCount: 3,
        startedCount: 2,
        completedCount: 1,
      });
    });

    it("counts a student with progress on several lessons as started once", () => {
      const module = testDb
        .insert(schema.modules)
        .values({ courseId: base.course.id, title: "Module", position: 1 })
        .returning()
        .get();
      const [lessonA, lessonB] = [1, 2].map((position) =>
        testDb
          .insert(schema.lessons)
          .values({
            moduleId: module.id,
            title: `Lesson ${position}`,
            position,
          })
          .returning()
          .get()
      );
      enroll({ userId: base.user.id, courseId: base.course.id });
      recordProgress({ userId: base.user.id, lessonId: lessonA.id });
      recordProgress({ userId: base.user.id, lessonId: lessonB.id });

      const funnel = getCourseFunnel({ courseId: base.course.id });

      expect(funnel).toEqual({
        enrolledCount: 1,
        startedCount: 1,
        completedCount: 0,
      });
    });

    it("ignores progress on another course's lessons", () => {
      const other = createCourse({
        instructorId: base.instructor.id,
        slug: "other-course",
      });
      const otherLesson = createLessonInCourse({ courseId: other.id });
      enroll({ userId: base.user.id, courseId: base.course.id });
      recordProgress({ userId: base.user.id, lessonId: otherLesson.id });

      const funnel = getCourseFunnel({ courseId: base.course.id });

      expect(funnel).toEqual({
        enrolledCount: 1,
        startedCount: 0,
        completedCount: 0,
      });
    });

    it("ignores lesson progress from users not enrolled in the course", () => {
      const lesson = createLessonInCourse({ courseId: base.course.id });
      const browser = createStudent("browser@example.com");
      enroll({ userId: base.user.id, courseId: base.course.id });
      // Progress without an enrollment (e.g. enrollment later removed).
      recordProgress({ userId: browser.id, lessonId: lesson.id });

      const funnel = getCourseFunnel({ courseId: base.course.id });

      expect(funnel).toEqual({
        enrolledCount: 1,
        startedCount: 0,
        completedCount: 0,
      });
    });

    it("returns zeros for a course with no enrollments", () => {
      const funnel = getCourseFunnel({ courseId: base.course.id });

      expect(funnel).toEqual({
        enrolledCount: 0,
        startedCount: 0,
        completedCount: 0,
      });
    });
  });

  describe("getLessonFunnel", () => {
    it("lists lessons in course order with completion counts and retention rates", () => {
      // Insert the later module first so ordering must come from positions,
      // not insertion order.
      const [lessonC] = createModuleWithLessons({
        courseId: base.course.id,
        modulePosition: 2,
        lessonCount: 1,
      });
      const [lessonA, lessonB] = createModuleWithLessons({
        courseId: base.course.id,
        modulePosition: 1,
        lessonCount: 2,
      });
      const [s1, s2, s3, s4] = enrollStudents({
        courseId: base.course.id,
        count: 4,
      });
      for (const student of [s1, s2, s3, s4]) {
        completeLesson({ userId: student.id, lessonId: lessonA.id });
      }
      for (const student of [s1, s2]) {
        completeLesson({ userId: student.id, lessonId: lessonB.id });
      }
      completeLesson({ userId: s1.id, lessonId: lessonC.id });

      const funnel = getLessonFunnel({ courseId: base.course.id });

      expect(funnel).toEqual([
        {
          lessonId: lessonA.id,
          lessonTitle: "Lesson 1.1",
          moduleTitle: "Module 1",
          completedCount: 4,
          retentionRate: null,
          isBiggestDropoff: false,
          isLowRetention: false,
        },
        {
          lessonId: lessonB.id,
          lessonTitle: "Lesson 1.2",
          moduleTitle: "Module 1",
          completedCount: 2,
          retentionRate: 0.5,
          // Ties on worst retention go to the earliest step.
          isBiggestDropoff: true,
          isLowRetention: false, // only 4 completed the prior lesson — below sample size
        },
        {
          lessonId: lessonC.id,
          lessonTitle: "Lesson 2.1",
          moduleTitle: "Module 2",
          completedCount: 1,
          retentionRate: 0.5,
          isBiggestDropoff: false,
          isLowRetention: false,
        },
      ]);
    });

    it("counts only completed progress from enrolled students", () => {
      const [lesson] = createModuleWithLessons({
        courseId: base.course.id,
        modulePosition: 1,
        lessonCount: 1,
      });
      const [enrolled] = enrollStudents({ courseId: base.course.id, count: 1 });
      completeLesson({ userId: enrolled.id, lessonId: lesson.id });
      // In-progress is "started", not "completed".
      recordProgress({ userId: base.user.id, lessonId: lesson.id });
      // Completion without an enrollment doesn't count.
      const browser = createStudent("browser@example.com");
      completeLesson({ userId: browser.id, lessonId: lesson.id });

      const funnel = getLessonFunnel({ courseId: base.course.id });

      expect(funnel.map((step) => step.completedCount)).toEqual([1]);
    });

    it("treats a skipped lesson as the stop point's gap: zero count, then undefined retention", () => {
      const [lesson1, , lesson3] = createModuleWithLessons({
        courseId: base.course.id,
        modulePosition: 1,
        lessonCount: 3,
      });
      const [student] = enrollStudents({ courseId: base.course.id, count: 1 });
      // Stop point = furthest completed lesson (lesson 3); lesson 2 skipped.
      completeLesson({ userId: student.id, lessonId: lesson1.id });
      completeLesson({ userId: student.id, lessonId: lesson3.id });

      const funnel = getLessonFunnel({ courseId: base.course.id });

      expect(
        funnel.map(({ completedCount, retentionRate }) => ({
          completedCount,
          retentionRate,
        }))
      ).toEqual([
        { completedCount: 1, retentionRate: null },
        { completedCount: 0, retentionRate: 0 },
        // Nobody completed lesson 2, so lesson 3 has no one to retain from.
        { completedCount: 1, retentionRate: null },
      ]);
    });

    it("flags only the single worst retention step as the biggest drop-off", () => {
      const lessons = createModuleWithLessons({
        courseId: base.course.id,
        modulePosition: 1,
        lessonCount: 4,
      });
      const [s1, s2, s3, s4] = enrollStudents({
        courseId: base.course.id,
        count: 4,
      });
      // Completions 4 → 3 → 1 → 1: retentions 75%, 33%, 100%.
      for (const student of [s1, s2, s3, s4]) {
        completeLesson({ userId: student.id, lessonId: lessons[0].id });
      }
      for (const student of [s1, s2, s3]) {
        completeLesson({ userId: student.id, lessonId: lessons[1].id });
      }
      completeLesson({ userId: s1.id, lessonId: lessons[2].id });
      completeLesson({ userId: s1.id, lessonId: lessons[3].id });

      const funnel = getLessonFunnel({ courseId: base.course.id });

      expect(funnel.map((step) => step.isBiggestDropoff)).toEqual([
        false,
        false,
        true,
        false,
      ]);
    });

    it("flags no biggest drop-off when no lesson loses students", () => {
      const lessons = createModuleWithLessons({
        courseId: base.course.id,
        modulePosition: 1,
        lessonCount: 2,
      });
      const students = enrollStudents({ courseId: base.course.id, count: 2 });
      for (const student of students) {
        for (const lesson of lessons) {
          completeLesson({ userId: student.id, lessonId: lesson.id });
        }
      }

      const funnel = getLessonFunnel({ courseId: base.course.id });

      expect(funnel.map((step) => step.isBiggestDropoff)).toEqual([
        false,
        false,
      ]);
    });

    it("surfaces a low-retention insight at the 50% threshold with enough prior completions", () => {
      const [lesson1, lesson2] = createModuleWithLessons({
        courseId: base.course.id,
        modulePosition: 1,
        lessonCount: 2,
      });
      const students = enrollStudents({ courseId: base.course.id, count: 6 });
      for (const student of students) {
        completeLesson({ userId: student.id, lessonId: lesson1.id });
      }
      // Exactly half retained from exactly-enough prior completions.
      for (const student of students.slice(0, 3)) {
        completeLesson({ userId: student.id, lessonId: lesson2.id });
      }

      const funnel = getLessonFunnel({ courseId: base.course.id });

      expect(funnel.map((step) => step.isLowRetention)).toEqual([false, true]);
    });

    it("does not flag low retention below the minimum sample size", () => {
      const [lesson1, lesson2] = createModuleWithLessons({
        courseId: base.course.id,
        modulePosition: 1,
        lessonCount: 2,
      });
      const students = enrollStudents({ courseId: base.course.id, count: 4 });
      for (const student of students) {
        completeLesson({ userId: student.id, lessonId: lesson1.id });
      }
      // 25% retention, but only 4 students completed the prior lesson.
      completeLesson({ userId: students[0].id, lessonId: lesson2.id });

      const funnel = getLessonFunnel({ courseId: base.course.id });

      expect(funnel.map((step) => step.isLowRetention)).toEqual([false, false]);
    });

    it("does not flag retention above the 50% threshold", () => {
      const [lesson1, lesson2] = createModuleWithLessons({
        courseId: base.course.id,
        modulePosition: 1,
        lessonCount: 2,
      });
      const students = enrollStudents({ courseId: base.course.id, count: 6 });
      for (const student of students) {
        completeLesson({ userId: student.id, lessonId: lesson1.id });
      }
      for (const student of students.slice(0, 4)) {
        completeLesson({ userId: student.id, lessonId: lesson2.id });
      }

      const funnel = getLessonFunnel({ courseId: base.course.id });

      expect(funnel.map((step) => step.isLowRetention)).toEqual([false, false]);
    });

    it("counts a student once per lesson despite duplicate progress rows", () => {
      const [lesson] = createModuleWithLessons({
        courseId: base.course.id,
        modulePosition: 1,
        lessonCount: 1,
      });
      const [student] = enrollStudents({ courseId: base.course.id, count: 1 });
      completeLesson({ userId: student.id, lessonId: lesson.id });
      completeLesson({ userId: student.id, lessonId: lesson.id });

      const funnel = getLessonFunnel({ courseId: base.course.id });

      expect(funnel.map((step) => step.completedCount)).toEqual([1]);
    });

    it("returns an empty array for a course with no lessons", () => {
      enrollStudents({ courseId: base.course.id, count: 1 });

      expect(getLessonFunnel({ courseId: base.course.id })).toEqual([]);
    });

    it("returns zero counts with no flags when nobody completed any lesson", () => {
      createModuleWithLessons({
        courseId: base.course.id,
        modulePosition: 1,
        lessonCount: 2,
      });
      const [student] = enrollStudents({ courseId: base.course.id, count: 1 });
      const [lesson] = testDb.select().from(schema.lessons).all();
      recordProgress({ userId: student.id, lessonId: lesson.id });

      const funnel = getLessonFunnel({ courseId: base.course.id });

      expect(
        funnel.map(
          ({
            completedCount,
            retentionRate,
            isBiggestDropoff,
            isLowRetention,
          }) => ({
            completedCount,
            retentionRate,
            isBiggestDropoff,
            isLowRetention,
          })
        )
      ).toEqual([
        {
          completedCount: 0,
          retentionRate: null,
          isBiggestDropoff: false,
          isLowRetention: false,
        },
        {
          completedCount: 0,
          retentionRate: null,
          isBiggestDropoff: false,
          isLowRetention: false,
        },
      ]);
    });
  });

  describe("getCompletionTrend", () => {
    it("buckets completions per day with zero-filled gaps through the window end", () => {
      const studentB = createStudent("b@example.com");
      const studentC = createStudent("c@example.com");
      enroll({
        userId: base.user.id,
        courseId: base.course.id,
        completedAt: "2026-06-01T08:00:00.000Z",
      });
      enroll({
        userId: studentB.id,
        courseId: base.course.id,
        completedAt: "2026-06-01T20:00:00.000Z",
      });
      enroll({
        userId: studentC.id,
        courseId: base.course.id,
        completedAt: "2026-06-03T12:00:00.000Z",
      });

      const series = getCompletionTrend({
        courseId: base.course.id,
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

    it("filters by completion date, ignoring unfinished and pre-window completions", () => {
      const studentB = createStudent("b@example.com");
      const studentC = createStudent("c@example.com");
      enroll({
        userId: base.user.id,
        courseId: base.course.id,
        enrolledAt: "2026-06-02T00:00:00.000Z", // enrolled inside, never completed
      });
      enroll({
        userId: studentB.id,
        courseId: base.course.id,
        completedAt: "2026-05-20T00:00:00.000Z", // completed before the window
      });
      enroll({
        userId: studentC.id,
        courseId: base.course.id,
        enrolledAt: "2026-05-01T00:00:00.000Z", // enrolled before, completed inside
        completedAt: "2026-06-02T00:00:00.000Z",
      });

      const series = getCompletionTrend({
        courseId: base.course.id,
        since: "2026-06-01T00:00:00.000Z",
        until: "2026-06-02T00:00:00.000Z",
        granularity: "daily",
      });

      expect(series).toEqual([
        { bucket: "2026-06-01", value: 0 },
        { bucket: "2026-06-02", value: 1 },
      ]);
    });

    it("excludes completions on other courses", () => {
      const other = createCourse({
        instructorId: base.instructor.id,
        slug: "other-course",
      });
      enroll({
        userId: base.user.id,
        courseId: other.id,
        completedAt: "2026-06-02T00:00:00.000Z",
      });

      const series = getCompletionTrend({
        courseId: base.course.id,
        since: "2026-06-01T00:00:00.000Z",
        until: "2026-06-05T00:00:00.000Z",
        granularity: "daily",
      });

      expect(series).toEqual([]);
    });

    it("returns an empty series for a window with no completions", () => {
      enroll({ userId: base.user.id, courseId: base.course.id });

      const series = getCompletionTrend({
        courseId: base.course.id,
        since: "2026-06-01T00:00:00.000Z",
        until: "2026-06-05T00:00:00.000Z",
        granularity: "daily",
      });

      expect(series).toEqual([]);
    });
  });

  describe("getQuizPerformance", () => {
    it("computes first-attempt averages at course, module, and lesson altitude", () => {
      // Insert module 2 first so order must come from positions, not rowid.
      const [lessonC] = createModuleWithLessons({
        courseId: base.course.id,
        modulePosition: 2,
        lessonCount: 1,
      });
      const [lessonA, lessonB] = createModuleWithLessons({
        courseId: base.course.id,
        modulePosition: 1,
        lessonCount: 2,
      });
      const quizA = createQuiz({ lessonId: lessonA.id });
      const quizB = createQuiz({ lessonId: lessonB.id });
      const quizC = createQuiz({ lessonId: lessonC.id });
      const [s1, s2, s3] = enrollStudents({
        courseId: base.course.id,
        count: 3,
      });

      attemptQuiz({ userId: s1.id, quizId: quizA.id, score: 1.0 });
      attemptQuiz({ userId: s2.id, quizId: quizA.id, score: 0.0 });
      attemptQuiz({ userId: s1.id, quizId: quizB.id, score: 0.8 });
      attemptQuiz({ userId: s1.id, quizId: quizC.id, score: 0.4 });
      attemptQuiz({ userId: s2.id, quizId: quizC.id, score: 0.6 });
      attemptQuiz({ userId: s3.id, quizId: quizC.id, score: 0.5 });

      const perf = getQuizPerformance({ courseId: base.course.id });

      // Course: (1.0 + 0.0 + 0.8 + 0.4 + 0.6 + 0.5) / 6 = 0.55
      expect(perf.quizCount).toBe(3);
      expect(perf.attemptCount).toBe(6);
      expect(perf.avgScore).toBeCloseTo(0.55, 10);

      const [module1, module2] = perf.modules;
      // Module 1 = quizA + quizB attempts: (1.0 + 0.0 + 0.8) / 3 = 0.6
      expect(module1.moduleTitle).toBe("Module 1");
      expect(module1.studentCount).toBe(3);
      expect(module1.avgScore).toBeCloseTo(0.6, 10);
      // Module 2 = quizC: (0.4 + 0.6 + 0.5) / 3 = 0.5
      expect(module2.moduleTitle).toBe("Module 2");
      expect(module2.avgScore).toBeCloseTo(0.5, 10);

      const [lessonStatsA, lessonStatsB] = module1.lessons;
      expect(lessonStatsA.avgScore).toBeCloseTo(0.5, 10); // (1.0 + 0.0) / 2
      expect(lessonStatsA.studentCount).toBe(2);
      expect(lessonStatsB.avgScore).toBeCloseTo(0.8, 10); // single attempt
      expect(lessonStatsB.studentCount).toBe(1);

      // Quiz-level average rides along on the quiz stats.
      expect(lessonStatsA.quizzes[0].avgScore).toBeCloseTo(0.5, 10);
    });

    it("uses each student's earliest attempt, ignoring retries", () => {
      const [lesson] = createModuleWithLessons({
        courseId: base.course.id,
        modulePosition: 1,
        lessonCount: 1,
      });
      const quiz = createQuiz({ lessonId: lesson.id });
      const [student] = enrollStudents({ courseId: base.course.id, count: 1 });

      // Later retry scores higher, but only the first attempt counts.
      attemptQuiz({
        userId: student.id,
        quizId: quiz.id,
        score: 0.3,
        passed: false,
        attemptedAt: "2026-06-01T00:00:00.000Z",
      });
      attemptQuiz({
        userId: student.id,
        quizId: quiz.id,
        score: 0.9,
        passed: true,
        attemptedAt: "2026-06-02T00:00:00.000Z",
      });

      const perf = getQuizPerformance({ courseId: base.course.id });

      expect(perf.attemptCount).toBe(1);
      expect(perf.avgScore).toBeCloseTo(0.3, 10);
      const quizStats = perf.modules[0].lessons[0].quizzes[0];
      expect(quizStats.studentCount).toBe(1);
      expect(quizStats.failRate).toBe(1); // the first attempt failed
    });

    it("buckets first-attempt scores into ten deciles, folding a perfect score into the top", () => {
      const [lesson] = createModuleWithLessons({
        courseId: base.course.id,
        modulePosition: 1,
        lessonCount: 1,
      });
      const quiz = createQuiz({ lessonId: lesson.id });
      const [s1, s2, s3, s4] = enrollStudents({
        courseId: base.course.id,
        count: 4,
      });
      attemptQuiz({ userId: s1.id, quizId: quiz.id, score: 0.0 });
      attemptQuiz({ userId: s2.id, quizId: quiz.id, score: 0.45 });
      attemptQuiz({ userId: s3.id, quizId: quiz.id, score: 0.95 });
      attemptQuiz({ userId: s4.id, quizId: quiz.id, score: 1.0 });

      const perf = getQuizPerformance({ courseId: base.course.id });

      // 0.0→[0], 0.45→[4], 0.95→[9], 1.0→[9] (folded).
      const expected = [1, 0, 0, 0, 1, 0, 0, 0, 0, 2];
      expect(perf.distribution).toEqual(expected);
      expect(perf.modules[0].lessons[0].quizzes[0].distribution).toEqual(
        expected
      );
    });

    it("flags a quiz at the failure-rate and sample-size boundaries, but never below sample size", () => {
      const [highFail, edgeRate, tooFew, lowFail] = createModuleWithLessons({
        courseId: base.course.id,
        modulePosition: 1,
        lessonCount: 4,
      });
      const quizHighFail = createQuiz({ lessonId: highFail.id });
      const quizEdgeRate = createQuiz({ lessonId: edgeRate.id });
      const quizTooFew = createQuiz({ lessonId: tooFew.id });
      const quizLowFail = createQuiz({ lessonId: lowFail.id });

      const students = Array.from({ length: 6 }, (_, i) =>
        createStudent(`quiz-student-${i}@example.com`)
      );

      // Exactly 5 students, 3 fail → failRate 0.6 ≥ 0.5: flagged (sample-size edge).
      students.slice(0, 5).forEach((s, i) => {
        attemptQuiz({
          userId: s.id,
          quizId: quizHighFail.id,
          score: i < 3 ? 0.2 : 0.9,
          passed: i >= 3,
        });
      });

      // 6 students, exactly 3 fail → failRate exactly 0.5: flagged (rate edge, inclusive).
      students.forEach((s, i) => {
        attemptQuiz({
          userId: s.id,
          quizId: quizEdgeRate.id,
          score: i < 3 ? 0.2 : 0.9,
          passed: i >= 3,
        });
      });

      // Only 4 students, all fail → failRate 1.0 but below the 5-student floor: not flagged.
      students.slice(0, 4).forEach((s) => {
        attemptQuiz({
          userId: s.id,
          quizId: quizTooFew.id,
          score: 0.1,
          passed: false,
        });
      });

      // 6 students, 2 fail → failRate ≈ 0.33 < 0.5: not flagged.
      students.forEach((s, i) => {
        attemptQuiz({
          userId: s.id,
          quizId: quizLowFail.id,
          score: i < 2 ? 0.2 : 0.9,
          passed: i >= 2,
        });
      });

      const perf = getQuizPerformance({ courseId: base.course.id });

      const flaggedIds = perf.flaggedQuizzes.map((q) => q.quizId).sort();
      expect(flaggedIds).toEqual([quizHighFail.id, quizEdgeRate.id].sort());

      const byId = new Map(
        perf.modules
          .flatMap((m) => m.lessons)
          .flatMap((l) => l.quizzes)
          .map((q) => [q.quizId, q])
      );
      expect(byId.get(quizHighFail.id)!.isHighFailure).toBe(true);
      expect(byId.get(quizEdgeRate.id)!.failRate).toBeCloseTo(0.5, 10);
      expect(byId.get(quizEdgeRate.id)!.isHighFailure).toBe(true);
      expect(byId.get(quizTooFew.id)!.isHighFailure).toBe(false);
      expect(byId.get(quizLowFail.id)!.isHighFailure).toBe(false);
    });

    it("includes never-attempted quizzes with null stats, not flagged", () => {
      const [lesson] = createModuleWithLessons({
        courseId: base.course.id,
        modulePosition: 1,
        lessonCount: 1,
      });
      createQuiz({ lessonId: lesson.id });

      const perf = getQuizPerformance({ courseId: base.course.id });

      expect(perf.quizCount).toBe(1);
      expect(perf.attemptCount).toBe(0);
      expect(perf.avgScore).toBeNull();
      expect(perf.flaggedQuizzes).toEqual([]);
      const quizStats = perf.modules[0].lessons[0].quizzes[0];
      expect(quizStats.studentCount).toBe(0);
      expect(quizStats.avgScore).toBeNull();
      expect(quizStats.failRate).toBeNull();
      expect(quizStats.isHighFailure).toBe(false);
      expect(quizStats.distribution).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    });

    it("returns an empty, non-broken result for a course with no quizzes", () => {
      createModuleWithLessons({
        courseId: base.course.id,
        modulePosition: 1,
        lessonCount: 2,
      });

      const perf = getQuizPerformance({ courseId: base.course.id });

      expect(perf).toEqual({
        quizCount: 0,
        avgScore: null,
        attemptCount: 0,
        distribution: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
        flaggedQuizzes: [],
        modules: [],
      });
    });

    it("does not count quizzes from another course", () => {
      const other = createCourse({
        instructorId: base.instructor.id,
        slug: "other-quiz-course",
      });
      const [otherLesson] = createModuleWithLessons({
        courseId: other.id,
        modulePosition: 1,
        lessonCount: 1,
      });
      const otherQuiz = createQuiz({ lessonId: otherLesson.id });
      const [student] = enrollStudents({ courseId: other.id, count: 1 });
      attemptQuiz({ userId: student.id, quizId: otherQuiz.id, score: 0.5 });

      const perf = getQuizPerformance({ courseId: base.course.id });

      expect(perf.quizCount).toBe(0);
      expect(perf.modules).toEqual([]);
    });
  });

  describe("getPlatformOverviewStats", () => {
    it("aggregates revenue and enrollments across all instructors", () => {
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
      const studentB = createStudent("b@example.com");
      enroll({ userId: base.user.id, courseId: base.course.id });
      enroll({ userId: studentB.id, courseId: otherCourse.id });
      purchase({
        userId: base.user.id,
        courseId: base.course.id,
        pricePaidCents: 4900,
      });
      purchase({
        userId: studentB.id,
        courseId: otherCourse.id,
        pricePaidCents: 9900,
      });

      const stats = getPlatformOverviewStats({ since: null });

      expect(stats).toMatchObject({
        totalRevenueCents: 14800,
        totalEnrollments: 2,
      });
    });

    it("identifies the top earning course", () => {
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
      });
      purchase({
        userId: base.user.id,
        courseId: otherCourse.id,
        pricePaidCents: 9900,
      });

      const stats = getPlatformOverviewStats({ since: null });

      expect(stats.topCourse).toEqual({
        title: otherCourse.title,
        revenueCents: 9900,
      });
    });

    it("returns null topCourse when there are no purchases", () => {
      enroll({ userId: base.user.id, courseId: base.course.id });

      const stats = getPlatformOverviewStats({ since: null });

      expect(stats).toEqual({
        totalRevenueCents: 0,
        totalEnrollments: 1,
        topCourse: null,
      });
    });

    it("returns zeros when the platform has no data", () => {
      const stats = getPlatformOverviewStats({ since: null });

      expect(stats).toEqual({
        totalRevenueCents: 0,
        totalEnrollments: 0,
        topCourse: null,
      });
    });

    it("respects the time period filter", () => {
      const studentB = createStudent("b@example.com");
      enroll({
        userId: base.user.id,
        courseId: base.course.id,
        enrolledAt: "2026-01-15T00:00:00.000Z",
      });
      enroll({
        userId: studentB.id,
        courseId: base.course.id,
        enrolledAt: "2026-05-20T00:00:00.000Z",
      });
      purchase({
        userId: base.user.id,
        courseId: base.course.id,
        pricePaidCents: 4900,
        createdAt: "2026-01-15T00:00:00.000Z",
      });
      purchase({
        userId: studentB.id,
        courseId: base.course.id,
        pricePaidCents: 9900,
        createdAt: "2026-05-20T00:00:00.000Z",
      });

      const stats = getPlatformOverviewStats({
        since: "2026-05-01T00:00:00.000Z",
      });

      expect(stats).toEqual({
        totalRevenueCents: 9900,
        totalEnrollments: 1,
        topCourse: {
          title: base.course.title,
          revenueCents: 9900,
        },
      });
    });

    it("picks the correct top course when filtered by time period", () => {
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
        pricePaidCents: 50000,
        createdAt: "2026-01-15T00:00:00.000Z",
      });
      purchase({
        userId: base.user.id,
        courseId: otherCourse.id,
        pricePaidCents: 1000,
        createdAt: "2026-05-20T00:00:00.000Z",
      });

      const stats = getPlatformOverviewStats({
        since: "2026-05-01T00:00:00.000Z",
      });

      expect(stats.topCourse).toEqual({
        title: otherCourse.title,
        revenueCents: 1000,
      });
    });
  });
});

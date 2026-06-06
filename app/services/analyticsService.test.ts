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
import { getCourseStats, getOverviewStats } from "./analyticsService";

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

function enroll(opts: { userId: number; courseId: number; completedAt?: string }) {
  return testDb.insert(schema.enrollments).values(opts).returning().get();
}

function purchase(opts: { userId: number; courseId: number; pricePaidCents: number }) {
  return testDb
    .insert(schema.purchases)
    .values({
      userId: opts.userId,
      courseId: opts.courseId,
      pricePaid: opts.pricePaidCents,
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

      const stats = getOverviewStats({ instructorId: base.instructor.id });

      expect(stats).toMatchObject({ courseCount: 2, totalEnrollments: 3 });
    });

    it("counts a zero-enrollment course without skewing the enrollment total", () => {
      createCourse({
        instructorId: base.instructor.id,
        slug: "empty-course",
        status: schema.CourseStatus.Draft,
      });
      enroll({ userId: base.user.id, courseId: base.course.id });

      const stats = getOverviewStats({ instructorId: base.instructor.id });

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

      const stats = getOverviewStats({ instructorId: base.instructor.id });

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

      const stats = getOverviewStats({ instructorId: newInstructor.id });

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

      const stats = getOverviewStats({ instructorId: base.instructor.id });

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

      const stats = getOverviewStats({ instructorId: base.instructor.id });

      expect(stats).toMatchObject({
        totalEnrollments: 3,
        grossEarningsCents: 30000,
        avgRevenuePerStudentCents: 10000,
      });
    });

    it("reports zero average revenue per student when all enrollments are free", () => {
      enroll({ userId: base.user.id, courseId: base.course.id });

      const stats = getOverviewStats({ instructorId: base.instructor.id });

      expect(stats).toMatchObject({
        totalEnrollments: 1,
        grossEarningsCents: 0,
        avgRevenuePerStudentCents: 0,
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
});

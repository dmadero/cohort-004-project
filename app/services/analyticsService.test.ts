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
import { getOverviewStats } from "./analyticsService";

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

function enroll(opts: { userId: number; courseId: number }) {
  return testDb.insert(schema.enrollments).values(opts).returning().get();
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

      expect(stats).toEqual({ courseCount: 2, totalEnrollments: 3 });
    });

    it("counts a zero-enrollment course without skewing the enrollment total", () => {
      createCourse({
        instructorId: base.instructor.id,
        slug: "empty-course",
        status: schema.CourseStatus.Draft,
      });
      enroll({ userId: base.user.id, courseId: base.course.id });

      const stats = getOverviewStats({ instructorId: base.instructor.id });

      expect(stats).toEqual({ courseCount: 2, totalEnrollments: 1 });
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

      const stats = getOverviewStats({ instructorId: base.instructor.id });

      expect(stats).toEqual({ courseCount: 1, totalEnrollments: 0 });
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

      expect(stats).toEqual({ courseCount: 0, totalEnrollments: 0 });
    });
  });
});

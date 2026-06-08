import { eq, and, sql } from "drizzle-orm";
import { db } from "~/db";
import {
  enrollments,
  courses,
  modules,
  lessons,
  lessonProgress,
  users,
  LessonProgressStatus,
  NotificationType,
} from "~/db/schema";
import { createNotification } from "~/services/notificationService";

// ─── Enrollment Service ───
// Handles enrollment, unenrollment, duplicate prevention, and enrollment validation.

export function getEnrollmentById(id: number) {
  return db.select().from(enrollments).where(eq(enrollments.id, id)).get();
}

export function getEnrollmentsByUser(userId: number) {
  return db
    .select()
    .from(enrollments)
    .where(eq(enrollments.userId, userId))
    .all();
}

export function getEnrollmentsByCourse(courseId: number) {
  return db
    .select()
    .from(enrollments)
    .where(eq(enrollments.courseId, courseId))
    .all();
}

export function getEnrollmentCountForCourse(courseId: number) {
  const result = db
    .select({ count: sql<number>`count(*)` })
    .from(enrollments)
    .where(eq(enrollments.courseId, courseId))
    .get();

  return result?.count ?? 0;
}

export function findEnrollment(opts: { userId: number; courseId: number }) {
  const { userId, courseId } = opts;
  return db
    .select()
    .from(enrollments)
    .where(
      and(eq(enrollments.userId, userId), eq(enrollments.courseId, courseId))
    )
    .get();
}

export function isUserEnrolled(opts: { userId: number; courseId: number }) {
  const { userId, courseId } = opts;
  return !!findEnrollment({ userId, courseId });
}

export function enrollUser(opts: {
  userId: number;
  courseId: number;
  sendEmail: boolean;
  skipValidation: boolean;
}) {
  const { userId, courseId, sendEmail, skipValidation } = opts;
  if (!skipValidation) {
    // Check if already enrolled
    const existing = findEnrollment({ userId, courseId });
    if (existing) {
      throw new Error("User is already enrolled in this course");
    }

    // Check that the course exists
    const course = db
      .select()
      .from(courses)
      .where(eq(courses.id, courseId))
      .get();
    if (!course) {
      throw new Error("Course not found");
    }
  }

  const enrollment = db
    .insert(enrollments)
    .values({ userId, courseId })
    .returning()
    .get();

  // Notify the course's instructor of the new enrollment. Looked up here
  // (rather than passed in) so every enrollment path stays notified. Guarded
  // so a missing course/student can't fail the enrollment itself.
  const course = db
    .select({ instructorId: courses.instructorId, title: courses.title })
    .from(courses)
    .where(eq(courses.id, courseId))
    .get();
  const student = db
    .select({ name: users.name })
    .from(users)
    .where(eq(users.id, userId))
    .get();
  if (course && student) {
    createNotification({
      recipientUserId: course.instructorId,
      type: NotificationType.Enrollment,
      title: "New Enrollment",
      message: `${student.name} enrolled in ${course.title}`,
      linkUrl: `/instructor/${courseId}/students`,
    });
  }

  // sendEmail parameter accepted but not implemented (no email service — PRD out of scope)
  if (sendEmail) {
    // Would send welcome email here
  }

  return enrollment;
}

export function unenrollUser(opts: { userId: number; courseId: number }) {
  const { userId, courseId } = opts;
  const existing = findEnrollment({ userId, courseId });
  if (!existing) {
    throw new Error("User is not enrolled in this course");
  }

  return db
    .delete(enrollments)
    .where(
      and(eq(enrollments.userId, userId), eq(enrollments.courseId, courseId))
    )
    .returning()
    .get();
}

export function markEnrollmentComplete(opts: {
  userId: number;
  courseId: number;
}) {
  const { userId, courseId } = opts;
  return db
    .update(enrollments)
    .set({ completedAt: new Date().toISOString() })
    .where(
      and(eq(enrollments.userId, userId), eq(enrollments.courseId, courseId))
    )
    .returning()
    .get();
}

export function getUserEnrolledCourses(userId: number) {
  return db
    .select({
      enrollmentId: enrollments.id,
      courseId: enrollments.courseId,
      enrolledAt: enrollments.enrolledAt,
      completedAt: enrollments.completedAt,
      courseTitle: courses.title,
      courseSlug: courses.slug,
      courseDescription: courses.description,
      coverImageUrl: courses.coverImageUrl,
    })
    .from(enrollments)
    .innerJoin(courses, eq(enrollments.courseId, courses.id))
    .where(eq(enrollments.userId, userId))
    .all();
}

export function getCourseEnrolledStudents(courseId: number) {
  return db
    .select({
      enrollmentId: enrollments.id,
      userId: enrollments.userId,
      enrolledAt: enrollments.enrolledAt,
      completedAt: enrollments.completedAt,
    })
    .from(enrollments)
    .where(eq(enrollments.courseId, courseId))
    .all();
}

import Database from "better-sqlite3";
import { inArray, like } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { asc, eq } from "drizzle-orm";
import * as schema from "../app/db/schema";
import { LessonProgressStatus, UserRole } from "../app/db/schema";

// ─── Additive seed: 30 extra students ───
// Appends 30 students to the EXISTING data.db (does not wipe it), splitting
// them across the two instructors' courses with a randomised distribution,
// varied paid amounts, lesson progress, and quiz attempts — enough to exercise
// every section of the instructor analytics dashboards. Re-runnable: it first
// removes any students from a previous run (identified by the @extra.dev email
// domain) and all their dependent rows.

const STUDENT_COUNT = 30;
const EXTRA_EMAIL_DOMAIN = "@extra.dev";

const sqlite = new Database("data.db");
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");
const db = drizzle(sqlite, { schema });

// ─── Deterministic RNG (mulberry32) so a re-run reproduces the same data ───
let rngState = 0x9e3779b9;
function rand(): number {
  rngState |= 0;
  rngState = (rngState + 0x6d2b79f5) | 0;
  let t = Math.imul(rngState ^ (rngState >>> 15), 1 | rngState);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
function randInt(minInclusive: number, maxInclusive: number): number {
  return minInclusive + Math.floor(rand() * (maxInclusive - minInclusive + 1));
}
function pick<T>(items: readonly T[]): T {
  return items[Math.floor(rand() * items.length)];
}
function chance(probability: number): boolean {
  return rand() < probability;
}

function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString();
}

const FIRST_NAMES = [
  "Aisha", "Ben", "Chloe", "Diego", "Elena", "Farid", "Grace", "Hiro",
  "Isla", "Jamal", "Kara", "Leo", "Mei", "Noah", "Omar", "Priya",
  "Quinn", "Rosa", "Sven", "Tara", "Umar", "Vera", "Wes", "Ximena",
  "Yara", "Zane", "Anika", "Bruno", "Carmen", "Dmitri",
];
const LAST_NAMES = [
  "Ahmed", "Brooks", "Costa", "Dubois", "Eriksson", "Fernandez", "Gupta",
  "Haddad", "Ivanov", "Jensen", "Kim", "Lopez", "Müller", "Nakamura",
  "Owens", "Petrov", "Quintero", "Reyes", "Santos", "Tanaka", "Ueda",
  "Vargas", "Wong", "Xu", "Yilmaz", "Zhang", "Andersson", "Bianchi",
  "Cohen", "Delgado",
];

// Paid-amount tiers as a fraction of the course list price, with an optional
// country tag so the data reads like real PPP / sale behaviour.
const PRICE_TIERS = [
  { factor: 1.0, country: "US", weight: 5 }, // full price
  { factor: 1.0, country: "GB", weight: 2 },
  { factor: 0.8, country: "CA", weight: 2 }, // launch sale
  { factor: 0.6, country: "IN", weight: 2 }, // PPP
  { factor: 0.55, country: "BR", weight: 2 }, // PPP
  { factor: 0.5, country: "NG", weight: 1 }, // PPP
];
const WEIGHTED_TIERS = PRICE_TIERS.flatMap((tier) =>
  Array.from({ length: tier.weight }, () => tier)
);

function seed() {
  // ─── Resolve the two instructors' published courses ───
  const courseRows = db
    .select({
      id: schema.courses.id,
      title: schema.courses.title,
      price: schema.courses.price,
      instructorId: schema.courses.instructorId,
    })
    .from(schema.courses)
    .where(eq(schema.courses.status, schema.CourseStatus.Published))
    .orderBy(asc(schema.courses.id))
    .all();

  if (courseRows.length < 2) {
    throw new Error(
      "Expected at least two published courses — run `npm run db:seed` first."
    );
  }
  const [course1, course2] = courseRows;

  // Ordered lesson ids per course (course order = module then lesson position).
  function lessonIdsForCourse(courseId: number): number[] {
    return db
      .select({ id: schema.lessons.id })
      .from(schema.lessons)
      .innerJoin(schema.modules, eq(schema.modules.id, schema.lessons.moduleId))
      .where(eq(schema.modules.courseId, courseId))
      .orderBy(asc(schema.modules.position), asc(schema.lessons.position))
      .all()
      .map((row) => row.id);
  }

  // Quizzes per course, keyed by the lesson they sit on, with their threshold.
  function quizzesForCourse(courseId: number) {
    return db
      .select({
        id: schema.quizzes.id,
        lessonId: schema.quizzes.lessonId,
        passingScore: schema.quizzes.passingScore,
      })
      .from(schema.quizzes)
      .innerJoin(schema.lessons, eq(schema.lessons.id, schema.quizzes.lessonId))
      .innerJoin(schema.modules, eq(schema.modules.id, schema.lessons.moduleId))
      .where(eq(schema.modules.courseId, courseId))
      .all();
  }

  const courseMeta = new Map(
    [course1, course2].map((course) => [
      course.id,
      {
        ...course,
        lessonIds: lessonIdsForCourse(course.id),
        quizzes: quizzesForCourse(course.id),
      },
    ])
  );

  // ─── Idempotency: wipe any prior extra students and their dependent rows ───
  const priorExtras = db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(like(schema.users.email, `%${EXTRA_EMAIL_DOMAIN}`))
    .all()
    .map((row) => row.id);

  if (priorExtras.length > 0) {
    const priorAttempts = db
      .select({ id: schema.quizAttempts.id })
      .from(schema.quizAttempts)
      .where(inArray(schema.quizAttempts.userId, priorExtras))
      .all()
      .map((row) => row.id);
    if (priorAttempts.length > 0) {
      db.delete(schema.quizAnswers)
        .where(inArray(schema.quizAnswers.attemptId, priorAttempts))
        .run();
    }
    db.delete(schema.quizAttempts)
      .where(inArray(schema.quizAttempts.userId, priorExtras))
      .run();
    db.delete(schema.videoWatchEvents)
      .where(inArray(schema.videoWatchEvents.userId, priorExtras))
      .run();
    db.delete(schema.lessonProgress)
      .where(inArray(schema.lessonProgress.userId, priorExtras))
      .run();
    db.delete(schema.purchases)
      .where(inArray(schema.purchases.userId, priorExtras))
      .run();
    db.delete(schema.enrollments)
      .where(inArray(schema.enrollments.userId, priorExtras))
      .run();
    db.delete(schema.users)
      .where(inArray(schema.users.id, priorExtras))
      .run();
    console.log(`Removed ${priorExtras.length} students from a previous run.`);
  }

  // ─── Generate students + activity ───
  let enrollmentCount = 0;
  let purchaseCount = 0;
  let progressRowCount = 0;
  let attemptCount = 0;
  const perCourseEnrollments = new Map<number, number>([
    [course1.id, 0],
    [course2.id, 0],
  ]);

  for (let i = 0; i < STUDENT_COUNT; i++) {
    const first = FIRST_NAMES[i % FIRST_NAMES.length];
    const last = LAST_NAMES[(i * 7) % LAST_NAMES.length];
    const signupDaysAgo = randInt(3, 85);

    const [student] = db
      .insert(schema.users)
      .values({
        name: `${first} ${last}`,
        email: `learner-${String(i + 1).padStart(2, "0")}${EXTRA_EMAIL_DOMAIN}`,
        role: UserRole.Student,
        avatarUrl: `https://api.dicebear.com/9.x/avataaars/svg?seed=extra-${i + 1}`,
        createdAt: daysAgo(signupDaysAgo),
      })
      .returning()
      .all();

    // Random distribution across the two instructors: ~55% course 1, ~45%
    // course 2, with ~20% of students cross-enrolling in the other course too.
    const primary = chance(0.55) ? course1 : course2;
    const enrolledCourseIds = [primary.id];
    if (chance(0.2)) {
      const other = primary.id === course1.id ? course2 : course1;
      enrolledCourseIds.push(other.id);
    }

    for (const courseId of enrolledCourseIds) {
      const meta = courseMeta.get(courseId)!;
      // Enroll some time after signup.
      const enrolledDaysAgo = Math.max(1, signupDaysAgo - randInt(0, 5));

      // How far the student got: a prefix of the lessons. ~15% finish.
      const progressFraction = chance(0.15) ? 1 : rand();
      const completedLessons = Math.floor(progressFraction * meta.lessonIds.length);
      const finishedCourse = completedLessons >= meta.lessonIds.length;

      enrollmentCount++;
      perCourseEnrollments.set(
        courseId,
        (perCourseEnrollments.get(courseId) ?? 0) + 1
      );
      db.insert(schema.enrollments)
        .values({
          userId: student.id,
          courseId,
          enrolledAt: daysAgo(enrolledDaysAgo),
          completedAt: finishedCourse
            ? daysAgo(Math.max(1, enrolledDaysAgo - randInt(3, 20)))
            : null,
        })
        .run();

      // Paid amount: a weighted tier off the list price (rounded to cents).
      const tier = pick(WEIGHTED_TIERS);
      purchaseCount++;
      db.insert(schema.purchases)
        .values({
          userId: student.id,
          courseId,
          pricePaid: Math.round(meta.price * tier.factor),
          country: tier.country,
          createdAt: daysAgo(enrolledDaysAgo),
        })
        .run();

      // Lesson progress: completed prefix, then one in-progress lesson.
      for (let li = 0; li < completedLessons; li++) {
        db.insert(schema.lessonProgress)
          .values({
            userId: student.id,
            lessonId: meta.lessonIds[li],
            status: LessonProgressStatus.Completed,
            completedAt: daysAgo(Math.max(1, enrolledDaysAgo - li)),
          })
          .run();
        progressRowCount++;
      }
      if (!finishedCourse && completedLessons < meta.lessonIds.length) {
        db.insert(schema.lessonProgress)
          .values({
            userId: student.id,
            lessonId: meta.lessonIds[completedLessons],
            status: LessonProgressStatus.InProgress,
          })
          .run();
        progressRowCount++;
      }

      // Quiz attempts: attempt any quiz whose lesson the student has reached.
      const reachedLessonIds = new Set(
        meta.lessonIds.slice(0, completedLessons + 1)
      );
      for (const quiz of meta.quizzes) {
        if (!reachedLessonIds.has(quiz.lessonId)) continue;

        // First-attempt score in [0.2, 1.0], skewed so most pass but a
        // meaningful minority fail — good fodder for the distribution and the
        // high-failure flag.
        const firstScore = Math.round((0.2 + rand() * 0.8) * 100) / 100;
        const firstAttemptDaysAgo = Math.max(
          1,
          enrolledDaysAgo - randInt(0, 3)
        );
        db.insert(schema.quizAttempts)
          .values({
            userId: student.id,
            quizId: quiz.id,
            score: firstScore,
            passed: firstScore >= quiz.passingScore,
            attemptedAt: daysAgo(firstAttemptDaysAgo),
          })
          .run();
        attemptCount++;

        // ~40% of students who failed retake (and usually do better) — only
        // the first attempt counts in analytics, so this exercises that path.
        if (firstScore < quiz.passingScore && chance(0.4)) {
          const retakeScore = Math.min(
            1,
            Math.round((firstScore + 0.2 + rand() * 0.3) * 100) / 100
          );
          db.insert(schema.quizAttempts)
            .values({
              userId: student.id,
              quizId: quiz.id,
              score: retakeScore,
              passed: retakeScore >= quiz.passingScore,
              attemptedAt: daysAgo(Math.max(1, firstAttemptDaysAgo - 1)),
            })
            .run();
          attemptCount++;
        }
      }
    }
  }

  console.log("\n✓ Extra seed complete!");
  console.log(`  Students added: ${STUDENT_COUNT}`);
  console.log(
    `  Enrollments: ${enrollmentCount} ` +
      `(${course1.title}: ${perCourseEnrollments.get(course1.id)}, ` +
      `${course2.title}: ${perCourseEnrollments.get(course2.id)})`
  );
  console.log(`  Purchases: ${purchaseCount}`);
  console.log(`  Lesson progress rows: ${progressRowCount}`);
  console.log(`  Quiz attempts: ${attemptCount}`);
}

seed();

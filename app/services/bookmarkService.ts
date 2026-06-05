import { eq, and } from "drizzle-orm";
import { db } from "~/db";
import { lessonBookmarks, lessons, modules } from "~/db/schema";

// ─── Bookmark Service ───
// Private per-student lesson bookmarks. One bookmark per student per lesson,
// toggled on/off from the lesson page. Persist until manually removed.
// Object parameters — multiple params share the `number` type.

function findBookmark(opts: { userId: number; lessonId: number }) {
  return db
    .select()
    .from(lessonBookmarks)
    .where(
      and(
        eq(lessonBookmarks.userId, opts.userId),
        eq(lessonBookmarks.lessonId, opts.lessonId)
      )
    )
    .get();
}

/** Toggle a bookmark: delete if present, insert if not. */
export function toggleBookmark(opts: { userId: number; lessonId: number }): {
  bookmarked: boolean;
} {
  const existing = findBookmark(opts);

  if (existing) {
    db.delete(lessonBookmarks)
      .where(eq(lessonBookmarks.id, existing.id))
      .run();
    return { bookmarked: false };
  }

  db.insert(lessonBookmarks)
    .values({ userId: opts.userId, lessonId: opts.lessonId })
    .run();
  return { bookmarked: true };
}

export function isLessonBookmarked(opts: {
  userId: number;
  lessonId: number;
}): boolean {
  return !!findBookmark(opts);
}

/** All bookmarked lesson IDs for a student within one course. */
export function getBookmarkedLessonIds(opts: {
  userId: number;
  courseId: number;
}): number[] {
  const rows = db
    .select({ lessonId: lessonBookmarks.lessonId })
    .from(lessonBookmarks)
    .innerJoin(lessons, eq(lessonBookmarks.lessonId, lessons.id))
    .innerJoin(modules, eq(lessons.moduleId, modules.id))
    .where(
      and(
        eq(lessonBookmarks.userId, opts.userId),
        eq(modules.courseId, opts.courseId)
      )
    )
    .all();

  return rows.map((r) => r.lessonId);
}

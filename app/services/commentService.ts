import { eq } from "drizzle-orm";
import { getTableColumns } from "drizzle-orm";
import { db } from "~/db";
import { users, lessons, modules, comments, UserRole } from "~/db/schema";
import { isUserEnrolled } from "./enrollmentService";
import { getCourseById } from "./courseService";

// ─── Comment Service ───
// Threaded comments on lessons and courses. Owns the feature's gating
// (canCommentOn), the exactly-one-target invariant, flat-query → tree
// assembly, ordering, soft-delete, and edit/delete permission checks.
// Functions with 2+ same-type params take a single `opts` object (project
// convention).

/** Max comment body length. Shared with the route's Zod schema. */
export const MAX_COMMENT_LENGTH = 5000;

/**
 * Validate a comment body: non-empty after trim, within the length limit.
 * Returns the trimmed body. Re-checked here even though the route validates,
 * for defense in depth (mirrors upsertReview).
 */
function validateBody(body: string): string {
  const trimmed = body.trim();
  if (trimmed.length === 0) {
    throw new Error("Comment body cannot be empty");
  }
  if (trimmed.length > MAX_COMMENT_LENGTH) {
    throw new Error(`Comment body cannot exceed ${MAX_COMMENT_LENGTH} characters`);
  }
  return trimmed;
}

/**
 * Resolve a comment target (exactly one of lessonId / courseId) to the course
 * that gates it. Enforces the exactly-one-target invariant. A lesson resolves
 * to its module's course.
 */
function resolveCourseId(opts: {
  lessonId: number | null;
  courseId: number | null;
}): number {
  const { lessonId, courseId } = opts;
  if ((lessonId == null) === (courseId == null)) {
    throw new Error("A comment must target exactly one of a lesson or a course");
  }

  if (courseId != null) return courseId;

  const lesson = db
    .select()
    .from(lessons)
    .where(eq(lessons.id, lessonId!))
    .get();
  if (!lesson) {
    throw new Error("Lesson not found");
  }
  const mod = db
    .select()
    .from(modules)
    .where(eq(modules.id, lesson.moduleId))
    .get();
  if (!mod) {
    throw new Error("Module not found");
  }
  return mod.courseId;
}

/**
 * Read/write authorization for a course's discussion.
 * Instructors are NOT enrolled, so the rule is:
 * enrolled in the course OR is the course's instructor OR is an admin.
 */
export function canCommentOn(opts: {
  userId: number;
  courseId: number;
}): boolean {
  const { userId, courseId } = opts;
  const user = db.select().from(users).where(eq(users.id, userId)).get();
  if (!user) return false;
  if (user.role === UserRole.Admin) return true;

  const course = getCourseById(courseId);
  if (course?.instructorId === userId) return true;

  return isUserEnrolled({ userId, courseId });
}

/**
 * Post a top-level comment on a lesson or a course. Exactly one of lessonId /
 * courseId must be set. The author must pass the read/write gate.
 */
export function addComment(opts: {
  userId: number;
  lessonId: number | null;
  courseId: number | null;
  body: string;
}) {
  const { userId, lessonId, courseId, body } = opts;
  const trimmed = validateBody(body);
  const gateCourseId = resolveCourseId({ lessonId, courseId });

  if (!canCommentOn({ userId, courseId: gateCourseId })) {
    throw new Error("Not allowed to comment on this course");
  }

  return db
    .insert(comments)
    .values({ userId, lessonId, courseId, parentId: null, body: trimmed })
    .returning()
    .get();
}

/**
 * Reply to an existing comment. The reply inherits its parent's target
 * (lesson or course); the author must pass the gate for that course.
 */
export function replyToComment(opts: {
  userId: number;
  parentId: number;
  body: string;
}) {
  const { userId, parentId, body } = opts;
  const trimmed = validateBody(body);

  const parent = db
    .select()
    .from(comments)
    .where(eq(comments.id, parentId))
    .get();
  if (!parent) {
    throw new Error("Parent comment not found");
  }

  const gateCourseId = resolveCourseId({
    lessonId: parent.lessonId,
    courseId: parent.courseId,
  });
  if (!canCommentOn({ userId, courseId: gateCourseId })) {
    throw new Error("Not allowed to comment on this course");
  }

  return db
    .insert(comments)
    .values({
      userId,
      lessonId: parent.lessonId,
      courseId: parent.courseId,
      parentId,
      body: trimmed,
    })
    .returning()
    .get();
}

/**
 * Edit a comment's body. Only the author may edit, and only while the comment
 * is not deleted. Bumps updatedAt; the UI shows an "edited" marker.
 */
export function editComment(opts: {
  userId: number;
  commentId: number;
  body: string;
}) {
  const { userId, commentId, body } = opts;
  const trimmed = validateBody(body);

  const comment = db
    .select()
    .from(comments)
    .where(eq(comments.id, commentId))
    .get();
  if (!comment) {
    throw new Error("Comment not found");
  }
  if (comment.userId !== userId) {
    throw new Error("You can only edit your own comment");
  }
  if (comment.deletedAt) {
    throw new Error("Cannot edit a deleted comment");
  }

  return db
    .update(comments)
    .set({ body: trimmed, updatedAt: new Date().toISOString() })
    .where(eq(comments.id, commentId))
    .returning()
    .get();
}

/**
 * Soft-delete a comment by setting deletedAt. The row and its replies remain;
 * the body renders as "[deleted]". Permitted for the author, the course's
 * instructor, and admins (the moderation primitive).
 */
export function softDeleteComment(opts: {
  userId: number;
  commentId: number;
}) {
  const { userId, commentId } = opts;
  const comment = db
    .select()
    .from(comments)
    .where(eq(comments.id, commentId))
    .get();
  if (!comment) {
    throw new Error("Comment not found");
  }

  const isAuthor = comment.userId === userId;
  const gateCourseId = resolveCourseId({
    lessonId: comment.lessonId,
    courseId: comment.courseId,
  });
  const course = getCourseById(gateCourseId);
  const isInstructor = course?.instructorId === userId;
  const user = db.select().from(users).where(eq(users.id, userId)).get();
  const isAdmin = user?.role === UserRole.Admin;

  if (!isAuthor && !isInstructor && !isAdmin) {
    throw new Error("Not allowed to delete this comment");
  }

  // Already deleted — return as-is (idempotent).
  if (comment.deletedAt) {
    return comment;
  }

  return db
    .update(comments)
    .set({ deletedAt: new Date().toISOString() })
    .where(eq(comments.id, commentId))
    .returning()
    .get();
}

/** A comment plus its author and nested replies, ready for rendering. */
export type CommentNode = {
  id: number;
  userId: number;
  parentId: number | null;
  lessonId: number | null;
  courseId: number | null;
  body: string | null; // null when the comment is soft-deleted
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
  authorName: string;
  authorAvatarUrl: string | null;
  replies: CommentNode[];
};

/**
 * Load every comment for a target (lesson or course) in one flat query and
 * assemble the parent/child tree in application code. Top-level comments are
 * ordered newest-first; replies oldest-first within each parent. Soft-deleted
 * comments are kept (to preserve thread structure) but their body is nulled.
 */
export function getCommentTree(opts: {
  lessonId: number | null;
  courseId: number | null;
}): CommentNode[] {
  const { lessonId, courseId } = opts;
  // Enforce the exactly-one-target invariant on reads too.
  resolveCourseId({ lessonId, courseId });

  const rows = db
    .select({
      ...getTableColumns(comments),
      authorName: users.name,
      authorAvatarUrl: users.avatarUrl,
    })
    .from(comments)
    .innerJoin(users, eq(comments.userId, users.id))
    .where(
      courseId != null
        ? eq(comments.courseId, courseId)
        : eq(comments.lessonId, lessonId!)
    )
    .all();

  const nodes = new Map<number, CommentNode>();
  for (const r of rows) {
    nodes.set(r.id, {
      id: r.id,
      userId: r.userId,
      parentId: r.parentId,
      lessonId: r.lessonId,
      courseId: r.courseId,
      body: r.deletedAt ? null : r.body,
      deletedAt: r.deletedAt,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      authorName: r.authorName,
      authorAvatarUrl: r.authorAvatarUrl,
      replies: [],
    });
  }

  const roots: CommentNode[] = [];
  for (const node of nodes.values()) {
    const parent =
      node.parentId != null ? nodes.get(node.parentId) : undefined;
    if (parent) {
      parent.replies.push(node);
    } else {
      roots.push(node);
    }
  }

  // Stable ordering with id tie-break (timestamps can collide on fast inserts).
  const newestFirst = (a: CommentNode, b: CommentNode) =>
    b.createdAt.localeCompare(a.createdAt) || b.id - a.id;
  const oldestFirst = (a: CommentNode, b: CommentNode) =>
    a.createdAt.localeCompare(b.createdAt) || a.id - b.id;

  const sortReplies = (node: CommentNode) => {
    node.replies.sort(oldestFirst);
    node.replies.forEach(sortReplies);
  };
  roots.sort(newestFirst);
  roots.forEach(sortReplies);

  return roots;
}

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
  canCommentOn,
  addComment,
  replyToComment,
  getCommentTree,
  editComment,
  softDeleteComment,
} from "./commentService";

/** Enroll a user in a course. */
function enroll(userId: number, courseId: number) {
  testDb
    .insert(schema.enrollments)
    .values({ userId, courseId })
    .run();
}

/** Create a module + lesson under the base course; returns the lesson. */
function seedLesson(courseId: number) {
  const mod = testDb
    .insert(schema.modules)
    .values({ courseId, title: "Module 1", position: 0 })
    .returning()
    .get();
  return testDb
    .insert(schema.lessons)
    .values({ moduleId: mod.id, title: "Lesson 1", position: 0 })
    .returning()
    .get();
}

describe("commentService", () => {
  beforeEach(() => {
    testDb = createTestDb();
    base = seedBaseData(testDb);
  });

  describe("canCommentOn", () => {
    it("allows an enrolled student", () => {
      enroll(base.user.id, base.course.id);
      expect(
        canCommentOn({ userId: base.user.id, courseId: base.course.id })
      ).toBe(true);
    });

    it("allows the course's instructor (who is not enrolled)", () => {
      expect(
        canCommentOn({ userId: base.instructor.id, courseId: base.course.id })
      ).toBe(true);
    });

    it("allows an admin", () => {
      const admin = testDb
        .insert(schema.users)
        .values({
          name: "Admin",
          email: "admin@example.com",
          role: schema.UserRole.Admin,
        })
        .returning()
        .get();
      expect(
        canCommentOn({ userId: admin.id, courseId: base.course.id })
      ).toBe(true);
    });

    it("rejects a non-enrolled, non-instructor user", () => {
      expect(
        canCommentOn({ userId: base.user.id, courseId: base.course.id })
      ).toBe(false);
    });
  });

  describe("addComment", () => {
    it("creates a top-level comment on a course for an enrolled student", () => {
      enroll(base.user.id, base.course.id);

      const comment = addComment({
        userId: base.user.id,
        lessonId: null,
        courseId: base.course.id,
        body: "Hello",
      });

      expect(comment.id).toBeDefined();
      expect(comment.userId).toBe(base.user.id);
      expect(comment.courseId).toBe(base.course.id);
      expect(comment.lessonId).toBeNull();
      expect(comment.parentId).toBeNull();
      expect(comment.body).toBe("Hello");
      expect(comment.deletedAt).toBeNull();
    });

    it("creates a top-level comment on a lesson", () => {
      const lesson = seedLesson(base.course.id);
      enroll(base.user.id, base.course.id);

      const comment = addComment({
        userId: base.user.id,
        lessonId: lesson.id,
        courseId: null,
        body: "On a lesson",
      });

      expect(comment.lessonId).toBe(lesson.id);
      expect(comment.courseId).toBeNull();
    });

    it("trims the body before storing", () => {
      enroll(base.user.id, base.course.id);
      const comment = addComment({
        userId: base.user.id,
        lessonId: null,
        courseId: base.course.id,
        body: "  hi  ",
      });
      expect(comment.body).toBe("hi");
    });

    it("rejects when neither lesson nor course is targeted", () => {
      enroll(base.user.id, base.course.id);
      expect(() =>
        addComment({
          userId: base.user.id,
          lessonId: null,
          courseId: null,
          body: "Hello",
        })
      ).toThrowError("exactly one");
    });

    it("rejects when both lesson and course are targeted", () => {
      const lesson = seedLesson(base.course.id);
      enroll(base.user.id, base.course.id);
      expect(() =>
        addComment({
          userId: base.user.id,
          lessonId: lesson.id,
          courseId: base.course.id,
          body: "Hello",
        })
      ).toThrowError("exactly one");
    });

    it("rejects a user who cannot comment on the course", () => {
      expect(() =>
        addComment({
          userId: base.user.id,
          lessonId: null,
          courseId: base.course.id,
          body: "Hello",
        })
      ).toThrowError("Not allowed");
    });

    it("rejects an empty / whitespace-only body", () => {
      enroll(base.user.id, base.course.id);
      expect(() =>
        addComment({
          userId: base.user.id,
          lessonId: null,
          courseId: base.course.id,
          body: "   ",
        })
      ).toThrowError("cannot be empty");
    });

    it("rejects a body over the length limit", () => {
      enroll(base.user.id, base.course.id);
      const tooLong = "a".repeat(5001);
      expect(() =>
        addComment({
          userId: base.user.id,
          lessonId: null,
          courseId: base.course.id,
          body: tooLong,
        })
      ).toThrowError("cannot exceed");
    });
  });

  describe("getCommentTree", () => {
    it("returns top-level comments newest-first with author info", () => {
      enroll(base.user.id, base.course.id);
      const first = addComment({
        userId: base.user.id,
        lessonId: null,
        courseId: base.course.id,
        body: "First",
      });
      const second = addComment({
        userId: base.user.id,
        lessonId: null,
        courseId: base.course.id,
        body: "Second",
      });

      const tree = getCommentTree({ lessonId: null, courseId: base.course.id });

      expect(tree.map((c) => c.id)).toEqual([second.id, first.id]);
      expect(tree[0].authorName).toBe(base.user.name);
      expect(tree[0].authorAvatarUrl).toBeNull();
      expect(tree[0].replies).toEqual([]);
    });

    it("scopes the tree to the requested target", () => {
      const lesson = seedLesson(base.course.id);
      enroll(base.user.id, base.course.id);
      addComment({
        userId: base.user.id,
        lessonId: lesson.id,
        courseId: null,
        body: "On lesson",
      });
      addComment({
        userId: base.user.id,
        lessonId: null,
        courseId: base.course.id,
        body: "On course",
      });

      const lessonTree = getCommentTree({ lessonId: lesson.id, courseId: null });
      const courseTree = getCommentTree({
        lessonId: null,
        courseId: base.course.id,
      });

      expect(lessonTree).toHaveLength(1);
      expect(lessonTree[0].body).toBe("On lesson");
      expect(courseTree).toHaveLength(1);
      expect(courseTree[0].body).toBe("On course");
    });

    it("nests replies under their parent, oldest-first", () => {
      enroll(base.user.id, base.course.id);
      const parent = addComment({
        userId: base.user.id,
        lessonId: null,
        courseId: base.course.id,
        body: "Q",
      });
      const r1 = replyToComment({
        userId: base.user.id,
        parentId: parent.id,
        body: "A1",
      });
      const r2 = replyToComment({
        userId: base.user.id,
        parentId: parent.id,
        body: "A2",
      });

      const tree = getCommentTree({ lessonId: null, courseId: base.course.id });

      expect(tree).toHaveLength(1);
      expect(tree[0].id).toBe(parent.id);
      expect(tree[0].replies.map((c) => c.id)).toEqual([r1.id, r2.id]);
    });

    it("supports arbitrary nesting depth", () => {
      enroll(base.user.id, base.course.id);
      const top = addComment({
        userId: base.user.id,
        lessonId: null,
        courseId: base.course.id,
        body: "top",
      });
      const mid = replyToComment({
        userId: base.user.id,
        parentId: top.id,
        body: "mid",
      });
      const deep = replyToComment({
        userId: base.user.id,
        parentId: mid.id,
        body: "deep",
      });

      const tree = getCommentTree({ lessonId: null, courseId: base.course.id });

      expect(tree[0].replies[0].id).toBe(mid.id);
      expect(tree[0].replies[0].replies[0].id).toBe(deep.id);
    });
  });

  describe("replyToComment", () => {
    it("inherits the parent's target and sets parentId", () => {
      const lesson = seedLesson(base.course.id);
      enroll(base.user.id, base.course.id);
      const parent = addComment({
        userId: base.user.id,
        lessonId: lesson.id,
        courseId: null,
        body: "Q",
      });

      const reply = replyToComment({
        userId: base.user.id,
        parentId: parent.id,
        body: "A",
      });

      expect(reply.parentId).toBe(parent.id);
      expect(reply.lessonId).toBe(lesson.id);
      expect(reply.courseId).toBeNull();
    });

    it("rejects a reply to a non-existent comment", () => {
      enroll(base.user.id, base.course.id);
      expect(() =>
        replyToComment({ userId: base.user.id, parentId: 9999, body: "A" })
      ).toThrowError("not found");
    });

    it("rejects a user who cannot comment on the course", () => {
      enroll(base.user.id, base.course.id);
      const parent = addComment({
        userId: base.user.id,
        lessonId: null,
        courseId: base.course.id,
        body: "Q",
      });

      const stranger = testDb
        .insert(schema.users)
        .values({
          name: "Stranger",
          email: "stranger@example.com",
          role: schema.UserRole.Student,
        })
        .returning()
        .get();

      expect(() =>
        replyToComment({ userId: stranger.id, parentId: parent.id, body: "A" })
      ).toThrowError("Not allowed");
    });
  });

  describe("editComment", () => {
    it("lets the author edit their own comment and bumps updatedAt", () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-06-02T10:00:00.000Z"));
      enroll(base.user.id, base.course.id);
      const comment = addComment({
        userId: base.user.id,
        lessonId: null,
        courseId: base.course.id,
        body: "typo",
      });

      vi.setSystemTime(new Date("2026-06-02T10:05:00.000Z"));
      const edited = editComment({
        userId: base.user.id,
        commentId: comment.id,
        body: "fixed",
      });

      expect(edited.body).toBe("fixed");
      expect(edited.updatedAt > comment.updatedAt).toBe(true);
      vi.useRealTimers();
    });

    it("validates the new body", () => {
      enroll(base.user.id, base.course.id);
      const comment = addComment({
        userId: base.user.id,
        lessonId: null,
        courseId: base.course.id,
        body: "ok",
      });
      expect(() =>
        editComment({ userId: base.user.id, commentId: comment.id, body: "   " })
      ).toThrowError("cannot be empty");
    });

    it("rejects a non-author editing someone else's comment", () => {
      enroll(base.user.id, base.course.id);
      const comment = addComment({
        userId: base.user.id,
        lessonId: null,
        courseId: base.course.id,
        body: "mine",
      });

      expect(() =>
        editComment({
          userId: base.instructor.id,
          commentId: comment.id,
          body: "hijacked",
        })
      ).toThrowError("only edit your own");
    });

    it("rejects editing a deleted comment", () => {
      enroll(base.user.id, base.course.id);
      const comment = addComment({
        userId: base.user.id,
        lessonId: null,
        courseId: base.course.id,
        body: "mine",
      });
      softDeleteComment({ userId: base.user.id, commentId: comment.id });

      expect(() =>
        editComment({
          userId: base.user.id,
          commentId: comment.id,
          body: "back",
        })
      ).toThrowError("deleted");
    });
  });

  describe("softDeleteComment", () => {
    it("lets the author delete their own comment", () => {
      enroll(base.user.id, base.course.id);
      const comment = addComment({
        userId: base.user.id,
        lessonId: null,
        courseId: base.course.id,
        body: "bye",
      });

      const deleted = softDeleteComment({
        userId: base.user.id,
        commentId: comment.id,
      });
      expect(deleted.deletedAt).not.toBeNull();
    });

    it("lets the course instructor delete any comment", () => {
      enroll(base.user.id, base.course.id);
      const comment = addComment({
        userId: base.user.id,
        lessonId: null,
        courseId: base.course.id,
        body: "student",
      });

      const deleted = softDeleteComment({
        userId: base.instructor.id,
        commentId: comment.id,
      });
      expect(deleted.deletedAt).not.toBeNull();
    });

    it("lets an admin delete any comment", () => {
      enroll(base.user.id, base.course.id);
      const comment = addComment({
        userId: base.user.id,
        lessonId: null,
        courseId: base.course.id,
        body: "student",
      });
      const admin = testDb
        .insert(schema.users)
        .values({
          name: "Admin",
          email: "admin@example.com",
          role: schema.UserRole.Admin,
        })
        .returning()
        .get();

      const deleted = softDeleteComment({
        userId: admin.id,
        commentId: comment.id,
      });
      expect(deleted.deletedAt).not.toBeNull();
    });

    it("rejects a different enrolled student deleting someone else's comment", () => {
      enroll(base.user.id, base.course.id);
      const comment = addComment({
        userId: base.user.id,
        lessonId: null,
        courseId: base.course.id,
        body: "mine",
      });
      const other = testDb
        .insert(schema.users)
        .values({
          name: "Other",
          email: "other@example.com",
          role: schema.UserRole.Student,
        })
        .returning()
        .get();
      enroll(other.id, base.course.id);

      expect(() =>
        softDeleteComment({ userId: other.id, commentId: comment.id })
      ).toThrowError("Not allowed");
    });

    it("preserves replies under a deleted parent and renders the parent as deleted", () => {
      enroll(base.user.id, base.course.id);
      const parent = addComment({
        userId: base.user.id,
        lessonId: null,
        courseId: base.course.id,
        body: "question",
      });
      const reply = replyToComment({
        userId: base.user.id,
        parentId: parent.id,
        body: "answer",
      });

      softDeleteComment({ userId: base.user.id, commentId: parent.id });

      const tree = getCommentTree({ lessonId: null, courseId: base.course.id });
      expect(tree).toHaveLength(1);
      expect(tree[0].id).toBe(parent.id);
      expect(tree[0].deletedAt).not.toBeNull();
      expect(tree[0].body).toBeNull(); // renders as "[deleted]"
      expect(tree[0].replies.map((r) => r.id)).toEqual([reply.id]);
      expect(tree[0].replies[0].body).toBe("answer");
    });
  });
});

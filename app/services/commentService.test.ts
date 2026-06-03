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
      expect(canCommentOn(base.user.id, base.course.id)).toBe(true);
    });

    it("allows the course's instructor (who is not enrolled)", () => {
      expect(canCommentOn(base.instructor.id, base.course.id)).toBe(true);
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
      expect(canCommentOn(admin.id, base.course.id)).toBe(true);
    });

    it("rejects a non-enrolled, non-instructor user", () => {
      expect(canCommentOn(base.user.id, base.course.id)).toBe(false);
    });
  });

  describe("addComment", () => {
    it("creates a top-level comment on a course for an enrolled student", () => {
      enroll(base.user.id, base.course.id);

      const comment = addComment(base.user.id, null, base.course.id, "Hello");

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

      const comment = addComment(base.user.id, lesson.id, null, "On a lesson");

      expect(comment.lessonId).toBe(lesson.id);
      expect(comment.courseId).toBeNull();
    });

    it("trims the body before storing", () => {
      enroll(base.user.id, base.course.id);
      const comment = addComment(base.user.id, null, base.course.id, "  hi  ");
      expect(comment.body).toBe("hi");
    });

    it("rejects when neither lesson nor course is targeted", () => {
      enroll(base.user.id, base.course.id);
      expect(() => addComment(base.user.id, null, null, "Hello")).toThrowError(
        "exactly one"
      );
    });

    it("rejects when both lesson and course are targeted", () => {
      const lesson = seedLesson(base.course.id);
      enroll(base.user.id, base.course.id);
      expect(() =>
        addComment(base.user.id, lesson.id, base.course.id, "Hello")
      ).toThrowError("exactly one");
    });

    it("rejects a user who cannot comment on the course", () => {
      expect(() =>
        addComment(base.user.id, null, base.course.id, "Hello")
      ).toThrowError("Not allowed");
    });

    it("rejects an empty / whitespace-only body", () => {
      enroll(base.user.id, base.course.id);
      expect(() =>
        addComment(base.user.id, null, base.course.id, "   ")
      ).toThrowError("cannot be empty");
    });

    it("rejects a body over the length limit", () => {
      enroll(base.user.id, base.course.id);
      const tooLong = "a".repeat(5001);
      expect(() =>
        addComment(base.user.id, null, base.course.id, tooLong)
      ).toThrowError("cannot exceed");
    });
  });

  describe("getCommentTree", () => {
    it("returns top-level comments newest-first with author info", () => {
      enroll(base.user.id, base.course.id);
      const first = addComment(base.user.id, null, base.course.id, "First");
      const second = addComment(base.user.id, null, base.course.id, "Second");

      const tree = getCommentTree(null, base.course.id);

      expect(tree.map((c) => c.id)).toEqual([second.id, first.id]);
      expect(tree[0].authorName).toBe(base.user.name);
      expect(tree[0].authorAvatarUrl).toBeNull();
      expect(tree[0].replies).toEqual([]);
    });

    it("scopes the tree to the requested target", () => {
      const lesson = seedLesson(base.course.id);
      enroll(base.user.id, base.course.id);
      addComment(base.user.id, lesson.id, null, "On lesson");
      addComment(base.user.id, null, base.course.id, "On course");

      const lessonTree = getCommentTree(lesson.id, null);
      const courseTree = getCommentTree(null, base.course.id);

      expect(lessonTree).toHaveLength(1);
      expect(lessonTree[0].body).toBe("On lesson");
      expect(courseTree).toHaveLength(1);
      expect(courseTree[0].body).toBe("On course");
    });

    it("nests replies under their parent, oldest-first", () => {
      enroll(base.user.id, base.course.id);
      const parent = addComment(base.user.id, null, base.course.id, "Q");
      const r1 = replyToComment(base.user.id, parent.id, "A1");
      const r2 = replyToComment(base.user.id, parent.id, "A2");

      const tree = getCommentTree(null, base.course.id);

      expect(tree).toHaveLength(1);
      expect(tree[0].id).toBe(parent.id);
      expect(tree[0].replies.map((c) => c.id)).toEqual([r1.id, r2.id]);
    });

    it("supports arbitrary nesting depth", () => {
      enroll(base.user.id, base.course.id);
      const top = addComment(base.user.id, null, base.course.id, "top");
      const mid = replyToComment(base.user.id, top.id, "mid");
      const deep = replyToComment(base.user.id, mid.id, "deep");

      const tree = getCommentTree(null, base.course.id);

      expect(tree[0].replies[0].id).toBe(mid.id);
      expect(tree[0].replies[0].replies[0].id).toBe(deep.id);
    });
  });

  describe("replyToComment", () => {
    it("inherits the parent's target and sets parentId", () => {
      const lesson = seedLesson(base.course.id);
      enroll(base.user.id, base.course.id);
      const parent = addComment(base.user.id, lesson.id, null, "Q");

      const reply = replyToComment(base.user.id, parent.id, "A");

      expect(reply.parentId).toBe(parent.id);
      expect(reply.lessonId).toBe(lesson.id);
      expect(reply.courseId).toBeNull();
    });

    it("rejects a reply to a non-existent comment", () => {
      enroll(base.user.id, base.course.id);
      expect(() => replyToComment(base.user.id, 9999, "A")).toThrowError(
        "not found"
      );
    });

    it("rejects a user who cannot comment on the course", () => {
      enroll(base.user.id, base.course.id);
      const parent = addComment(base.user.id, null, base.course.id, "Q");

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
        replyToComment(stranger.id, parent.id, "A")
      ).toThrowError("Not allowed");
    });
  });

  describe("editComment", () => {
    it("lets the author edit their own comment and bumps updatedAt", () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-06-02T10:00:00.000Z"));
      enroll(base.user.id, base.course.id);
      const comment = addComment(base.user.id, null, base.course.id, "typo");

      vi.setSystemTime(new Date("2026-06-02T10:05:00.000Z"));
      const edited = editComment(base.user.id, comment.id, "fixed");

      expect(edited.body).toBe("fixed");
      expect(edited.updatedAt > comment.updatedAt).toBe(true);
      vi.useRealTimers();
    });

    it("validates the new body", () => {
      enroll(base.user.id, base.course.id);
      const comment = addComment(base.user.id, null, base.course.id, "ok");
      expect(() => editComment(base.user.id, comment.id, "   ")).toThrowError(
        "cannot be empty"
      );
    });

    it("rejects a non-author editing someone else's comment", () => {
      enroll(base.user.id, base.course.id);
      const comment = addComment(base.user.id, null, base.course.id, "mine");

      expect(() =>
        editComment(base.instructor.id, comment.id, "hijacked")
      ).toThrowError("only edit your own");
    });

    it("rejects editing a deleted comment", () => {
      enroll(base.user.id, base.course.id);
      const comment = addComment(base.user.id, null, base.course.id, "mine");
      softDeleteComment(base.user.id, comment.id);

      expect(() =>
        editComment(base.user.id, comment.id, "back")
      ).toThrowError("deleted");
    });
  });

  describe("softDeleteComment", () => {
    it("lets the author delete their own comment", () => {
      enroll(base.user.id, base.course.id);
      const comment = addComment(base.user.id, null, base.course.id, "bye");

      const deleted = softDeleteComment(base.user.id, comment.id);
      expect(deleted.deletedAt).not.toBeNull();
    });

    it("lets the course instructor delete any comment", () => {
      enroll(base.user.id, base.course.id);
      const comment = addComment(base.user.id, null, base.course.id, "student");

      const deleted = softDeleteComment(base.instructor.id, comment.id);
      expect(deleted.deletedAt).not.toBeNull();
    });

    it("lets an admin delete any comment", () => {
      enroll(base.user.id, base.course.id);
      const comment = addComment(base.user.id, null, base.course.id, "student");
      const admin = testDb
        .insert(schema.users)
        .values({
          name: "Admin",
          email: "admin@example.com",
          role: schema.UserRole.Admin,
        })
        .returning()
        .get();

      const deleted = softDeleteComment(admin.id, comment.id);
      expect(deleted.deletedAt).not.toBeNull();
    });

    it("rejects a different enrolled student deleting someone else's comment", () => {
      enroll(base.user.id, base.course.id);
      const comment = addComment(base.user.id, null, base.course.id, "mine");
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
        softDeleteComment(other.id, comment.id)
      ).toThrowError("Not allowed");
    });

    it("preserves replies under a deleted parent and renders the parent as deleted", () => {
      enroll(base.user.id, base.course.id);
      const parent = addComment(base.user.id, null, base.course.id, "question");
      const reply = replyToComment(base.user.id, parent.id, "answer");

      softDeleteComment(base.user.id, parent.id);

      const tree = getCommentTree(null, base.course.id);
      expect(tree).toHaveLength(1);
      expect(tree[0].id).toBe(parent.id);
      expect(tree[0].deletedAt).not.toBeNull();
      expect(tree[0].body).toBeNull(); // renders as "[deleted]"
      expect(tree[0].replies.map((r) => r.id)).toEqual([reply.id]);
      expect(tree[0].replies[0].body).toBe("answer");
    });
  });
});

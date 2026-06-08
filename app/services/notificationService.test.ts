import { describe, it, expect, beforeEach, vi } from "vitest";
import { createTestDb, seedBaseData } from "~/test/setup";
import * as schema from "~/db/schema";
import { NotificationType } from "~/db/schema";

let testDb: ReturnType<typeof createTestDb>;
let base: ReturnType<typeof seedBaseData>;

vi.mock("~/db", () => ({
  get db() {
    return testDb;
  },
}));

// Import after mock so the module picks up our test db
import {
  createNotification,
  getNotifications,
  getUnreadCount,
  markAsRead,
  markAllAsRead,
} from "./notificationService";

/** Helper: create a notification for a recipient with sensible defaults. */
function makeNotification(
  recipientUserId: number,
  overrides: Partial<{ title: string; message: string; linkUrl: string }> = {}
) {
  return createNotification({
    recipientUserId,
    type: NotificationType.Enrollment,
    title: overrides.title ?? "New Enrollment",
    message: overrides.message ?? "Someone enrolled in your course",
    linkUrl: overrides.linkUrl ?? "/instructor/1/students",
  });
}

describe("notificationService", () => {
  beforeEach(() => {
    testDb = createTestDb();
    base = seedBaseData(testDb);
  });

  describe("createNotification", () => {
    it("creates a notification with all fields", () => {
      const notification = createNotification({
        recipientUserId: base.instructor.id,
        type: NotificationType.Enrollment,
        title: "New Enrollment",
        message: "Test User enrolled in Test Course",
        linkUrl: "/instructor/1/students",
      });

      expect(notification).toBeDefined();
      expect(notification.recipientUserId).toBe(base.instructor.id);
      expect(notification.type).toBe(NotificationType.Enrollment);
      expect(notification.title).toBe("New Enrollment");
      expect(notification.message).toBe("Test User enrolled in Test Course");
      expect(notification.linkUrl).toBe("/instructor/1/students");
      expect(notification.createdAt).toBeDefined();
    });

    it("defaults isRead to false", () => {
      const notification = makeNotification(base.instructor.id);
      expect(notification.isRead).toBe(false);
    });
  });

  describe("getNotifications", () => {
    it("returns notifications for a user, newest first", () => {
      const first = makeNotification(base.instructor.id, { title: "First" });
      const second = makeNotification(base.instructor.id, { title: "Second" });
      const third = makeNotification(base.instructor.id, { title: "Third" });

      const list = getNotifications({
        userId: base.instructor.id,
        limit: 10,
        offset: 0,
      });

      expect(list).toHaveLength(3);
      expect(list[0].id).toBe(third.id);
      expect(list[1].id).toBe(second.id);
      expect(list[2].id).toBe(first.id);
    });

    it("respects the limit", () => {
      makeNotification(base.instructor.id);
      makeNotification(base.instructor.id);
      makeNotification(base.instructor.id);

      const list = getNotifications({
        userId: base.instructor.id,
        limit: 2,
        offset: 0,
      });
      expect(list).toHaveLength(2);
    });

    it("respects the offset", () => {
      makeNotification(base.instructor.id, { title: "First" });
      const second = makeNotification(base.instructor.id, { title: "Second" });
      const third = makeNotification(base.instructor.id, { title: "Third" });

      // offset 1 skips the newest (third); next is second.
      const list = getNotifications({
        userId: base.instructor.id,
        limit: 1,
        offset: 1,
      });
      expect(list).toHaveLength(1);
      expect(list[0].id).toBe(second.id);
      expect([third.id]).not.toContain(list[0].id);
    });

    it("only returns the requested user's notifications", () => {
      makeNotification(base.instructor.id, { title: "For instructor" });
      makeNotification(base.user.id, { title: "For student" });

      const list = getNotifications({
        userId: base.instructor.id,
        limit: 10,
        offset: 0,
      });
      expect(list).toHaveLength(1);
      expect(list[0].title).toBe("For instructor");
    });

    it("returns an empty array when the user has no notifications", () => {
      expect(
        getNotifications({ userId: base.instructor.id, limit: 10, offset: 0 })
      ).toHaveLength(0);
    });
  });

  describe("getUnreadCount", () => {
    it("counts only unread notifications for the user", () => {
      const a = makeNotification(base.instructor.id);
      makeNotification(base.instructor.id);
      markAsRead({ notificationId: a.id, recipientUserId: base.instructor.id });

      expect(getUnreadCount(base.instructor.id)).toBe(1);
    });

    it("does not count another user's notifications", () => {
      makeNotification(base.instructor.id);
      makeNotification(base.user.id);

      expect(getUnreadCount(base.instructor.id)).toBe(1);
    });

    it("returns 0 when there are no unread notifications", () => {
      expect(getUnreadCount(base.instructor.id)).toBe(0);
    });
  });

  describe("markAsRead", () => {
    it("marks a single notification as read", () => {
      const notification = makeNotification(base.instructor.id);

      const updated = markAsRead({
        notificationId: notification.id,
        recipientUserId: base.instructor.id,
      });

      expect(updated).toBeDefined();
      expect(updated!.isRead).toBe(true);
      expect(getUnreadCount(base.instructor.id)).toBe(0);
    });

    it("does not mark another user's notification as read", () => {
      const notification = makeNotification(base.user.id);

      const updated = markAsRead({
        notificationId: notification.id,
        recipientUserId: base.instructor.id,
      });

      // No row matched the (id, recipient) pair → nothing updated.
      expect(updated).toBeUndefined();
      expect(getUnreadCount(base.user.id)).toBe(1);
    });
  });

  describe("markAllAsRead", () => {
    it("marks all of a user's notifications as read", () => {
      makeNotification(base.instructor.id);
      makeNotification(base.instructor.id);
      makeNotification(base.instructor.id);

      markAllAsRead(base.instructor.id);

      expect(getUnreadCount(base.instructor.id)).toBe(0);
    });

    it("does not affect another user's notifications", () => {
      makeNotification(base.instructor.id);
      makeNotification(base.user.id);

      markAllAsRead(base.instructor.id);

      expect(getUnreadCount(base.instructor.id)).toBe(0);
      expect(getUnreadCount(base.user.id)).toBe(1);
    });
  });
});

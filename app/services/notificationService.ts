import { eq, and, desc, sql } from "drizzle-orm";
import { db } from "~/db";
import { notifications, NotificationType } from "~/db/schema";

// ─── Notification Service ───
// Generic in-app notifications: create, list (newest first), unread count,
// and read-state mutations. User-scoped throughout — a user only ever sees or
// mutates their own notifications.

export function createNotification(opts: {
  recipientUserId: number;
  type: NotificationType;
  title: string;
  message: string;
  linkUrl: string;
}) {
  const { recipientUserId, type, title, message, linkUrl } = opts;
  return db
    .insert(notifications)
    .values({ recipientUserId, type, title, message, linkUrl })
    .returning()
    .get();
}

export function getNotifications(opts: {
  userId: number;
  limit: number;
  offset: number;
}) {
  const { userId, limit, offset } = opts;
  return db
    .select()
    .from(notifications)
    .where(eq(notifications.recipientUserId, userId))
    .orderBy(desc(notifications.createdAt), desc(notifications.id))
    .limit(limit)
    .offset(offset)
    .all();
}

export function getUnreadCount(userId: number) {
  const result = db
    .select({ count: sql<number>`count(*)` })
    .from(notifications)
    .where(
      and(
        eq(notifications.recipientUserId, userId),
        eq(notifications.isRead, false)
      )
    )
    .get();

  return result?.count ?? 0;
}

/**
 * Marks a single notification as read. Scoped by recipient so one user can
 * never mark another user's notification read; a non-owned (or missing) id
 * simply updates nothing and returns undefined.
 */
export function markAsRead(opts: {
  notificationId: number;
  recipientUserId: number;
}) {
  const { notificationId, recipientUserId } = opts;
  return db
    .update(notifications)
    .set({ isRead: true })
    .where(
      and(
        eq(notifications.id, notificationId),
        eq(notifications.recipientUserId, recipientUserId)
      )
    )
    .returning()
    .get();
}

export function markAllAsRead(userId: number) {
  return db
    .update(notifications)
    .set({ isRead: true })
    .where(
      and(
        eq(notifications.recipientUserId, userId),
        eq(notifications.isRead, false)
      )
    )
    .returning()
    .all();
}

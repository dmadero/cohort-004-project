import { data } from "react-router";
import { z } from "zod";
import type { Route } from "./+types/api.notifications.mark-read";
import { getCurrentUserId } from "~/lib/session";
import { markAsRead } from "~/services/notificationService";

// Action-only resource route: marks a single notification as read. Used by the
// NotificationBell fetcher (no full page reload). markAsRead is scoped to the
// current user, so a notification belonging to someone else simply no-ops.

const idSchema = z.coerce.number().int().positive();

export async function action({ request }: Route.ActionArgs) {
  const currentUserId = await getCurrentUserId(request);
  if (!currentUserId) {
    throw data("You must be logged in.", { status: 401 });
  }

  const formData = await request.formData();
  const parsed = idSchema.safeParse(formData.get("notificationId"));
  if (!parsed.success) {
    return data({ error: "Invalid notification id." }, { status: 400 });
  }

  markAsRead({ notificationId: parsed.data, recipientUserId: currentUserId });
  return data({ ok: true });
}

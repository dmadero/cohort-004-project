import { data } from "react-router";
import type { Route } from "./+types/api.notifications.mark-all-read";
import { getCurrentUserId } from "~/lib/session";
import { markAllAsRead } from "~/services/notificationService";

// Action-only resource route: marks all of the current user's notifications as
// read. Used by the "Mark all as read" button in the NotificationBell dropdown.

export async function action({ request }: Route.ActionArgs) {
  const currentUserId = await getCurrentUserId(request);
  if (!currentUserId) {
    throw data("You must be logged in.", { status: 401 });
  }

  markAllAsRead(currentUserId);
  return data({ ok: true });
}

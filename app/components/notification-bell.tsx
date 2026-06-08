import { useEffect, useRef, useState } from "react";
import { useFetcher, useNavigate } from "react-router";
import { Bell } from "lucide-react";
import { cn } from "~/lib/utils";

// Shape passed down from the app layout loader. Only the fields the dropdown
// renders — the bell never sees other users' notifications.
export interface NotificationItem {
  id: number;
  title: string;
  message: string;
  linkUrl: string;
  isRead: boolean;
  createdAt: string;
}

interface NotificationBellProps {
  unreadCount: number;
  notifications: NotificationItem[];
}

/** Compact relative timestamp, e.g. "just now", "5m", "3h", "2d". */
function timeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  const seconds = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `${weeks}w`;
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

export function NotificationBell({
  unreadCount,
  notifications,
}: NotificationBellProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const markReadFetcher = useFetcher();
  const markAllFetcher = useFetcher();

  // Close the dropdown when clicking outside it.
  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open]);

  function handleNotificationClick(notification: NotificationItem) {
    markReadFetcher.submit(
      { notificationId: String(notification.id) },
      { method: "post", action: "/api/notifications/mark-read" }
    );
    setOpen(false);
    navigate(notification.linkUrl);
  }

  function handleMarkAll() {
    markAllFetcher.submit(
      {},
      { method: "post", action: "/api/notifications/mark-all-read" }
    );
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        title="Notifications"
        aria-label={
          unreadCount > 0
            ? `Notifications (${unreadCount} unread)`
            : "Notifications"
        }
        className="relative rounded-md p-1.5 text-sidebar-foreground/60 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
      >
        <Bell className="size-4" />
        {unreadCount > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-semibold leading-none text-white">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute left-full top-0 z-50 ml-2 w-80 overflow-hidden rounded-lg border border-border bg-popover text-popover-foreground shadow-lg">
          <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
            <span className="text-sm font-semibold">Notifications</span>
            {notifications.length > 0 && (
              <button
                type="button"
                onClick={handleMarkAll}
                disabled={unreadCount === 0}
                className="text-xs font-medium text-primary transition-colors hover:underline disabled:cursor-default disabled:text-muted-foreground disabled:no-underline"
              >
                Mark all as read
              </button>
            )}
          </div>

          {notifications.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-muted-foreground">
              No notifications
            </div>
          ) : (
            <ul className="max-h-96 overflow-y-auto">
              {notifications.map((notification) => (
                <li key={notification.id}>
                  <button
                    type="button"
                    onClick={() => handleNotificationClick(notification)}
                    className={cn(
                      "flex w-full flex-col gap-0.5 border-b border-border px-4 py-3 text-left transition-colors last:border-b-0 hover:bg-accent",
                      !notification.isRead && "bg-accent/40"
                    )}
                  >
                    <div className="flex items-center gap-2">
                      {!notification.isRead && (
                        <span className="size-2 shrink-0 rounded-full bg-red-500" />
                      )}
                      <span className="text-sm font-medium">
                        {notification.title}
                      </span>
                      <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                        {timeAgo(notification.createdAt)}
                      </span>
                    </div>
                    <span className="text-sm text-muted-foreground">
                      {notification.message}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

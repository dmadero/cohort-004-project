import { useEffect, useRef, useState } from "react";
import { useFetcher } from "react-router";
import { MessageSquare, Pencil, Reply, Trash2 } from "lucide-react";
import { Button } from "~/components/ui/button";
import { Textarea } from "~/components/ui/textarea";
import { UserAvatar } from "~/components/user-avatar";
import { cn } from "~/lib/utils";

// Shared shape between the server loader (which renders bodies to sanitized
// HTML and computes permission flags) and this presentational component.
// Defined here so the .server helper can `import type` it without the client
// bundle ever pulling in server-only code.
export type RenderedComment = {
  id: number;
  parentId: number | null;
  authorName: string;
  authorAvatarUrl: string | null;
  bodyHtml: string | null; // null when soft-deleted → rendered as "[deleted]"
  createdAt: string;
  updatedAt: string;
  isDeleted: boolean;
  isEdited: boolean;
  canEdit: boolean;
  canDelete: boolean;
  rawBody: string | null; // raw Markdown for the edit textarea (author only)
  replies: RenderedComment[];
};

const MAX_INDENT = 4; // visual indentation cap; deeper replies stay flush

const COMMENTS_ACTION = "/api/comments";

function formatTimestamp(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/** A textarea + submit form posting to the comments resource route. */
function CommentForm({
  hiddenFields,
  defaultValue,
  submitLabel,
  placeholder,
  onDone,
  autoFocus,
}: {
  hiddenFields: Record<string, string>;
  defaultValue?: string;
  submitLabel: string;
  placeholder: string;
  onDone?: () => void;
  autoFocus?: boolean;
}) {
  const fetcher = useFetcher<{ error?: string }>();
  const formRef = useRef<HTMLFormElement>(null);
  const busy = fetcher.state !== "idle";
  const error = fetcher.data?.error;

  // On a successful submission the action redirects (no data returned), so
  // when we settle back to idle with no error, reset the field and close.
  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data === undefined) {
      formRef.current?.reset();
    }
    if (fetcher.state === "idle" && fetcher.data && !fetcher.data.error) {
      onDone?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetcher.state, fetcher.data]);

  return (
    <fetcher.Form ref={formRef} method="post" action={COMMENTS_ACTION}>
      {Object.entries(hiddenFields).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <Textarea
        name="body"
        defaultValue={defaultValue}
        placeholder={placeholder}
        autoFocus={autoFocus}
        maxLength={5000}
        required
        className="mb-2 min-h-20"
      />
      <div className="flex items-center gap-3">
        <Button type="submit" size="sm" disabled={busy}>
          {busy ? "Posting…" : submitLabel}
        </Button>
        {onDone && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={onDone}
            disabled={busy}
          >
            Cancel
          </Button>
        )}
        <span className="text-xs text-muted-foreground">
          Markdown supported
        </span>
      </div>
      {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
    </fetcher.Form>
  );
}

function DeleteButton({ commentId }: { commentId: number }) {
  const fetcher = useFetcher();
  const busy = fetcher.state !== "idle";
  return (
    <fetcher.Form method="post" action={COMMENTS_ACTION}>
      <input type="hidden" name="intent" value="delete" />
      <input type="hidden" name="commentId" value={commentId} />
      <button
        type="submit"
        disabled={busy}
        className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-destructive disabled:opacity-50"
      >
        <Trash2 className="size-3.5" />
        Delete
      </button>
    </fetcher.Form>
  );
}

function CommentItem({
  comment,
  depth,
}: {
  comment: RenderedComment;
  depth: number;
}) {
  const [replying, setReplying] = useState(false);
  const [editing, setEditing] = useState(false);

  const indented = depth > 0 && depth <= MAX_INDENT;

  return (
    <div
      className={cn(
        indented && "border-l border-border pl-4 sm:pl-6",
        depth > 0 && "mt-4"
      )}
    >
      <div className="flex items-start gap-3">
        {!comment.isDeleted && (
          <UserAvatar
            name={comment.authorName}
            avatarUrl={comment.authorAvatarUrl}
            className="size-7 shrink-0"
          />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 text-sm">
            {comment.isDeleted ? (
              <span className="font-medium text-muted-foreground">
                [deleted]
              </span>
            ) : (
              <span className="font-medium">{comment.authorName}</span>
            )}
            <time
              dateTime={comment.createdAt}
              suppressHydrationWarning
              className="text-xs text-muted-foreground"
            >
              {formatTimestamp(comment.createdAt)}
            </time>
            {comment.isEdited && (
              <span className="text-xs text-muted-foreground">(edited)</span>
            )}
          </div>

          {editing && comment.rawBody != null ? (
            <div className="mt-2">
              <CommentForm
                hiddenFields={{
                  intent: "edit",
                  commentId: String(comment.id),
                }}
                defaultValue={comment.rawBody}
                submitLabel="Save"
                placeholder="Edit your comment…"
                autoFocus
                onDone={() => setEditing(false)}
              />
            </div>
          ) : comment.isDeleted ? (
            <p className="mt-1 text-sm italic text-muted-foreground">
              This comment was deleted.
            </p>
          ) : (
            <div
              className="prose prose-sm prose-neutral dark:prose-invert mt-1 max-w-none break-words"
              dangerouslySetInnerHTML={{ __html: comment.bodyHtml ?? "" }}
            />
          )}

          {/* Affordances */}
          {!editing && (
            <div className="mt-1.5 flex items-center gap-4">
              {!comment.isDeleted && (
                <button
                  type="button"
                  onClick={() => setReplying((v) => !v)}
                  className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                >
                  <Reply className="size-3.5" />
                  Reply
                </button>
              )}
              {comment.canEdit && (
                <button
                  type="button"
                  onClick={() => setEditing(true)}
                  className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                >
                  <Pencil className="size-3.5" />
                  Edit
                </button>
              )}
              {comment.canDelete && <DeleteButton commentId={comment.id} />}
            </div>
          )}

          {replying && (
            <div className="mt-3">
              <CommentForm
                hiddenFields={{
                  intent: "reply",
                  parentId: String(comment.id),
                }}
                submitLabel="Reply"
                placeholder="Write a reply…"
                autoFocus
                onDone={() => setReplying(false)}
              />
            </div>
          )}

          {/* Replies — depth grows but indentation is capped at MAX_INDENT */}
          {comment.replies.map((child) => (
            <CommentItem key={child.id} comment={child} depth={depth + 1} />
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * Recursive comment discussion. Receives an already-rendered, permission-
 * stamped tree from the loader and a target (lessonId OR courseId). Holds no
 * business logic — it posts to /api/comments and relies on loader revalidation.
 */
export function CommentThread({
  comments,
  lessonId,
  courseId,
  title,
}: {
  comments: RenderedComment[];
  lessonId: number | null;
  courseId: number | null;
  title?: string;
}) {
  const targetFields: Record<string, string> = { intent: "add" };
  if (lessonId != null) targetFields.lessonId = String(lessonId);
  if (courseId != null) targetFields.courseId = String(courseId);

  return (
    <section>
      {title && (
        <h2 className="mb-4 flex items-center gap-2 text-xl font-bold">
          <MessageSquare className="size-5" />
          {title}
        </h2>
      )}

      <div className="mb-6">
        <CommentForm
          hiddenFields={targetFields}
          submitLabel="Post comment"
          placeholder="Add to the discussion…"
        />
      </div>

      {comments.length === 0 ? (
        <p className="rounded-lg border border-dashed py-8 text-center text-sm text-muted-foreground">
          No comments yet. Be the first to start the discussion.
        </p>
      ) : (
        <div className="space-y-6">
          {comments.map((comment) => (
            <CommentItem key={comment.id} comment={comment} depth={0} />
          ))}
        </div>
      )}
    </section>
  );
}

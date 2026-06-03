import { redirect, data } from "react-router";
import { z } from "zod";
import type { Route } from "./+types/api.comments";
import { getCurrentUserId } from "~/lib/session";
import {
  addComment,
  replyToComment,
  editComment,
  softDeleteComment,
  MAX_COMMENT_LENGTH,
} from "~/services/commentService";

// Action-only resource route for the comment feature (no loader/component),
// mirroring courses.$slug.rate.tsx and the api.* routes. Dispatches on an
// `intent` form field: add / reply / edit / delete. The target (lessonId OR
// courseId) and parentId ride in the form body. On success it redirects to
// Referer so the posting page's loaders revalidate (the author sees their
// comment immediately). Service errors are returned as a fetcher-friendly
// { error } payload. The service owns all permission + invariant enforcement.

const bodySchema = z.string().trim().min(1).max(MAX_COMMENT_LENGTH);
const idSchema = z.coerce.number().int().positive();

/** Optional numeric id from a form field: empty/absent → null. */
function parseOptionalId(value: FormDataEntryValue | null): number | null {
  if (value == null || value === "") return null;
  return idSchema.parse(value);
}

export async function action({ request }: Route.ActionArgs) {
  const currentUserId = await getCurrentUserId(request);
  if (!currentUserId) {
    throw data("You must be logged in to comment.", { status: 401 });
  }

  const formData = await request.formData();
  const intent = formData.get("intent");

  try {
    switch (intent) {
      case "add": {
        const lessonId = parseOptionalId(formData.get("lessonId"));
        const courseId = parseOptionalId(formData.get("courseId"));
        const body = bodySchema.parse(formData.get("body"));
        addComment(currentUserId, lessonId, courseId, body);
        break;
      }
      case "reply": {
        const parentId = idSchema.parse(formData.get("parentId"));
        const body = bodySchema.parse(formData.get("body"));
        replyToComment(currentUserId, parentId, body);
        break;
      }
      case "edit": {
        const commentId = idSchema.parse(formData.get("commentId"));
        const body = bodySchema.parse(formData.get("body"));
        editComment(currentUserId, commentId, body);
        break;
      }
      case "delete": {
        const commentId = idSchema.parse(formData.get("commentId"));
        softDeleteComment(currentUserId, commentId);
        break;
      }
      default:
        throw data("Invalid comment action.", { status: 400 });
    }
  } catch (err) {
    // Re-throw thrown Responses (e.g. the 400 above); surface other errors
    // (validation, permission, invariant) to the fetcher.
    if (err instanceof Response) throw err;
    const message =
      err instanceof z.ZodError
        ? "Your comment is empty or too long."
        : err instanceof Error
          ? err.message
          : "Something went wrong.";
    return data({ error: message }, { status: 400 });
  }

  const referer = request.headers.get("Referer");
  return redirect(referer ?? "/");
}

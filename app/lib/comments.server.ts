import {
  canCommentOn,
  getCommentTree,
  type CommentNode,
} from "~/services/commentService";
import { getUserById } from "~/services/userService";
import { UserRole } from "~/db/schema";
import { renderCommentMarkdown } from "./comment-markdown.server";
import type { RenderedComment } from "~/components/comment-thread";

export type CommentSection = {
  canComment: boolean; // read+write gate; when false, hide the discussion
  comments: RenderedComment[];
  count: number; // non-deleted comments, for the "Discussion" tab badge
};

const EMPTY_SECTION: CommentSection = {
  canComment: false,
  comments: [],
  count: 0,
};

/**
 * Loader-side composition for a comment discussion: enforces the read gate,
 * loads the tree, renders each body to sanitized HTML, and stamps per-comment
 * edit/delete permissions. Used by both the lesson and course loaders.
 *
 * `gateCourseId` is the course whose participants may see/post (for a lesson
 * target, that's the lesson's course). The discussion is hidden entirely from
 * anonymous and non-enrolled visitors.
 */
export async function loadCommentSection(
  currentUserId: number | null,
  lessonId: number | null,
  courseId: number | null,
  gateCourseId: number,
  courseInstructorId: number
): Promise<CommentSection> {
  if (currentUserId == null || !canCommentOn(currentUserId, gateCourseId)) {
    return EMPTY_SECTION;
  }

  const viewer = getUserById(currentUserId);
  const isAdmin = viewer?.role === UserRole.Admin;
  const isInstructor = currentUserId === courseInstructorId;

  let count = 0;

  const render = async (node: CommentNode): Promise<RenderedComment> => {
    const isDeleted = node.deletedAt != null;
    if (!isDeleted) count++;
    const isAuthor = node.userId === currentUserId;

    const replies: RenderedComment[] = [];
    for (const child of node.replies) {
      replies.push(await render(child));
    }

    return {
      id: node.id,
      parentId: node.parentId,
      authorName: node.authorName,
      authorAvatarUrl: node.authorAvatarUrl,
      bodyHtml:
        isDeleted || node.body == null
          ? null
          : await renderCommentMarkdown(node.body),
      createdAt: node.createdAt,
      updatedAt: node.updatedAt,
      isDeleted,
      isEdited: !isDeleted && node.updatedAt > node.createdAt,
      canEdit: !isDeleted && isAuthor,
      canDelete: !isDeleted && (isAuthor || isInstructor || isAdmin),
      rawBody: !isDeleted && isAuthor ? node.body : null,
      replies,
    };
  };

  const tree = getCommentTree(lessonId, courseId);
  const comments: RenderedComment[] = [];
  for (const node of tree) {
    comments.push(await render(node));
  }

  return { canComment: true, comments, count };
}

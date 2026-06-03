# PRD — Course & Lesson Comments

**Status:** Ready for agent (handoff)
**Author:** Daniel (design grilled with Claude, 2026-06-02)
**Target repo:** cohort-004-project (Cadence — mini course platform)
**Stack touchpoints:** React Router v7 (SSR), Drizzle ORM + SQLite, Vitest, Tailwind + shadcn/ui

> Handoff note: this PRD is self-contained. A fresh session should be able to implement it
> without the originating conversation. All open design questions were resolved during a
> grilling session; the decisions are recorded below as settled, not optional.

---

## Problem Statement

Students working through a course have nowhere to ask questions, share solutions, or
discuss content. When they get stuck on a lesson (or want to react to a course overall),
there's no place to write it down, get an answer from a peer or the instructor, or read
what others already asked. The learning experience is one-directional.

Instructors have no in-context channel to answer student questions where the question was
asked — at the lesson, next to the video and content.

## Solution

Add a threaded **comment** feature that students and instructors can use in two places:

- **On a lesson** — a discussion section beneath the lesson content, for questions and
  answers tied to that specific lesson.
- **On a course** — a "Discussion" tab on the course page, for course-level conversation.

Enrolled students and the course's instructor can post comments, reply to each other in
threads of arbitrary depth, edit their own comments, and delete them. Instructors and
admins can remove any comment for moderation. Comments support Markdown (including code
blocks — this is a coding course) and render safely. The discussion is private to the
course's participants; it is not shown to the public on the course sales page.

---

## User Stories

1. As an enrolled student, I want to post a comment on a lesson, so that I can ask a question tied to what I'm watching/reading.
2. As an enrolled student, I want to post a comment on a course, so that I can raise something about the course as a whole.
3. As an enrolled student, I want to reply to another person's comment, so that I can answer their question or add to the discussion.
4. As an enrolled student, I want to reply to a reply (and deeper), so that a back-and-forth conversation can continue in context.
5. As an enrolled student, I want my comment to appear immediately after I post it, so that I get confirmation it worked without a manual refresh.
6. As an enrolled student, I want to write Markdown including fenced code blocks, so that I can share and read code legibly.
7. As an enrolled student, I want to edit my own comment, so that I can fix a typo or clarify after posting.
8. As an enrolled student, I want to see an "edited" indicator on comments that were changed, so that I can tell a comment was revised.
9. As an enrolled student, I want to delete my own comment, so that I can remove something I no longer want posted.
10. As an enrolled student, I want replies under a deleted comment to remain readable, so that an answer isn't lost when the original question is removed.
11. As an enrolled student, I want top-level comments shown newest-first, so that fresh discussion is easy to find.
12. As an enrolled student, I want replies shown oldest-first within a thread, so that a conversation reads top-to-bottom.
13. As an enrolled student, I want each comment to show the author's name/avatar and a timestamp, so that I know who said what and when.
14. As an enrolled student, I want to see all comments for a lesson/course without paging, so that I can scan the full discussion.
15. As the course's instructor, I want to reply to student comments in-thread, so that I can answer questions where they were asked.
16. As the course's instructor, I want to delete any comment on my course, so that I can moderate abuse or off-topic content.
17. As an admin, I want to delete any comment, so that I can moderate across all courses.
18. As an instructor/admin, I want a deleted comment to show as "[deleted]" rather than vanish, so that thread structure and replies are preserved.
19. As a non-enrolled visitor on a public course page, I want the discussion hidden, so that I don't see private student conversation (and students' questions aren't exposed).
20. As a logged-out visitor, I want to be unable to read or post comments, so that the discussion stays within the course's participants.
21. As a user who tries to post empty or whitespace-only content, I want it rejected, so that the thread isn't polluted with blank comments.
22. As a user, I want a clear character limit on comments, so that I know the bounds when writing a long code explanation.
23. As a malicious user, I want my attempt to inject scripts via Markdown to be neutralized, so that — from the platform's perspective — other users are protected from stored XSS.
24. As an enrolled student on mobile, I want deeply nested replies to stay readable, so that indentation doesn't squeeze content off-screen.
25. As an enrolled student, I want a comment count visible on the course "Discussion" tab, so that I can tell at a glance whether there's activity.
26. As an enrolled student, I want an empty-state message when there are no comments yet, so that I'm invited to be the first to post.

---

## Implementation Decisions

### Data model — single `comments` table (polymorphic via nullable FKs)

A new `comments` table with **two nullable foreign keys**, exactly one of which is set per
row, identifying the target (a lesson or a course). This keeps real foreign keys (the
codebase convention — every relation in `schema.ts` uses `.references()`) while unifying
all comment logic into one table/service. The pure-polymorphic `targetType + targetId`
pattern was rejected because it breaks referential integrity.

Columns (conceptual; final types follow existing `schema.ts` conventions — integer PKs with
autoincrement, ISO-text timestamps via `$defaultFn`):

- `id` — integer PK
- `userId` — FK → `users.id`, not null
- `lessonId` — FK → `lessons.id`, nullable
- `courseId` — FK → `courses.id`, nullable
- `parentId` — self-referential FK → `comments.id`, nullable (enables arbitrary-depth threading)
- `body` — text, not null — the **raw Markdown source** (render happens at read time)
- `deletedAt` — text (ISO), nullable — soft-delete tombstone
- `createdAt` — text (ISO), not null
- `updatedAt` — text (ISO), not null — bumped on edit

**Invariant:** exactly one of `lessonId` / `courseId` is non-null. Enforced in the service
layer (primary), with a DB `CHECK` constraint as a backstop. This mirrors how
`reviewService` enforces its 1–5 rating rule in code with a comment noting the DB intent.

Migration generated via Drizzle (`pnpm db:migrate` flow). Seed data optional.

### Threading & tree assembly

- **Arbitrary nesting** in the data model via `parentId`.
- **Tree assembled in application code, not SQL.** The service runs one flat `SELECT` of all
  comments for a target, then builds the parent/child tree in JS (mirrors existing in-memory
  shaping like `flattenCourseLessons`). No recursive CTE.
- **Ordering:** top-level comments newest-first (`createdAt` desc); replies oldest-first
  within each parent.
- **No pagination** in v1 — all comments for a target are loaded.

### Delete semantics — soft delete

Deleting sets `deletedAt`. The row remains; its body renders as "[deleted]"; its replies
remain intact and correctly threaded. This is the only model that doesn't destroy other
users' replies under a deleted parent, and it doubles as the moderation primitive.

### Permissions

A single shared authorization helper (e.g. `canCommentOn(userId, courseId)`) expresses the
rule so the route and loaders share one definition. Note instructors are **not** enrolled,
so the rule is: enrolled in the course **OR** is the course's instructor **OR** is an admin.

- **Read:** enrolled students + the course's instructor + admins. The discussion section is
  **hidden from anonymous / non-enrolled visitors** on the public course page.
- **Write (post / reply):** same audience as read.
- **Edit:** author only, on their own non-deleted comment. Bumps `updatedAt`; UI shows an
  "edited" marker. No one can edit someone else's words.
- **Delete (soft):** the author on their own comment; the course's instructor and admins on
  any comment.

### Body format — sanitized Markdown

- Comment bodies are **Markdown with code blocks**, rendered server-side at read time.
- **A new, sanitized render path is required.** The existing `renderMarkdown`
  (`app/lib/markdown.server.ts`) runs `marked` with **no HTML sanitization** and its output
  is injected via `dangerouslySetInnerHTML` — safe for trusted instructor lesson content,
  but a **stored-XSS hole for untrusted student input**. Do **not** reuse it directly for
  comments. Add a sanitization step (e.g. `sanitize-html`, DOMPurify over rendered HTML, or
  `rehype-sanitize`) behind a dedicated comment-render function. The existing trusted
  renderer stays as-is for lesson content.
- This introduces **one new external dependency** (the sanitizer) — the only new dep in this
  feature; everything else reuses existing patterns.

### Validation

- Reject empty / whitespace-only bodies (after trim).
- Max length **5,000 characters** (room for a code snippet plus explanation; bounds abuse and
  server render cost).
- Validated with a Zod schema in the route (mirroring `rateActionSchema`) **and** re-checked
  in the service (defense in depth, like `upsertReview`).

### Routing & data flow

- **`app/routes/api.comments.ts`** — an **action-only resource route** (no loader/component),
  matching the precedent of `courses.$slug.rate.tsx` and the `api.*` routes
  (`api.video-tracking.ts`, `api.set-dev-country.ts`). Dispatches on an `intent` form field:
  `add` / `reply` / `edit` / `delete`. The target (`lessonId` **or** `courseId`) and
  `parentId` ride in the form body. Returns a redirect to `Referer` (as `rate.tsx` does) or a
  fetcher-friendly result.
- **Lesson loader** (`courses.$slug.lessons.$lessonId.tsx`) and **course loader**
  (`courses.$slug.tsx`) each call the service to load + render their comment tree, gated by
  the read permission. Bodies are rendered to sanitized HTML in the loader.
- **No realtime.** New comments propagate via `fetcher.Form` → action → React Router loader
  revalidation. The author sees their own comment immediately; others on next load. Ably stays
  scoped to live presence.

### UI

- **One shared `<CommentThread>` component**, mounted in two places:
  - **Lesson page:** a "Discussion" section placed after the quiz / mark-complete block and
    before the prev/next navigation.
  - **Course page:** a new **"Discussion" tab** added to the existing `Tabs` component, with a
    comment count.
- **Recursive rendering** with **visual indentation capped at ~4 levels** — deeper replies
  remain correctly threaded (correct parent, correct order) but stop adding left-indent so
  mobile stays readable.
- **Input control:** a plain `textarea` (`app/components/ui/textarea.tsx`) with a "Markdown
  supported" hint. Monaco is intentionally not used (too heavy; it's an instructor-authoring
  tool).
- Each comment shows author name/avatar (reuse `user-avatar.tsx`), a timestamp, an "edited"
  marker when applicable, and contextual edit/delete/reply affordances per the permission
  rules.
- **Empty state** invites the first comment.

### Module sketch (deep modules)

1. **`commentService`** (deep) — the core. Encapsulates gating (`canCommentOn`), the
   exactly-one-target invariant, flat-query → tree assembly, ordering, soft-delete, and
   edit/delete permission checks behind a simple interface (conceptually: `addComment`,
   `replyToComment`, `editComment`, `softDeleteComment`, `getCommentTree`, `canCommentOn`).
   Carries essentially all the feature's logic and risk. Follows the existing service-layer
   convention (positional-parameter functions, `db` from `~/db`).
2. **Comment Markdown renderer** (deep, small) — a single sanitized
   `renderCommentMarkdown(raw): Promise<string>`. Isolating the sanitization boundary into one
   function makes the XSS guarantee a single testable surface, kept separate from the trusted
   lesson renderer.
3. **`<CommentThread>`** (shallow, UI) — recursive presentation + the fetcher form. Holds no
   business logic; receives the rendered tree + target identifiers and posts to `api.comments`.

---

## Testing Decisions

**What makes a good test here:** assert external behavior through each module's public
interface, not internal structure. Drive the service with real inputs and assert on returned
trees, persisted state, thrown errors, and rendered output — never on private helpers or
query internals.

**Modules under test (v1):**

- **`commentService`** — the primary target. Cover:
  - exactly-one-target invariant (rejects zero targets and both targets)
  - write-gating (`canCommentOn`): enrolled student allowed; course instructor allowed; admin
    allowed; non-enrolled non-instructor rejected
  - tree assembly + ordering (top-level newest-first, replies oldest-first within a parent)
  - soft-delete preserves children (deleting a parent keeps replies in the tree; parent body
    reads as deleted)
  - edit permission (author can edit own; non-author cannot) and `updatedAt` bump
  - delete permission (author on own; instructor/admin on any; others rejected)
  - body validation (empty/whitespace rejected; over-limit rejected)
- **Comment Markdown renderer** — a **sanitization test**: a payload containing
  `<script>` / `onerror=` / `javascript:` renders inert (no executable markup survives), while
  legitimate Markdown (including a fenced code block) renders as expected.

**Prior art:** follow the existing Vitest service tests — `reviewService.test.ts`,
`progressService.test.ts`, `enrollmentService.test.ts`, `purchaseService.test.ts`, and the
`country.server.test.ts` / `ppp.test.ts` pure-function tests for the renderer. Match their
setup/teardown and assertion style.

**Out of test scope for v1:** route/action integration tests and component tests. The logic
and risk live in the service and the sanitizer; routes/UI are thin wiring.

---

## Out of Scope

- **Realtime / live updates** (no Ably push; revalidation only).
- **Pagination / lazy-loading / "load more"** of comments.
- **Reactions / likes / upvotes** on comments.
- **Notifications** (email or in-app) when someone replies.
- **@-mentions** of other users.
- **Rich attachments** (images, file uploads) beyond Markdown.
- **Public/social-proof display** of comments on the sales page.
- **Rate-limiting / spam detection** beyond length validation and the enrollment gate.
- **Comment search or filtering.**
- **Pinning / marking an answer as "accepted."**
- **Edit history** (only an "edited" flag, no diff/versioning).
- **Hard-delete / purge tooling.**

---

## Further Notes

- **Security is the highest-risk surface.** The single most important correctness requirement
  is that comment Markdown is sanitized. Do not route comment bodies through the existing
  trusted `renderMarkdown`. The sanitization test is non-negotiable for v1.
- **Permissions helper:** instructors are not enrolled, so any gate based solely on
  `isUserEnrolled` will wrongly exclude the instructor. Centralize the rule in
  `canCommentOn` (enrolled OR course instructor OR admin) and use it in the route and both
  loaders.
- **Precedents to mirror:** `courses.$slug.rate.tsx` (action-only resource route, Zod
  validation, service-enforced invariant, redirect to `Referer`); `reviewService` (service
  owns the invariant; one-row-per constraint with an explanatory comment); the lesson route's
  `intent`-dispatch action.
- **One new dependency** (a Markdown sanitizer) — confirm the choice before adding.
- **Suggested build order (TDD):** (1) Drizzle migration for `comments`; (2) `commentService`
  red→green with the test list above; (3) sanitized comment renderer + its test; (4)
  `api.comments` resource route; (5) loaders load/render trees; (6) `<CommentThread>` UI +
  two mount points.

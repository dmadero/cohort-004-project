import { marked } from "marked";
import sanitizeHtml from "sanitize-html";

// ─── Comment Markdown Renderer ───
// Untrusted student/instructor comment bodies are Markdown. Unlike the trusted
// lesson renderer (markdown.server.ts), this path MUST sanitize: marked emits
// raw HTML and we inject via dangerouslySetInnerHTML, so unsanitized output is
// a stored-XSS hole. This is the single, testable sanitization boundary for
// comments. Do NOT route comment bodies through renderMarkdown.

// Tags we allow: sanitize-html defaults (formatting, lists, blockquote, links,
// tables) plus the headings and code structure Markdown produces.
const allowedTags = [
  ...sanitizeHtml.defaults.allowedTags,
  "h1",
  "h2",
  "h3",
  "img",
];

const allowedAttributes: sanitizeHtml.IOptions["allowedAttributes"] = {
  a: ["href", "title"],
  code: ["class"], // language-* hint from fenced blocks
  img: ["src", "alt", "title"],
};

/**
 * Render an untrusted comment body (Markdown) to sanitized HTML.
 * Any executable markup — <script>, on* handlers, javascript: URLs — is
 * stripped. Legitimate Markdown, including fenced code blocks, is preserved.
 */
export async function renderCommentMarkdown(raw: string): Promise<string> {
  const dirty = await marked.parse(raw);
  return sanitizeHtml(dirty, {
    allowedTags,
    allowedAttributes,
    allowedSchemes: ["http", "https", "mailto"],
    // Drop the contents of disallowed tags (e.g. <script>) entirely.
    disallowedTagsMode: "discard",
  });
}

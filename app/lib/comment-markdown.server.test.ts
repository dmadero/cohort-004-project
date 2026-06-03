import { describe, it, expect } from "vitest";
import { renderCommentMarkdown } from "./comment-markdown.server";

describe("renderCommentMarkdown", () => {
  it("neutralizes a <script> injection", async () => {
    const html = await renderCommentMarkdown(
      "Hello <script>alert('xss')</script> world"
    );
    expect(html).not.toContain("<script");
    expect(html).not.toContain("alert('xss')");
  });

  it("strips on* event handler attributes", async () => {
    const html = await renderCommentMarkdown(
      '<img src="x" onerror="alert(1)">'
    );
    expect(html).not.toContain("onerror");
    expect(html).not.toContain("alert(1)");
  });

  it("strips javascript: URLs from links", async () => {
    const html = await renderCommentMarkdown(
      "[click me](javascript:alert(1))"
    );
    expect(html).not.toContain("javascript:");
  });

  it("renders legitimate Markdown including a fenced code block", async () => {
    const html = await renderCommentMarkdown(
      "Here is **bold** text:\n\n```js\nconst x = 1;\n```"
    );
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain("<pre>");
    expect(html).toContain("<code");
    expect(html).toContain("const x = 1;");
  });
});

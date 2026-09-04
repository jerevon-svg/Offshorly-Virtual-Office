import { describe, expect, it } from "vitest";
import {
  isPlainToucanText,
  parseInline,
  parseToucanMarkdown,
  safeHref,
} from "./toucanMarkdown";

// T9 — the Markdown subset behind assistant replies. Two things matter here and
// they are tested separately: (1) the structure an office answer actually uses
// is recognised, and (2) nothing a model writes can become anything other than
// text or an http/https/mailto link.

describe("safeHref", () => {
  it("accepts http, https and mailto", () => {
    expect(safeHref("https://example.com/x?y=1")).toBe("https://example.com/x?y=1");
    expect(safeHref("http://example.com")).toBe("http://example.com");
    expect(safeHref("mailto:someone@offshorly.com")).toBe("mailto:someone@offshorly.com");
    // Surrounding whitespace is the model's, not the user's intent.
    expect(safeHref("  https://example.com  ")).toBe("https://example.com");
  });

  it("rejects every scheme that could execute or embed something", () => {
    for (const href of [
      "javascript:alert(1)",
      "JavaScript:alert(1)",
      "  javascript:alert(1)",
      "data:text/html;base64,PHNjcmlwdD4=",
      "vbscript:msgbox",
      "file:///etc/passwd",
      "//evil.example.com",
      "/relative/path",
      "example.com",
      "",
    ]) {
      expect(safeHref(href)).toBeNull();
    }
  });

  it("rejects a scheme smuggled past the prefix check with control characters", () => {
    expect(safeHref("java\u0000script:alert(1)")).toBeNull();
    expect(safeHref("java\nscript:alert(1)")).toBeNull();
    // A control character the URL grammar would otherwise tolerate.
    expect(safeHref("https://exa\u0000mple.com")).toBeNull();
  });
});

describe("parseInline", () => {
  it("reads bold, italic and inline code", () => {
    expect(parseInline("**bold** and *italic* and `code`")).toEqual([
      { type: "strong", children: [{ type: "text", value: "bold" }] },
      { type: "text", value: " and " },
      { type: "em", children: [{ type: "text", value: "italic" }] },
      { type: "text", value: " and " },
      { type: "code", value: "code" },
    ]);
  });

  it("never re-parses the inside of a code span", () => {
    expect(parseInline("`**not bold** [not a link](https://x.test)`")).toEqual([
      { type: "code", value: "**not bold** [not a link](https://x.test)" },
    ]);
  });

  it("leaves snake_case identifiers alone", () => {
    expect(parseInline("owner_email is not italic")).toEqual([
      { type: "text", value: "owner_email is not italic" },
    ]);
  });

  it("turns a safe link into a link node", () => {
    expect(parseInline("see [the docs](https://example.com/docs)")).toEqual([
      { type: "text", value: "see " },
      {
        type: "link",
        href: "https://example.com/docs",
        children: [{ type: "text", value: "the docs" }],
      },
    ]);
  });

  it("degrades an unsafe link to its label, producing no link node", () => {
    for (const source of [
      "[click me](javascript:alert1)",
      "[click me](data:text/html,x)",
      "[click me](/office/admin)",
    ]) {
      const nodes = parseInline(source);
      expect(nodes.some((node) => node.type === "link")).toBe(false);
      expect(nodes).toContainEqual({ type: "text", value: "click me" });
    }
  });

  it("leaves a link whose target contains brackets entirely literal", () => {
    // The href grammar excludes parentheses, so `javascript:alert(1)` never even
    // reaches safeHref — the construct simply is not a link and stays text.
    expect(parseInline("[click me](javascript:alert(1))")).toEqual([
      { type: "text", value: "[click me](javascript:alert(1))" },
    ]);
  });

  it("keeps a soft newline as a break", () => {
    expect(parseInline("one\ntwo")).toEqual([
      { type: "text", value: "one" },
      { type: "break" },
      { type: "text", value: "two" },
    ]);
  });
});

describe("parseToucanMarkdown", () => {
  it("splits paragraphs on blank lines", () => {
    const blocks = parseToucanMarkdown("first para\n\nsecond para");
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toEqual({
      type: "paragraph",
      children: [{ type: "text", value: "first para" }],
    });
  });

  it("reads headings, bullets, numbered lists, quotes and rules", () => {
    const blocks = parseToucanMarkdown(
      ["## Who's online", "- Micah", "- Angelo", "", "1. first", "2. second", "", "> a note", "", "---"].join(
        "\n",
      ),
    );
    expect(blocks.map((block) => block.type)).toEqual([
      "heading",
      "list",
      "list",
      "quote",
      "rule",
    ]);
    const [heading, bullets, numbered] = blocks;
    expect(heading).toMatchObject({ type: "heading", level: 2 });
    expect(bullets).toMatchObject({ type: "list", ordered: false });
    expect(numbered).toMatchObject({ type: "list", ordered: true, start: 1 });
    if (bullets.type === "list") expect(bullets.items).toHaveLength(2);
  });

  it("keeps a bullet list and a numbered list separate", () => {
    const blocks = parseToucanMarkdown("- a\n1. b");
    expect(blocks.map((block) => block.type)).toEqual(["list", "list"]);
  });

  it("preserves a fenced code block's whitespace verbatim, and its language", () => {
    const blocks = parseToucanMarkdown("```python\ndef f():\n    return 1\n```");
    expect(blocks).toEqual([
      { type: "codeBlock", lang: "python", value: "def f():\n    return 1" },
    ]);
  });

  it("treats an unclosed fence as a code block to the end of the message", () => {
    const blocks = parseToucanMarkdown("```\nhalf a snippet");
    expect(blocks).toEqual([{ type: "codeBlock", lang: null, value: "half a snippet" }]);
  });

  it("does not parse Markdown inside a fenced block", () => {
    const blocks = parseToucanMarkdown("```\n# not a heading\n- not a list\n```");
    expect(blocks).toEqual([
      { type: "codeBlock", lang: null, value: "# not a heading\n- not a list" },
    ]);
  });

  it("keeps raw HTML as literal text — there is no HTML node type to become", () => {
    const blocks = parseToucanMarkdown('<img src=x onerror="alert(1)"> <script>alert(1)</script>');
    expect(blocks).toEqual([
      {
        type: "paragraph",
        children: [
          { type: "text", value: '<img src=x onerror="alert(1)"> <script>alert(1)</script>' },
        ],
      },
    ]);
  });
});

describe("isPlainToucanText", () => {
  it("is true for the ordinary one-line office answer", () => {
    for (const text of [
      "Micah is in the Design room.",
      "Squawk! I'm the office toucan — parked right beside you.",
      "Nobody's in a call right now. 3 people are online: Bon, Micah, Angelo.",
      "Done — your status is now Busy.",
    ]) {
      expect(isPlainToucanText(text)).toBe(true);
    }
  });

  it("is false as soon as there is real structure", () => {
    for (const text of [
      "**bold**",
      "- a bullet",
      "# heading",
      "```\ncode\n```",
      "two\nlines",
      "para\n\npara",
      "`inline`",
      "[a link](https://example.com)",
    ]) {
      expect(isPlainToucanText(text)).toBe(false);
    }
  });
});

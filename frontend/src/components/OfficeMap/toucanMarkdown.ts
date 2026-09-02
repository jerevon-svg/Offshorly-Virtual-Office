// Toucan message Markdown — PARSER ONLY (no React, no DOM, no HTML strings).
//
// WHY A HAND-ROLLED SUBSET, AND WHY IT IS THE SAFE CHOICE
// ------------------------------------------------------
// The assistant's replies now come from a language model (T6), so they arrive
// with Markdown in them. Rendering that had two candidate shapes:
//
//   (a) a Markdown library -> HTML string -> sanitiser -> dangerouslySetInnerHTML
//   (b) a small parser -> a typed AST -> React elements
//
// This is (b), deliberately. There is NO HTML string anywhere in this pipeline
// and no `dangerouslySetInnerHTML` in the renderer, so there is nothing for a
// sanitiser to be the last line of defence for: every leaf of the tree is a
// JavaScript string that React escapes when it puts it in the document. Raw
// HTML in a reply is therefore not "stripped" — it is never HTML in the first
// place. `<img onerror=...>` in a model reply is text, and shows as text.
//
// The one place a model-supplied value would otherwise reach a live DOM
// attribute is a link's href, so that is validated here (see `safeHref`):
// http/https/mailto only, everything else degrades to the label as plain text.
//
// SUPPORTED SUBSET (everything an office answer actually uses):
//   paragraphs, soft line breaks, # ## ### headings, - * + bullets,
//   1. ordered lists, > quotes, --- rules, `inline code`, ``` fenced code ```,
//   **bold**, *italic*, [label](https://…)
//
// DELIBERATELY NOT SUPPORTED (documented, not accidental): raw HTML (see above),
// tables, images, footnotes, reference links, nested lists (a nested bullet
// degrades to a sibling bullet — still readable), backslash escapes.

export type ToucanInline =
  | { type: "text"; value: string }
  | { type: "code"; value: string }
  | { type: "strong"; children: ToucanInline[] }
  | { type: "em"; children: ToucanInline[] }
  | { type: "link"; href: string; children: ToucanInline[] }
  | { type: "break" };

export type ToucanBlock =
  | { type: "paragraph"; children: ToucanInline[] }
  | { type: "heading"; level: 1 | 2 | 3; children: ToucanInline[] }
  | { type: "list"; ordered: boolean; start: number; items: ToucanInline[][] }
  | { type: "quote"; children: ToucanInline[] }
  | { type: "codeBlock"; lang: string | null; value: string }
  | { type: "rule" };

const FENCE_RE = /^\s{0,3}```([A-Za-z0-9_+-]*)\s*$/;
const HEADING_RE = /^\s{0,3}(#{1,3})\s+(.+?)\s*#*\s*$/;
const BULLET_RE = /^\s{0,6}[-*+][ \t]+(.*)$/;
const ORDERED_RE = /^\s{0,6}(\d{1,9})[.)][ \t]+(.*)$/;
const QUOTE_RE = /^\s{0,3}>[ \t]?(.*)$/;
const RULE_RE = /^\s{0,3}(?:-{3,}|\*{3,}|_{3,})\s*$/;

/** The only protocols a rendered link may carry. `javascript:`, `data:`, `vbscript:`
 *  and every protocol-relative or unknown scheme fail this and are rendered as
 *  plain text instead — a model cannot get an executable href into the panel. */
const SAFE_HREF_RE = /^(?:https?:\/\/|mailto:)[^\s<>]+$/i;

/** Control characters are how `java\nscript:`-style bypasses are smuggled past a
 *  naive prefix check; reject them outright rather than normalising them away. */
// Matching control characters is the entire point of this guard, and they are
// already written as Unicode escapes — so the usual warning does not apply.
// oxlint-disable-next-line no-control-regex
const CONTROL_CHARS_RE = /[\u0000-\u001f\u007f-\u009f]/;

export function safeHref(raw: string): string | null {
  const href = raw.trim();
  if (CONTROL_CHARS_RE.test(href)) return null;
  return SAFE_HREF_RE.test(href) ? href : null;
}

// --- inline ------------------------------------------------------------------
//
// One left-to-right scan. Inline code wins over everything (its content is
// never re-parsed), then links, then bold, then italic — the same precedence
// order CommonMark ends up with for this subset, arrived at by trying the
// longest/most-specific opener first at each position.

// The `_` variants carry word-boundary guards the `*` variants don't need, so
// snake_case_identifiers and file_names in an answer stay literal instead of
// turning half of themselves italic.
const INLINE_PATTERN = [
  /(?<codeTicks>`+)(?<code>[\s\S]*?)\k<codeTicks>/.source,
  /\[(?<label>[^\]\n]*)\]\((?<href>[^()\s]*)\)/.source,
  /\*\*(?<strongStar>[\s\S]+?)\*\*/.source,
  /(?<![A-Za-z0-9_])__(?<strongUnderscore>[\s\S]+?)__(?![A-Za-z0-9_])/.source,
  /\*(?<emStar>[^\s*][\s\S]*?)\*/.source,
  /(?<![A-Za-z0-9_])_(?<emUnderscore>[^\s_][\s\S]*?)_(?![A-Za-z0-9_])/.source,
].join("|");

/** Splits a run of plain text into text nodes and `break` nodes, so a soft
 *  newline inside a paragraph survives as a line break rather than collapsing. */
function pushText(out: ToucanInline[], value: string): void {
  if (!value) return;
  const pieces = value.split("\n");
  pieces.forEach((piece, index) => {
    if (index > 0) out.push({ type: "break" });
    if (piece) out.push({ type: "text", value: piece });
  });
}

export function parseInline(source: string): ToucanInline[] {
  const out: ToucanInline[] = [];
  let cursor = 0;
  // A FRESH scanner per call, not a shared /g/ regex. This function recurses
  // into the content of a bold/italic/link node, and a shared regex's lastIndex
  // is per-regex, not per-call: the inner scan would rewind the outer one to the
  // top of its own string and re-match the same token for ever.
  const scanner = new RegExp(INLINE_PATTERN, "g");
  for (let match = scanner.exec(source); match; match = scanner.exec(source)) {
    const groups = match.groups ?? {};
    pushText(out, source.slice(cursor, match.index));
    cursor = match.index + match[0].length;

    if (groups.code !== undefined) {
      // A code span is a single run: newlines inside it become spaces, and one
      // symmetric padding space is trimmed, exactly as CommonMark does.
      const value = groups.code.replace(/\n/g, " ");
      out.push({ type: "code", value: value.replace(/^ (.*) $/, "$1") });
      continue;
    }
    if (groups.href !== undefined) {
      const href = safeHref(groups.href);
      // An unsafe or unrecognised target keeps the human-readable label and
      // loses the link — no anchor is created at all.
      if (href) out.push({ type: "link", href, children: parseInline(groups.label ?? "") });
      else pushText(out, groups.label ?? "");
      continue;
    }
    const strong = groups.strongStar ?? groups.strongUnderscore;
    if (strong !== undefined) {
      out.push({ type: "strong", children: parseInline(strong) });
      continue;
    }
    const em = groups.emStar ?? groups.emUnderscore;
    if (em !== undefined) {
      out.push({ type: "em", children: parseInline(em) });
      continue;
    }
  }
  pushText(out, source.slice(cursor));
  return out;
}

// --- blocks ------------------------------------------------------------------

function startsNewBlock(line: string): boolean {
  return (
    FENCE_RE.test(line) ||
    HEADING_RE.test(line) ||
    RULE_RE.test(line) ||
    QUOTE_RE.test(line) ||
    BULLET_RE.test(line) ||
    ORDERED_RE.test(line)
  );
}

export function parseToucanMarkdown(source: string): ToucanBlock[] {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const blocks: ToucanBlock[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (!line.trim()) {
      i += 1;
      continue;
    }

    const fence = FENCE_RE.exec(line);
    if (fence) {
      const body: string[] = [];
      i += 1;
      // An UNCLOSED fence still renders as a code block to the end of the
      // message — a truncated reply must not fall back to showing its own
      // backticks as prose.
      while (i < lines.length && !FENCE_RE.test(lines[i])) {
        body.push(lines[i]);
        i += 1;
      }
      if (i < lines.length) i += 1;
      blocks.push({ type: "codeBlock", lang: fence[1] || null, value: body.join("\n") });
      continue;
    }

    const heading = HEADING_RE.exec(line);
    if (heading) {
      blocks.push({
        type: "heading",
        level: heading[1].length as 1 | 2 | 3,
        children: parseInline(heading[2]),
      });
      i += 1;
      continue;
    }

    if (RULE_RE.test(line)) {
      blocks.push({ type: "rule" });
      i += 1;
      continue;
    }

    if (QUOTE_RE.test(line)) {
      const body: string[] = [];
      for (let quoted = QUOTE_RE.exec(lines[i]); quoted; quoted = QUOTE_RE.exec(lines[i] ?? "")) {
        body.push(quoted[1]);
        i += 1;
        if (i >= lines.length) break;
      }
      blocks.push({ type: "quote", children: parseInline(body.join("\n")) });
      continue;
    }

    const bullet = BULLET_RE.exec(line);
    const ordered = ORDERED_RE.exec(line);
    if (bullet || ordered) {
      // A bullet marker wins when a line somehow matches both, so `- 1. x`
      // stays one bullet rather than becoming a numbered item.
      const isOrdered = !bullet;
      const start = ordered ? Number(ordered[1]) : 1;
      const items: ToucanInline[][] = [];
      while (i < lines.length) {
        const nextBullet = BULLET_RE.exec(lines[i]);
        const nextOrdered = ORDERED_RE.exec(lines[i]);
        // A list ends where its own marker stops, so a bullet list and a
        // numbered list next to each other stay two separate lists.
        if (isOrdered ? !nextOrdered : !nextBullet) break;
        items.push(parseInline(isOrdered ? nextOrdered![2] : nextBullet![1]));
        i += 1;
      }
      blocks.push({ type: "list", ordered: isOrdered, start, items });
      continue;
    }

    // Paragraph: everything up to a blank line or the start of another block.
    const paragraph: string[] = [];
    while (i < lines.length) {
      const current = lines[i];
      if (!current.trim()) break;
      if (paragraph.length > 0 && startsNewBlock(current)) break;
      paragraph.push(current);
      i += 1;
    }
    blocks.push({ type: "paragraph", children: parseInline(paragraph.join("\n")) });
  }

  return blocks;
}

/** True when the message carries no Markdown at all — one paragraph, one plain
 *  text run, byte-identical to the input.
 *
 *  This exists so the overwhelmingly common case (a one-line deterministic
 *  office answer, the greeting, a confirm/cancel outcome line) renders through
 *  the EXACT same DOM it always did: the bare string inside the chat bubble,
 *  with the chat stylesheet's own `white-space: pre-wrap`. Markdown structure is
 *  opted into by the message's own content, never imposed on every message. */
export function isPlainToucanText(source: string): boolean {
  const blocks = parseToucanMarkdown(source);
  if (blocks.length !== 1) return false;
  const [block] = blocks;
  if (block.type !== "paragraph" || block.children.length !== 1) return false;
  const [inline] = block.children;
  return inline.type === "text" && inline.value === source;
}

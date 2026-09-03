import { useCallback, useEffect, useRef, useState } from "react";
import styles from "./ToucanMessageBody.module.css";
import { copyToClipboard } from "./toucanClipboard";
import {
  isPlainToucanText,
  parseToucanMarkdown,
  type ToucanBlock,
  type ToucanInline,
} from "./toucanMarkdown";

// Renders one assistant message's body.
//
// SAFETY, STRUCTURALLY: this file contains no `dangerouslySetInnerHTML` and
// builds no HTML strings. It maps the typed AST from toucanMarkdown.ts onto
// React elements, so every model-supplied string arrives as a text child (React
// escapes it) or as an href the parser already restricted to http/https/mailto.
// There is nothing here for a sanitiser to catch because nothing here is parsed
// as HTML — see the long note at the top of toucanMarkdown.ts.
//
// PLAIN TEXT IS THE FAST PATH. A message with no Markdown in it renders as the
// bare string, exactly as it did before T9: same DOM, same chat-stylesheet
// `white-space: pre-wrap`. Only a message that actually contains Markdown gets
// block elements (and the `markdown` class that switches the bubble's
// white-space handling over to the blocks themselves).
//
// USER MESSAGES DO NOT COME THROUGH HERE. They are the viewer's own literal
// keystrokes and stay plain text in the panel — the smallest possible surface,
// and nothing is lost because nobody types Markdown at a bird.

export function ToucanMessageBody({ text }: { text: string }) {
  if (isPlainToucanText(text)) return <>{text}</>;
  const blocks = parseToucanMarkdown(text);
  return (
    <div className={styles.markdown}>
      {blocks.map((block, index) => (
        <Block key={index} block={block} />
      ))}
    </div>
  );
}

function Block({ block }: { block: ToucanBlock }) {
  switch (block.type) {
    case "paragraph":
      return (
        <p className={styles.paragraph}>
          <Inlines nodes={block.children} />
        </p>
      );
    case "heading": {
      // Headings inside a chat bubble are typographic, not document structure —
      // h4/h5/h6 keeps them below the panel's own dialog heading level.
      const Tag = (["h4", "h5", "h6"] as const)[block.level - 1];
      return (
        <Tag className={styles.heading}>
          <Inlines nodes={block.children} />
        </Tag>
      );
    }
    case "list": {
      const items = block.items.map((item, index) => (
        <li key={index} className={styles.listItem}>
          <Inlines nodes={item} />
        </li>
      ));
      return block.ordered ? (
        <ol className={styles.list} start={block.start}>
          {items}
        </ol>
      ) : (
        <ul className={styles.list}>{items}</ul>
      );
    }
    case "quote":
      return (
        <blockquote className={styles.quote}>
          <Inlines nodes={block.children} />
        </blockquote>
      );
    case "codeBlock":
      return <CodeBlock lang={block.lang} value={block.value} />;
    case "rule":
      return <hr className={styles.rule} />;
  }
}

function Inlines({ nodes }: { nodes: ToucanInline[] }) {
  return (
    <>
      {nodes.map((node, index) => (
        <InlineNode key={index} node={node} />
      ))}
    </>
  );
}

function InlineNode({ node }: { node: ToucanInline }) {
  switch (node.type) {
    case "text":
      return <>{node.value}</>;
    case "break":
      return <br />;
    case "code":
      return <code className={styles.inlineCode}>{node.value}</code>;
    case "strong":
      return (
        <strong>
          <Inlines nodes={node.children} />
        </strong>
      );
    case "em":
      return (
        <em>
          <Inlines nodes={node.children} />
        </em>
      );
    case "link":
      // The href already passed the parser's protocol allowlist. `noopener
      // noreferrer` because the target is model-supplied: a new tab must not get
      // a handle on this window, and must not carry the office URL as referrer.
      return (
        <a
          className={styles.link}
          href={node.href}
          target="_blank"
          rel="noopener noreferrer nofollow"
        >
          <Inlines nodes={node.children} />
        </a>
      );
  }
}

// How long "Copied" stays before the button goes back to its resting label.
const COPIED_FEEDBACK_MS = 1600;

function CodeBlock({ lang, value }: { lang: string | null; value: string }) {
  const [copied, setCopied] = useState<"idle" | "done" | "failed">("idle");
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    };
  }, []);

  const handleCopy = useCallback(() => {
    void copyToClipboard(value).then((ok) => {
      setCopied(ok ? "done" : "failed");
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null;
        setCopied("idle");
      }, COPIED_FEEDBACK_MS);
    });
  }, [value]);

  return (
    <div className={styles.codeBlock}>
      <div className={styles.codeHeader}>
        {/* The language label is the fence's own info string, already narrowed
            to [A-Za-z0-9_+-] by the parser. No highlighting is claimed — the
            label says what the reply said it was, nothing more. */}
        <span className={styles.codeLang}>{lang ?? "code"}</span>
        <button
          type="button"
          className={styles.codeCopy}
          onClick={handleCopy}
          aria-label="Copy code"
        >
          {copied === "done" ? "Copied" : copied === "failed" ? "Couldn't copy" : "Copy"}
        </button>
      </div>
      {/* `pre` keeps the whitespace; the scroll container is the pre itself, so
          a wide line scrolls sideways INSIDE the bubble and never widens the
          320px panel. */}
      <pre className={styles.pre}>
        <code>{value}</code>
      </pre>
    </div>
  );
}

export default ToucanMessageBody;

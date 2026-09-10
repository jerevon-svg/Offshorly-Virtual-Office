// @ts-expect-error node:fs is untyped under tsconfig.app.json (types: ["vite/client"] only) —
// same exemption services/notifications/devIdentityHmr.test.ts takes. vitest runs with cwd = frontend/.
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { TransformWrapper, TransformComponent } from "react-zoom-pan-pinch";
import { OfficeStage } from "./OfficeStage";
import { OVERHEAD_CLEARANCE_PX, type ChatAttention } from "./chatAttention";
import type { OfficeStatus } from "../../services/presence/status";
import styles from "./ChatAttentionIndicator.module.css";
import statusStyles from "./StatusLabel.module.css";

// Same rendering pattern as StatusLabel.test.tsx / TalkingBubble.test.tsx:
// the badge scales with the scene (no KeepScale), but OfficeStage still lives
// inside a TransformWrapper/TransformComponent in production.
function renderStage(opts: {
  chatAttentionByLayerId?: Record<string, ChatAttention>;
  onChatAttentionClick?: (attention: ChatAttention, layerId: string) => void;
  selfCharacterId?: string;
  selfStatus?: OfficeStatus;
  statusByLayerId?: Record<string, OfficeStatus>;
  showStatusLabels?: boolean;
  typingCharacterIds?: string[];
  talkingTextById?: Record<string, string>;
  greetingCharacterId?: string;
  resolveCharacterDisplayName?: (layerId: string) => string;
}) {
  return render(
    <TransformWrapper>
      <TransformComponent>
        <OfficeStage {...opts} />
      </TransformComponent>
    </TransformWrapper>,
  );
}

function badges(container: HTMLElement) {
  return [...container.querySelectorAll(`.${styles.button}`)] as HTMLElement[];
}

function pointerClick(el: HTMLElement) {
  // useClickVsDrag only fires onClick when down/up stay within 6px.
  el.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0, clientX: 10, clientY: 10 }));
  el.dispatchEvent(new MouseEvent("pointerup", { bubbles: true, button: 0, clientX: 11, clientY: 10 }));
}

const ALEX: ChatAttention = { conversationId: "conv-alex", count: 1 };

describe("ChatAttentionIndicator via OfficeStage", () => {
  it("renders nothing when no chat attention map is passed", () => {
    const { container } = renderStage({ showStatusLabels: true, selfCharacterId: "bon", selfStatus: "AVAILABLE" });
    expect(badges(container)).toHaveLength(0);
  });

  it("renders exactly one badge for a coworker with unread messages", () => {
    const { container } = renderStage({
      selfCharacterId: "bon",
      chatAttentionByLayerId: { alex: ALEX },
    });
    const found = badges(container);
    expect(found).toHaveLength(1);
    expect(found[0].querySelector("img")?.getAttribute("src")).toContain("chat");
  });

  it("never renders a badge above the viewer's own avatar", () => {
    const { container } = renderStage({
      selfCharacterId: "bon",
      // Even if a caller mistakenly includes self, the stage drops it.
      chatAttentionByLayerId: { bon: { conversationId: "conv-self", count: 4 } },
    });
    expect(badges(container)).toHaveLength(0);
  });

  it("shows one badge per coworker, not one per unread message", () => {
    const { container } = renderStage({
      selfCharacterId: "bon",
      chatAttentionByLayerId: {
        alex: { conversationId: "conv-alex", count: 7 },
        micah: { conversationId: "conv-micah", count: 2 },
      },
    });
    expect(badges(container)).toHaveLength(2);
  });

  it("shows a count only when more than one message is unread, capped at 9+", () => {
    const one = renderStage({ selfCharacterId: "bon", chatAttentionByLayerId: { alex: ALEX } });
    expect(badges(one.container)[0].querySelector(`.${styles.count}`)).toBeNull();

    const few = renderStage({
      selfCharacterId: "bon",
      chatAttentionByLayerId: { alex: { conversationId: "c", count: 3 } },
    });
    expect(badges(few.container)[0].querySelector(`.${styles.count}`)?.textContent).toBe("3");

    const many = renderStage({
      selfCharacterId: "bon",
      chatAttentionByLayerId: { alex: { conversationId: "c", count: 42 } },
    });
    expect(badges(many.container)[0].querySelector(`.${styles.count}`)?.textContent).toBe("9+");
  });

  it("opens that coworker's existing conversation on click", () => {
    const onChatAttentionClick = vi.fn();
    const { container } = renderStage({
      selfCharacterId: "bon",
      chatAttentionByLayerId: { alex: ALEX },
      onChatAttentionClick,
    });
    pointerClick(badges(container)[0]);
    expect(onChatAttentionClick).toHaveBeenCalledWith(ALEX, "alex");
  });

  it("does not fire on a drag (pan) across the badge", () => {
    const onChatAttentionClick = vi.fn();
    const { container } = renderStage({
      selfCharacterId: "bon",
      chatAttentionByLayerId: { alex: ALEX },
      onChatAttentionClick,
    });
    const badge = badges(container)[0];
    badge.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0, clientX: 10, clientY: 10 }));
    badge.dispatchEvent(new MouseEvent("pointerup", { bubbles: true, button: 0, clientX: 60, clientY: 40 }));
    expect(onChatAttentionClick).not.toHaveBeenCalled();
  });

  it("uses the caller's display-name resolver for its accessible label", () => {
    const { container } = renderStage({
      selfCharacterId: "bon",
      chatAttentionByLayerId: { alex: { conversationId: "c", count: 2 } },
      resolveCharacterDisplayName: () => "Alexandra",
    });
    expect(badges(container)[0].getAttribute("aria-label")).toBe(
      "Open chat with Alexandra — 2 unread messages",
    );
  });

  it("coexists with the coworker's status nameplate, stacked above it", () => {
    const { container } = renderStage({
      showStatusLabels: true,
      selfCharacterId: "bon",
      selfStatus: "AVAILABLE",
      statusByLayerId: { alex: "BUSY" },
      chatAttentionByLayerId: { alex: ALEX },
    });
    // The nameplate is untouched — the indicator is additive, not exclusive.
    const pills = [...container.querySelectorAll(`.${statusStyles.pill}`)];
    expect(pills.some((el) => el.textContent?.includes("Alex"))).toBe(true);
    expect(badges(container)).toHaveLength(1);
    const badge = container.querySelector(`.${styles.badge}`) as HTMLElement;
    expect(badge.style.transform).toContain(`${OVERHEAD_CLEARANCE_PX.status}px`);
  });

  it("clears the taller wrapping bubble when the coworker has a chat bubble up", () => {
    const { container } = renderStage({
      showStatusLabels: true,
      selfCharacterId: "bon",
      statusByLayerId: { alex: "BUSY" },
      talkingTextById: { alex: "hey, got a sec?" },
      chatAttentionByLayerId: { alex: ALEX },
    });
    const badge = container.querySelector(`.${styles.badge}`) as HTMLElement;
    expect(badge.style.transform).toContain(`${OVERHEAD_CLEARANCE_PX.sentText}px`);
  });

  it("sits right above the head when the coworker has no overhead element at all", () => {
    const { container } = renderStage({
      selfCharacterId: "bon",
      chatAttentionByLayerId: { alex: ALEX },
    });
    const badge = container.querySelector(`.${styles.badge}`) as HTMLElement;
    expect(badge.style.transform).toContain(`${OVERHEAD_CLEARANCE_PX.none}px`);
  });

  it("anchors to the coworker's live walked-to position, not their static layer", () => {
    const withOverride = renderStage({
      selfCharacterId: "bon",
      chatAttentionByLayerId: { alex: ALEX },
    });
    const staticAnchor = (withOverride.container.querySelector(`.${styles.anchor}`) as HTMLElement).style.left;

    const moved = render(
      <TransformWrapper>
        <TransformComponent>
          <OfficeStage
            selfCharacterId="bon"
            chatAttentionByLayerId={{ alex: ALEX }}
            characterOverrides={{ alex: { x: 1200, y: 900 } }}
          />
        </TransformComponent>
      </TransformWrapper>,
    );
    const movedAnchor = (moved.container.querySelector(`.${styles.anchor}`) as HTMLElement).style.left;
    expect(movedAnchor).not.toBe(staticAnchor);
  });

  it("renders no badge for a coworker who isn't on the floor", () => {
    const { container } = renderStage({
      selfCharacterId: "bon",
      chatAttentionByLayerId: { "offline-person@offshorly.com": { conversationId: "c", count: 3 } },
    });
    expect(badges(container)).toHaveLength(0);
  });

  it("renders no badge for a coworker whose layer is hidden", () => {
    const { container } = renderStage({
      selfCharacterId: "bon",
      chatAttentionByLayerId: { alex: ALEX },
    });
    expect(badges(container)).toHaveLength(1);

    const hidden = render(
      <TransformWrapper>
        <TransformComponent>
          <OfficeStage
            selfCharacterId="bon"
            chatAttentionByLayerId={{ alex: ALEX }}
            hiddenCharacterIds={["alex"]}
          />
        </TransformComponent>
      </TransformWrapper>,
    );
    expect(badges(hidden.container)).toHaveLength(0);
  });

  it("sizes the badge to its content instead of collapsing against the 0x0 anchor", () => {
    const { container } = renderStage({
      selfCharacterId: "bon",
      chatAttentionByLayerId: { alex: { conversationId: "c", count: 5 } },
    });
    // The badge renders at all...
    expect(badges(container)).toHaveLength(1);
    // ...and its rule carries the sizing that keeps it from collapsing. Asserted against the
    // stylesheet SOURCE, not getComputedStyle: vitest maps CSS modules to a class-name object
    // and never loads the real rules into jsdom, so a computed-style assertion would pass
    // vacuously. Regression guard for the 0-width-containing-block trap — an absolutely
    // positioned box shrink-to-fits to nothing against a 0x0 anchor, breaking the emoji and
    // count onto separate lines (see .bubbleText's documented version of the same trap).
    const css = readFileSync("src/components/OfficeMap/ChatAttentionIndicator.module.css", "utf8");
    const badgeRule = /\.badge \{([\s\S]*?)\n\}/.exec(css)?.[1] ?? "";
    expect(badgeRule).toMatch(/width: max-content;/);
    const buttonRule = /\.button \{([\s\S]*?)\n\}/.exec(css)?.[1] ?? "";
    expect(buttonRule).toMatch(/white-space: nowrap;/);
  });

  it("does not use KeepScale — the badge scales with the scene like the nameplate", () => {
    const { container } = renderStage({
      selfCharacterId: "bon",
      chatAttentionByLayerId: { alex: ALEX },
    });
    const anchor = container.querySelector(`.${styles.anchor}`) as HTMLElement;
    // react-zoom-pan-pinch's KeepScale renders its own wrapper div with an
    // inline scale transform; the badge's anchor must be a plain positioned
    // point instead, so zoom scales it along with the avatar underneath.
    expect(anchor.style.transform).toBe("");
    expect(anchor.style.left.endsWith("%")).toBe(true);
    expect(anchor.style.top.endsWith("%")).toBe(true);
  });
});

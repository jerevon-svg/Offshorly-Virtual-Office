import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { TransformWrapper, TransformComponent } from "react-zoom-pan-pinch";
import { OfficeStage } from "./OfficeStage";
import { greetingAnchor } from "./panMath";
import { LIVE_3D_CHARACTERS } from "../../render3d/live3dCharacters";
import { characterLayers } from "../../data/office-layout";
import styles from "./TalkingBubble.module.css";

// TalkingBubble no longer uses KeepScale (removed to match StatusLabel's
// world-space scaling), and OfficeStage renders inside a
// TransformWrapper/TransformComponent in production, so mirror that ancestor
// context here too.
//
// typingCharacterIds (actively-typing, drives the dots variant) and
// talkingTextById (an unexpired sent message, drives the text variant) are
// the two props that gate the overhead TalkingBubble render in OfficeStage's
// per-character resolver — talkingCharacterIds ("conversation is open") no
// longer does (see OfficeStage.test.tsx's resolver-priority tests for that).
function renderStage(
  typingCharacterIds?: string[],
  talkingTextById?: Record<string, string>,
) {
  return render(
    <TransformWrapper>
      <TransformComponent>
        <OfficeStage
          typingCharacterIds={typingCharacterIds}
          talkingTextById={talkingTextById}
        />
      </TransformComponent>
    </TransformWrapper>,
  );
}

describe("OfficeStage typingCharacterIds / talkingTextById overhead bubble", () => {
  it("renders a talking bubble per known character id", () => {
    const { container } = renderStage(["bon", "alex"]);
    expect(container.querySelectorAll(`.${styles.bubble}`).length).toBe(2);
  });

  it("renders none when prop is omitted", () => {
    const { container } = renderStage();
    expect(container.querySelectorAll(`.${styles.bubble}`).length).toBe(0);
  });

  it("renders none when prop is an empty array", () => {
    const { container } = renderStage([]);
    expect(container.querySelectorAll(`.${styles.bubble}`).length).toBe(0);
  });

  it("skips unknown ids without crashing", () => {
    expect(() => renderStage(["bon", "not-a-real-id"])).not.toThrow();
    const { container } = renderStage(["bon", "not-a-real-id"]);
    expect(container.querySelectorAll(`.${styles.bubble}`).length).toBe(1);
  });

  it("renders text bubble instead of dots when talkingTextById has an entry", () => {
    const { container, getByText } = renderStage(["bon", "alex"], { bon: "Hello there!" });
    // bon has sent-text (higher priority than typing) -> text pill, not dots.
    expect(container.querySelectorAll(`.${styles.bubble}`).length).toBe(1);
    expect(container.querySelectorAll(`.${styles.bubbleText}`).length).toBe(1);
    expect(getByText("Hello there!")).toBeTruthy();
  });

  it("falls back to dots when talkingTextById is omitted", () => {
    const { container } = renderStage(["bon"], undefined);
    expect(container.querySelectorAll(`.${styles.bubble}`).length).toBe(1);
    expect(container.querySelectorAll(`.${styles.bubbleText}`).length).toBe(0);
  });

  it("does not apply an inline style/transform override to any bubble, even with 2+ participants (relies purely on CSS class offset, same as StatusLabel)", () => {
    const { container } = renderStage(["bon", "alex"]);
    const bubbles = [...container.querySelectorAll(`.${styles.bubble}`)];
    expect(bubbles.length).toBe(2);
    for (const bubble of bubbles) {
      expect(bubble.getAttribute("style")).toBeNull();
      expect((bubble as HTMLElement).style.transform).toBe("");
    }
  });

  it("anchors dead-center over the head via greetingAnchor, exactly like StatusLabel (no lateral sideOffset)", () => {
    const { container } = renderStage(["bon"]);
    const bonLayer = characterLayers.find((l) => l.id === "bon")!;
    // TalkingBubble deliberately shares StatusLabel's anchor, which for a
    // live-3D employee now hangs off the measured head rather than the layer's
    // top edge — so the expectation passes the same head offset.
    const expected = greetingAnchor(bonLayer, LIVE_3D_CHARACTERS.bon.headTopAboveCenter);
    const anchor = container.querySelector(`.${styles.anchor}`) as HTMLElement;
    expect(anchor.style.left).toBe(`${expected.leftPct}%`);
    expect(anchor.style.top).toBe(`${expected.topPct}%`);
  });
});

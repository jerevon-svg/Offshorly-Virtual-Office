import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { TransformWrapper, TransformComponent } from "react-zoom-pan-pinch";
import { OfficeStage } from "./OfficeStage";
import styles from "./TalkingBubble.module.css";

// TalkingBubble no longer uses KeepScale (removed to match StatusLabel's
// world-space scaling), but GreetingBubble still does and OfficeStage
// renders inside a TransformWrapper/TransformComponent in production, so
// mirror that ancestor context here too.
function renderStage(
  talkingCharacterIds?: string[],
  talkingTextById?: Record<string, string>,
) {
  return render(
    <TransformWrapper>
      <TransformComponent>
        <OfficeStage
          talkingCharacterIds={talkingCharacterIds}
          talkingTextById={talkingTextById}
        />
      </TransformComponent>
    </TransformWrapper>,
  );
}

describe("OfficeStage talkingCharacterIds", () => {
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
    expect(container.querySelectorAll(`.${styles.bubble}`).length).toBe(1);
    expect(container.querySelectorAll(`.${styles.bubbleText}`).length).toBe(1);
    expect(getByText("Hello there!")).toBeTruthy();
  });

  it("falls back to dots when talkingTextById is omitted", () => {
    const { container } = renderStage(["bon"], undefined);
    expect(container.querySelectorAll(`.${styles.bubble}`).length).toBe(1);
    expect(container.querySelectorAll(`.${styles.bubbleText}`).length).toBe(0);
  });
});

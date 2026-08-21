import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { TransformWrapper, TransformComponent } from "react-zoom-pan-pinch";
import { OfficeStage } from "./OfficeStage";
import { STATUS_META, type OfficeStatus } from "../../services/presence/status";
import styles from "./StatusLabel.module.css";

// KeepScale (used by StatusLabel, same as TalkingBubble/GreetingBubble) needs
// a TransformWrapper ancestor's context — mirror how OfficeMap actually
// renders OfficeStage (see TalkingBubble.test.tsx for the same pattern).
function renderStage(opts: {
  selfCharacterId?: string;
  selfStatus?: OfficeStatus;
  statusByLayerId?: Record<string, OfficeStatus>;
  showStatusLabels?: boolean;
  talkingCharacterIds?: string[];
  talkingTextById?: Record<string, string>;
}) {
  return render(
    <TransformWrapper>
      <TransformComponent>
        <OfficeStage
          selfCharacterId={opts.selfCharacterId}
          selfStatus={opts.selfStatus}
          statusByLayerId={opts.statusByLayerId}
          showStatusLabels={opts.showStatusLabels}
          talkingCharacterIds={opts.talkingCharacterIds}
          talkingTextById={opts.talkingTextById}
        />
      </TransformComponent>
    </TransformWrapper>,
  );
}

describe("StatusLabel via OfficeStage", () => {
  it("renders nothing when showStatusLabels is unset", () => {
    const { container } = renderStage({
      selfCharacterId: "bon",
      selfStatus: "AVAILABLE",
    });
    expect(container.querySelectorAll(`.${styles.pill}`).length).toBe(0);
  });

  it("shows 'You' for the self layer", () => {
    const { getByText } = renderStage({
      showStatusLabels: true,
      selfCharacterId: "bon",
      selfStatus: "AVAILABLE",
    });
    expect(getByText(/^You$/)).toBeTruthy();
  });

  it("shows the real formatted name for a non-self character", () => {
    const { getByText } = renderStage({
      showStatusLabels: true,
      selfCharacterId: "bon",
      selfStatus: "AVAILABLE",
      statusByLayerId: { alex: "BUSY" },
    });
    expect(getByText(/^Alex$/)).toBeTruthy();
  });

  it("adds the ' · Label' suffix only for the 3 active-detail statuses", () => {
    const { getByText, queryByText } = renderStage({
      showStatusLabels: true,
      selfCharacterId: "bon",
      selfStatus: "IN_CALL",
      statusByLayerId: { alex: "DND", micah: "AVAILABLE" },
    });
    expect(getByText(/You · In Call/)).toBeTruthy();
    expect(getByText(/Alex · DND/)).toBeTruthy();
    expect(queryByText(/Micah · /)).toBeNull();
  });

  it("colors the status dot to match STATUS_META", () => {
    const { container } = renderStage({
      showStatusLabels: true,
      selfCharacterId: "bon",
      selfStatus: "DND",
    });
    const dot = container.querySelector(`.${styles.dot}`) as HTMLElement;
    // jsdom normalizes hex -> rgb(); compare against a probe element set to
    // the same STATUS_META hex so the assertion isn't hardcoded to jsdom's
    // rgb() formatting.
    const probe = document.createElement("div");
    probe.style.backgroundColor = STATUS_META.DND.color;
    expect(dot.style.backgroundColor).toBe(probe.style.backgroundColor);
  });

  it("renders no label for a character with no known status", () => {
    const { container, queryByText } = renderStage({
      showStatusLabels: true,
      selfCharacterId: "bon",
      selfStatus: "AVAILABLE",
      // No entry for micah/lui/alex etc — those layers get no pill at all.
    });
    expect(queryByText(/Alex/)).toBeNull();
    // Only self's pill renders.
    expect(container.querySelectorAll(`.${styles.pill}`).length).toBe(1);
  });

  it("uses the tight default offset (no pillDotsActive/pillAboveText) when the layer has no active talking bubble", () => {
    const { container } = renderStage({
      showStatusLabels: true,
      selfCharacterId: "bon",
      selfStatus: "AVAILABLE",
      statusByLayerId: { alex: "IN_CONVERSATION" },
      // No talkingCharacterIds/talkingTextById at all — alex's status pill
      // should sit at the tight default clearance, not either bubble offset.
    });
    const alexPill = [...container.querySelectorAll(`.${styles.pill}`)].find((el) =>
      el.textContent?.includes("Alex"),
    ) as HTMLElement;
    expect(alexPill.className).not.toContain(styles.pillDotsActive);
    expect(alexPill.className).not.toContain(styles.pillAboveText);
  });

  it("uses the pillDotsActive offset, not pillAboveText, when the active bubble is the dots variant", () => {
    const { container, getByText } = renderStage({
      showStatusLabels: true,
      selfCharacterId: "bon",
      selfStatus: "AVAILABLE",
      statusByLayerId: { alex: "IN_CONVERSATION" },
      talkingCharacterIds: ["alex"],
      // talkingTextById omitted -> TalkingBubble falls back to the dots variant.
    });
    expect(getByText(/Alex · In Conversation/)).toBeTruthy();
    const alexPill = [...container.querySelectorAll(`.${styles.pill}`)].find((el) =>
      el.textContent?.includes("Alex"),
    ) as HTMLElement;
    expect(alexPill.className).toContain(styles.pillDotsActive);
    expect(alexPill.className).not.toContain(styles.pillAboveText);
  });

  it("uses the larger pillAboveText offset when the active bubble is the text variant", () => {
    const { container, getByText } = renderStage({
      showStatusLabels: true,
      selfCharacterId: "bon",
      selfStatus: "AVAILABLE",
      statusByLayerId: { alex: "IN_CONVERSATION" },
      talkingCharacterIds: ["alex"],
      talkingTextById: { alex: "Hey, got a minute to look at this?" },
    });
    expect(getByText(/Alex · In Conversation/)).toBeTruthy();
    const alexPill = [...container.querySelectorAll(`.${styles.pill}`)].find((el) =>
      el.textContent?.includes("Alex"),
    ) as HTMLElement;
    expect(alexPill.className).toContain(styles.pillAboveText);
  });
});

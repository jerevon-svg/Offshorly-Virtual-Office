// @ts-expect-error node:fs is untyped under tsconfig.app.json (types: ["vite/client"] only) —
// same exemption ChatAttentionIndicator.test.tsx takes. vitest runs with cwd = frontend/.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { TransformWrapper, TransformComponent } from "react-zoom-pan-pinch";
import { OfficeStage } from "./OfficeStage";
import type { AssetLayer } from "../../types/office";
import { STATUS_META, type OfficeStatus } from "../../services/presence/status";
import styles from "./StatusLabel.module.css";

// StatusLabel doesn't use KeepScale (it scales with the scene, same as
// TalkingBubble), but OfficeStage still renders inside a
// TransformWrapper/TransformComponent in production, so mirror that here too
// — see TalkingBubble.test.tsx for the same rendering pattern.
function renderStage(opts: {
  selfCharacterId?: string;
  selfStatus?: OfficeStatus;
  statusByLayerId?: Record<string, OfficeStatus>;
  showStatusLabels?: boolean;
  typingCharacterIds?: string[];
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
          typingCharacterIds={opts.typingCharacterIds}
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

  it("does not render a status pill for a character actively typing (mutual exclusivity)", () => {
    const { container, queryByText } = renderStage({
      showStatusLabels: true,
      selfCharacterId: "bon",
      selfStatus: "AVAILABLE",
      statusByLayerId: { alex: "IN_CONVERSATION" },
      typingCharacterIds: ["alex"],
    });
    // Alex is actively typing, so TalkingBubble renders instead of the
    // StatusLabel pill — no "Alex" pill text should be present.
    expect(queryByText(/Alex · In Conversation/)).toBeNull();
    // Self ("bon") has no active bubble, so its pill still renders normally.
    const pills = [...container.querySelectorAll(`.${styles.pill}`)];
    expect(pills.some((el) => el.textContent?.includes("You"))).toBe(true);
    expect(pills.some((el) => el.textContent?.includes("Alex"))).toBe(false);
  });

  // GEOMETRY IS GLOBAL. Asserted against the stylesheet SOURCE (jsdom never loads CSS-module
  // rules, so a computed-style check would pass vacuously): one .pill rule and one .dot rule,
  // no status-/name-/state-specific selector anywhere, and the dot pinned on every axis so the
  // only thing that can differ between two Available coworkers is the length of their name.
  it("gives every coworker the same pill geometry and a strictly identical status dot", () => {
    const css = readFileSync("src/components/OfficeMap/StatusLabel.module.css", "utf8");
    const selectors = [...css.matchAll(/^\.([\w-]+)[^{]*\{/gm)].map((m) => m[0].trim());
    expect(selectors).toEqual([".anchor {", ".pill {", ".dot {", ".text {"]);

    const rule = (cls: string) => new RegExp(`\\.${cls} \\{([\\s\\S]*?)\\n\\}`).exec(css)?.[1] ?? "";
    const pill = rule("pill");
    // Same 10.4px pill as always (1.4 line of 6px + 1px padding), as one inline line: the text on
    // its baseline, the dot `vertical-align: middle` — the font's own middle, no nudges.
    for (const token of [
      "font-size: 6px;",
      "padding: 1px 4px;",
      "border-radius: 999px;",
      "box-sizing: border-box;",
      "height: calc(1.4em + 2px);",
      "line-height: 1.4;",
    ]) {
      expect(pill, token).toContain(token);
    }
    expect(pill).not.toMatch(/^\s*display\s*:\s*flex/m);
    // No compositing hint: `will-change: transform` made every pill render soft (fixed raster
    // scale, GPU-upscaled on zoom). Crisp text over per-pill raster parity.
    expect(pill).not.toMatch(/^\s*will-change\s*:/m); // the declaration, not the comment explaining its absence
    const dot = rule("dot");
    for (const token of [
      "width: 3px;",
      "height: 3px;",
      "min-width: 3px;",
      "min-height: 3px;",
      "aspect-ratio: 1;",
      "border-radius: 50%;",
      "box-sizing: border-box;",
      "display: inline-block;",
      "vertical-align: middle;",
      "margin-right: 2.5px;",
    ]) {
      expect(dot, token).toContain(token);
    }
    expect(dot).not.toMatch(/^\s*transform\s*:/m); // centred by the font's metrics, not nudged
    expect(dot).not.toMatch(/^\s*flex\s*:/m);
    // No size in the markup either: the component sets colour only.
    const { container } = renderStage({
      showStatusLabels: true,
      selfCharacterId: "bon",
      selfStatus: "AVAILABLE",
      statusByLayerId: { alex: "AVAILABLE", micah: "BUSY" },
    });
    const dots = [...container.querySelectorAll(`.${styles.dot}`)] as HTMLElement[];
    expect(dots.length).toBeGreaterThanOrEqual(2);
    for (const d of dots) {
      expect(d.getAttribute("style")).toMatch(/^background-color: [^;]+;$/);
    }
  });

  // Two coworkers whose CHARACTER layers differ (box size, a per-layer CSS transform) must get
  // byte-identical label markup: the label is a sibling of the character, never its child, so
  // no character-specific dimension or transform can reach it. Only the anchor's left/top
  // percentages (where the head is) and the dot's colour may differ.
  it("gives coworkers with different character boxes/transforms the same label geometry", () => {
    // Injected the way saved avatars are (extraCharacterLayers): a small sprite-sized box and a
    // tall live-3D-style box carrying a per-layer transform.
    const extraCharacterLayers = [
      { id: "probe-small", kind: "character", name: "Small", x: 100, y: 100, width: 60, height: 90, path: "" },
      { id: "probe-tall@offshorly.com", kind: "character", name: "Tall", x: 400, y: 100, width: 60, height: 140, path: "", transform: "scale(1.3)" },
    ] as unknown as AssetLayer[];
    const { container } = render(
      <TransformWrapper>
        <TransformComponent>
          <OfficeStage
            extraCharacterLayers={extraCharacterLayers}
            showStatusLabels
            selfCharacterId="bon"
            selfStatus="AVAILABLE"
            statusByLayerId={{ "probe-small": "AVAILABLE", "probe-tall@offshorly.com": "BUSY" }}
          />
        </TransformComponent>
      </TransformWrapper>,
    );
    const pills = ([...container.querySelectorAll(`.${styles.pill}`)] as HTMLElement[]).filter((p) =>
      /Small|Tall/.test(p.textContent ?? ""),
    );
    expect(pills).toHaveLength(2);
    // Same class list, no inline sizing on the pill, dot or text — identical geometry by construction.
    expect(pills[0].className).toBe(pills[1].className);
    for (const pill of pills) {
      expect(pill.getAttribute("style")).toBeNull();
      expect(pill.querySelector(`.${styles.text}`)?.getAttribute("style")).toBeNull();
      expect(pill.querySelector(`.${styles.dot}`)?.getAttribute("style")).toMatch(/^background-color: [^;]+;$/);
      // The label must not live inside the (possibly transformed, differently sized) character layer.
      expect(pill.closest("[data-room-id], img, canvas")).toBeNull();
      const anchor = pill.parentElement as HTMLElement;
      expect(anchor.className).toBe(styles.anchor);
      expect(anchor.style.transform).toBe("");
      // Only the head position is inline — no size, scale or transform can be smuggled in here.
      expect(anchor.style.cssText).toMatch(/^left: [\d.]+%; top: [\d.]+%;$/);
    }
  });
});

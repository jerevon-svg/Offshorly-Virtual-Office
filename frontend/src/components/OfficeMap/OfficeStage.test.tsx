import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render } from "@testing-library/react";
import { TransformWrapper, TransformComponent } from "react-zoom-pan-pinch";
import { OfficeStage, __resetDeviceTierCacheForTests } from "./OfficeStage";
import { backrestCropLayerId } from "../../data/backSitOccupancy";
import { officeAssetLayers } from "../../data/office-layout";
import { createDepthCompare } from "./depthSort";
import { MIN_TIER_HOLD_MS } from "../../render3d/adaptiveLod";
import { LIVE_3D_CHARACTERS } from "../../render3d/live3dCharacters";
import { LIVE_3D_CAP_BY_TIER } from "../../services/render/tierBudgets";
import {
  collectDeviceSignals,
  detectDeviceTier,
  type DeviceCapabilitySignals,
} from "../../services/render/deviceTier";
import { getSharedDeviceTierMicrobench } from "../../services/render/deviceTierBenchmark";
import styles from "./OfficeStage.module.css";
import statusLabelStyles from "./StatusLabel.module.css";
import talkingBubbleStyles from "./TalkingBubble.module.css";

// Stub out the real (three.js/WebGL) CharacterCanvas for the live-3D
// dev-toggle tests below — jsdom has no WebGL context, and these tests only
// care about what props OfficeStage computes and passes down, not the
// renderer itself (that's CharacterCanvas's own concern, exercised
// separately). Re-exports the real directionToHeadingDegrees so the
// heading-math assertions below stay honest. The rendered stub exposes
// onError via a clickable button so tests can simulate a load failure and
// assert OfficeStage falls that specific character back to its sprite.
vi.mock("../../render3d/CharacterCanvas", async () => {
  const actual = await vi.importActual<typeof import("../../render3d/CharacterCanvas")>(
    "../../render3d/CharacterCanvas",
  );
  return {
    ...actual,
    CharacterCanvas: (props: {
      glbUrl: string;
      headingDegrees?: number;
      isWalking?: boolean;
      isSitting?: boolean;
      isGlobalChatActive?: boolean;
      isSpatialConversation?: boolean;
      isTyping?: boolean;
      width: number;
      height: number;
      onError?: () => void;
      animated?: boolean;
      maxQuality?: boolean;
      layerHeight?: number;
      widthScale?: number;
    }) => (
      <div
        data-testid="character-canvas-stub"
        data-glb-url={props.glbUrl}
        data-heading-degrees={props.headingDegrees}
        data-is-walking={props.isWalking}
        data-is-sitting={props.isSitting}
        data-is-spatial-conversation={props.isSpatialConversation}
        data-is-typing={props.isTyping}
        data-is-global-chat-active={props.isGlobalChatActive}
        data-animated={props.animated}
        data-max-quality={props.maxQuality}
        data-layer-height={props.layerHeight}
        data-width-scale={props.widthScale}
      >
        {props.onError && (
          <button data-testid="character-canvas-error-trigger" onClick={props.onError} />
        )}
      </div>
    ),
  };
});

// detectDeviceTier() does real WebGL probing — jsdom has no WebGL context at
// all, so the real implementation always resolves to T0 and every T1/T2
// gating path below would be untestable. Mocked (wrapping the real impl by
// default) so individual tests can force a specific tier via
// vi.mocked(detectDeviceTier).mockReturnValue(...).
vi.mock("../../services/render/deviceTier", async () => {
  const actual = await vi.importActual<typeof import("../../services/render/deviceTier")>(
    "../../services/render/deviceTier",
  );
  return {
    ...actual,
    detectDeviceTier: vi.fn(actual.detectDeviceTier),
    collectDeviceSignals: vi.fn(actual.collectDeviceSignals),
  };
});

// getSharedDeviceTierMicrobench() (deviceTierBenchmark.ts) is the module-
// level, session-shared microbench-rescue trigger OfficeStage's
// useDeviceTier() hook calls — mocked so individual tests can control
// exactly when/how it resolves instead of depending on a real (mocked-out
// in jsdom anyway) three.js render.
vi.mock("../../services/render/deviceTierBenchmark", async () => {
  const actual = await vi.importActual<typeof import("../../services/render/deviceTierBenchmark")>(
    "../../services/render/deviceTierBenchmark",
  );
  return { ...actual, getSharedDeviceTierMicrobench: vi.fn() };
});

// getDeviceTierOnce() (OfficeStage.tsx) caches detectDeviceTier()'s result
// at module scope for the whole session — reset before every test so each
// test's own mockReturnValue (or the default real-jsdom-T0 behavior) is
// actually re-read, instead of leaking whichever tier the first test in
// the file happened to compute.
let actualCollectDeviceSignals: typeof collectDeviceSignals;
beforeAll(async () => {
  actualCollectDeviceSignals = (
    await vi.importActual<typeof import("../../services/render/deviceTier")>(
      "../../services/render/deviceTier",
    )
  ).collectDeviceSignals;
});

beforeEach(() => {
  __resetDeviceTierCacheForTests();
  // Restore both mocks to their "delegate to the real implementation"
  // default — any test-specific mockReturnValue/mockResolvedValue set below
  // must not leak into the next test.
  vi.mocked(collectDeviceSignals).mockImplementation(actualCollectDeviceSignals);
  vi.mocked(getSharedDeviceTierMicrobench).mockReset();
});

// Real dev-team furniture id (see office-assets-manifest.json) whose seat
// (roomSeats.ts/seatDirections.ts) can be assigned "back" direction —
// path assets/office/furniture/dev-team/dev-visitor-chair.png, fraction 0
// in chairBackrestCrop.ts (backrest-occlusion crop intentionally disabled
// as of the 2026-08-19 commit).
const DEV_BACK_CHAIR_ID = "dev-lead1-visitor1";

function renderStage(backSitOccupantBaselines?: Record<string, number>) {
  return render(
    <TransformWrapper>
      <TransformComponent>
        <OfficeStage backSitOccupantBaselines={backSitOccupantBaselines} />
      </TransformComponent>
    </TransformWrapper>,
  );
}

// Every clip-path-bearing `.layer` wrapper div currently on screen — only
// synthetic backrest-crop layers ever set this style.
function clipPathLayers(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(`.${styles.layer}`)).filter(
    (el) => el.style.clipPath !== "",
  );
}

// Since alex joined LIVE_3D_CHARACTERS (2026-08-29), a T2 render of the
// manifest roster produces an alex canvas alongside bon's (self, or a peer
// within the T2 crowd cap). Tests that assert on Bon specifically select his
// stub by its Bon GLB url (bon-v3 registry set, or the bon-v2 dev-override
// candidate) instead of assuming he owns the only canvas.
function canvasStubs(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>('[data-testid="character-canvas-stub"]'));
}
function bonCanvasStubs(container: HTMLElement): HTMLElement[] {
  return canvasStubs(container).filter((el) => /bon-v2|bon-v3/.test(el.getAttribute("data-glb-url") ?? ""));
}
function alexCanvasStubs(container: HTMLElement): HTMLElement[] {
  // Trailing build-variant suffixes included (e.g. the masculine idle rebuild
  // `alex-v2-hq-idle9/`).
  return canvasStubs(container).filter((el) => /\/avatars\/alex(?:-v\d+)?(?:-[a-z0-9]+)*\//.test(el.getAttribute("data-glb-url") ?? ""));
}
function bonCanvasStub(container: HTMLElement): HTMLElement {
  const stubs = bonCanvasStubs(container);
  if (stubs.length !== 1) throw new Error(`expected exactly one Bon canvas stub, found ${stubs.length}`);
  return stubs[0];
}

describe("OfficeStage src-override empty-string fallback", () => {
  it("treats an empty-string characterSrcOverrides entry as absent, never rendering a blank img", () => {
    const { container } = render(
      <TransformWrapper>
        <TransformComponent>
          <OfficeStage characterSrcOverrides={{ bon: "" }} />
        </TransformComponent>
      </TransformWrapper>,
    );
    const imgs = Array.from(container.querySelectorAll("img"));
    expect(imgs.length).toBeGreaterThan(0);
    for (const img of imgs) {
      expect(img.getAttribute("src")).not.toBe("");
      expect(img.getAttribute("src")).toBeTruthy();
    }
  });
});

describe("OfficeStage synthetic backrest-crop layer generation", () => {
  it("generates exactly one synthetic crop layer, clipped to the looked-up fraction, for an occupied back-sit seat", () => {
    const { container } = renderStage({ [backrestCropLayerId(DEV_BACK_CHAIR_ID)]: 999 });

    const clipped = clipPathLayers(container);
    expect(clipped.length).toBe(1);
    // fraction 0 for dev-visitor-chair.png (backrest-occlusion crop
    // intentionally disabled as of the 2026-08-19 commit) -> clip away
    // the full 100%, leaving nothing of the synthetic clone visible.
    expect(clipped[0].style.clipPath).toBe("inset(0 0 100% 0)");
  });

  it("generates no synthetic layer when the map is empty/omitted", () => {
    const { container: withoutProp } = renderStage(undefined);
    expect(clipPathLayers(withoutProp).length).toBe(0);

    const { container: withEmptyMap } = renderStage({});
    expect(clipPathLayers(withEmptyMap).length).toBe(0);
  });

  it("generates no synthetic layer for a furniture id NOT present in the occupant-baseline map (e.g. a front-facing seat)", () => {
    // Map only has an entry for a different chair's crop-layer id.
    const { container } = renderStage({ [backrestCropLayerId(DEV_BACK_CHAIR_ID)]: 999 });

    // dev-chair.png (front-only seats: dev-lead1/2-chair + 8 dev-bay
    // chairs, all "front" per seatDirections.ts) renders once per manifest
    // instance, no clone — 10 total, unaffected by the crop mechanism.
    const frontChairImgs = container.querySelectorAll(
      'img[src*="dev-team/dev-chair.png"]',
    );
    expect(frontChairImgs.length).toBe(10);

    // dev-visitor-chair.png (12 manifest instances total in dev-team) plus
    // exactly ONE synthetic clone for dev-lead1-visitor1 (the only one
    // present in the occupant-baseline map here) -> 13.
    const backChairImgs = container.querySelectorAll(
      'img[src*="dev-team/dev-visitor-chair.png"]',
    );
    expect(backChairImgs.length).toBe(13);
  });

  it("leaves the base chair layer's own img untouched (no clip-path) even when its crop clone exists", () => {
    const { container } = renderStage({ [backrestCropLayerId(DEV_BACK_CHAIR_ID)]: 999 });

    const allLayers = Array.from(container.querySelectorAll<HTMLElement>(`.${styles.layer}`));
    const unclipped = allLayers.filter((el) => el.style.clipPath === "");
    // The base chair (and every other non-crop layer) has no clip-path.
    expect(unclipped.length).toBeGreaterThan(0);
    expect(clipPathLayers(container).length).toBe(1);
  });
});

describe("OfficeStage Phase C live-3D dev-toggle: heading/walk wiring", () => {
  afterEach(() => {
    window.history.pushState({}, "", "/");
  });

  function renderStageWithLive3d(
    live3dParam: string,
    characterDirectionsById?: Record<string, "front" | "back" | "left" | "right">,
    characterIsWalkingById?: Record<string, boolean>,
  ) {
    window.history.pushState({}, "", `/?live3d=${live3dParam}`);
    return render(
      <TransformWrapper>
        <TransformComponent>
          <OfficeStage
            characterDirectionsById={characterDirectionsById}
            characterIsWalkingById={characterIsWalkingById}
          />
        </TransformComponent>
      </TransformWrapper>,
    );
  }

  it("passes the bon layer's real direction through as headingDegrees, not the hardcoded front-facing default", () => {
    const { getByTestId } = renderStageWithLive3d("bon", { bon: "left" }, { bon: true });

    const stub = getByTestId("character-canvas-stub");
    expect(stub.dataset.headingDegrees).toBe("-90");
    expect(stub.dataset.isWalking).toBe("true");
  });

  it("maps every WalkDirection to its expected heading via the same directionToHeadingDegrees the sprite path's convention documents", () => {
    const cases: Array<["front" | "back" | "left" | "right", string]> = [
      ["front", "0"],
      ["back", "180"],
      ["left", "-90"],
      ["right", "90"],
    ];
    for (const [direction, expectedDegrees] of cases) {
      const { getByTestId, unmount } = renderStageWithLive3d("bon", { bon: direction });
      expect(getByTestId("character-canvas-stub").dataset.headingDegrees).toBe(expectedDegrees);
      unmount();
    }
  });

  it("defaults to front (0deg) and walking=false when no direction/walk-state entry is given for the toggled character (a live-3D peer with no synced movement entry must never default to walking-in-place forever)", () => {
    const { getByTestId } = renderStageWithLive3d("bon");

    const stub = getByTestId("character-canvas-stub");
    expect(stub.dataset.headingDegrees).toBe("0");
    expect(stub.dataset.isWalking).toBe("false");
  });

  it("freezes the mixer (isWalking=false) when the character is stationary", () => {
    const { getByTestId } = renderStageWithLive3d("bon", { bon: "front" }, { bon: false });

    expect(getByTestId("character-canvas-stub").dataset.isWalking).toBe("false");
  });

  it("dev override still forces CharacterCanvas even at T0 (bypasses tier gating entirely)", () => {
    vi.mocked(detectDeviceTier).mockReturnValue("T0");

    const { queryByTestId } = renderStageWithLive3d("bon");

    expect(queryByTestId("character-canvas-stub")).not.toBeNull();
  });
});

describe("OfficeStage: peer state attaches to the surviving roster Bon layer", () => {
  afterEach(() => {
    window.history.pushState({}, "", "/");
  });

  const ROSTER_BON = "jerevon@offshorly.com";
  const rosterBonLayer = {
    id: ROSTER_BON,
    kind: "character" as const,
    path: "",
    x: 300,
    y: 300,
    width: 26,
    height: 37,
    transform: null,
  } as unknown as import("../../types/office").AssetLayer;

  it("5. with the manifest bon hidden, the email-keyed walking/sitting/typing/Global-Chat state drives the one roster Bon canvas", () => {
    vi.mocked(detectDeviceTier).mockReturnValue("T2");
    window.history.pushState({}, "", "/?live3d=bon-v2");
    const { container } = render(
      <TransformWrapper>
        <TransformComponent>
          <OfficeStage
            selfCharacterId="alex"
            hiddenCharacterIds={["bon"]}
            extraCharacterLayers={[rosterBonLayer]}
            characterIsWalkingById={{ [ROSTER_BON]: true }}
            characterIsSittingById={{ [ROSTER_BON]: false }}
            characterDirectionsById={{ [ROSTER_BON]: "left" }}
            talkingCharacterIds={[ROSTER_BON]}
            spatialTypingCharacterIds={[ROSTER_BON]}
            globalChatActiveCharacterIds={[ROSTER_BON]}
          />
        </TransformComponent>
      </TransformWrapper>,
    );
    // alex (self, T2) has his own canvas now — assert on Bon's alone.
    expect(bonCanvasStubs(container).length).toBe(1);
    const stub = bonCanvasStub(container);
    expect(stub.getAttribute("data-glb-url")).toMatch(/bon-v2-lod0\.glb$/);
    expect(stub.getAttribute("data-is-walking")).toBe("true");
    expect(stub.getAttribute("data-heading-degrees")).toBe("-90");
    expect(stub.getAttribute("data-is-spatial-conversation")).toBe("true");
    expect(stub.getAttribute("data-is-typing")).toBe("true");
    expect(stub.getAttribute("data-is-global-chat-active")).toBe("true");
  });

  it("without hiding, the manifest bon layer would render a second Bon canvas (documents the fixed condition)", () => {
    vi.mocked(detectDeviceTier).mockReturnValue("T2");
    window.history.pushState({}, "", "/?live3d=bon-v2");
    const { container } = render(
      <TransformWrapper>
        <TransformComponent>
          <OfficeStage selfCharacterId="alex" extraCharacterLayers={[rosterBonLayer]} />
        </TransformComponent>
      </TransformWrapper>,
    );
    // Two Bon canvases (manifest + roster); alex's own self canvas is excluded.
    expect(bonCanvasStubs(container).length).toBe(2);
  });
});

describe("OfficeStage dev-only candidate override (?live3d=bon-v2)", () => {
  afterEach(() => {
    window.history.pushState({}, "", "/");
  });

  function renderWith(query: string, selfCharacterId?: string) {
    window.history.pushState({}, "", `/${query}`);
    return render(
      <TransformWrapper>
        <TransformComponent>
          <OfficeStage selfCharacterId={selfCharacterId} />
        </TransformComponent>
      </TransformWrapper>,
    );
  }

  it("swaps Bon's own layer to the bon-v2 candidate LOD0 at T2 — exactly one canvas, no duplicate Bon", () => {
    vi.mocked(detectDeviceTier).mockReturnValue("T2");
    const { container } = renderWith("?live3d=bon-v2");
    const stubs = bonCanvasStubs(container);
    expect(stubs.length).toBe(1);
    expect(stubs[0].getAttribute("data-glb-url")).toMatch(/avatars\/bon-v2\/bon-v2-lod0\.glb$/);
    // The bon layer no longer renders its sprite <img> alongside the canvas.
    const bonImgs = Array.from(container.querySelectorAll("img")).filter((img) =>
      (img.getAttribute("src") ?? "").includes("/bon"),
    );
    expect(bonImgs.length).toBe(0);
  });

  it("bon-v2 T2 selects lod0", () => {
    vi.mocked(detectDeviceTier).mockReturnValue("T2");
    const { container } = renderWith("?live3d=bon-v2");
    expect(bonCanvasStub(container).getAttribute("data-glb-url")).toMatch(/\/avatars\/bon-v2\/bon-v2-lod0\.glb$/);
  });

  it("bon-v2 T1 selects lod1", () => {
    vi.mocked(detectDeviceTier).mockReturnValue("T1");
    const { container } = renderWith("?live3d=bon-v2");
    expect(bonCanvasStub(container).getAttribute("data-glb-url")).toMatch(/\/avatars\/bon-v2\/bon-v2-lod1\.glb$/);
  });

  it("bon-v2 T0 selects lod2", () => {
    vi.mocked(detectDeviceTier).mockReturnValue("T0");
    const { getAllByTestId } = renderWith("?live3d=bon-v2");
    const stubs = getAllByTestId("character-canvas-stub");
    expect(stubs.length).toBe(1);
    expect(stubs[0].getAttribute("data-glb-url")).toMatch(/\/avatars\/bon-v2\/bon-v2-lod2\.glb$/);
  });

  // detectDeviceTier() is a once-per-session cached singleton, so each tier needs its own test.
  const rosterBonLayerForPeerTests = {
    id: "jerevon@offshorly.com", kind: "character" as const, path: "", x: 300, y: 300, width: 26, height: 37, transform: null,
  } as unknown as import("../../types/office").AssetLayer;
  function renderPeerRosterBon(tier: "T0" | "T1" | "T2") {
    vi.mocked(detectDeviceTier).mockReturnValue(tier);
    window.history.pushState({}, "", "/?live3d=bon-v2");
    return render(
      <TransformWrapper>
        <TransformComponent>
          <OfficeStage selfCharacterId="alex" hiddenCharacterIds={["bon"]} extraCharacterLayers={[rosterBonLayerForPeerTests]} />
        </TransformComponent>
      </TransformWrapper>,
    );
  }
  for (const [tier, lod] of [["T2", "lod0"], ["T1", "lod1"], ["T0", "lod2"]] as const) {
    it(`Peer roster Bon follows the same tier selection: ${tier} -> ${lod} (alex viewer, roster jerevon layer, manifest bon hidden)`, () => {
      const { container } = renderPeerRosterBon(tier);
      const stubs = bonCanvasStubs(container);
      expect(stubs.length).toBe(1);
      expect(stubs[0].getAttribute("data-glb-url")).toMatch(new RegExp(`/avatars/bon-v2/bon-v2-${lod}\\.glb$`));
    });
  }

  it("Production ignores the selector (DEV=false): ?live3d=bon-v2 falls back to normal gating with the shipped bon-v3 set", () => {
    vi.stubEnv("DEV", false);
    try {
      vi.mocked(detectDeviceTier).mockReturnValue("T2");
      const { container } = renderWith("?live3d=bon-v2", "bon");
      const url = bonCanvasStub(container).getAttribute("data-glb-url") ?? "";
      // Registry (promoted to bon-v3) still wins; the selector itself contributed nothing.
      expect(url).toMatch(/avatars\/bon-v3-hq-idle9\/bon-v3-lod0\.glb$/);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("picks the candidate's LOD1 at T1 and LOD2 in the static-frame bucket via the same tier policy as production", () => {
    vi.mocked(detectDeviceTier).mockReturnValue("T1");
    const { container, unmount } = renderWith("?live3d=bon-v2");
    expect(bonCanvasStub(container).getAttribute("data-glb-url")).toMatch(/bon-v2-lod1\.glb$/);
    unmount();
  });

  it("Default Bon T2 loads bon-v3 lod0 without a selector", () => {
    vi.mocked(detectDeviceTier).mockReturnValue("T2");
    const { container } = renderWith("", "bon");
    const stubs = bonCanvasStubs(container);
    expect(stubs.length).toBe(1);
    expect(stubs[0].getAttribute("data-glb-url")).toMatch(/\/avatars\/bon-v3-hq-idle9\/bon-v3-lod0\.glb$/);
    expect(LIVE_3D_CHARACTERS.bon.glbUrl).toMatch(/\/avatars\/bon-v3-hq-idle9\/bon-v3-lod0\.glb$/);
  });

  it("Default Bon T1 loads lod1", () => {
    vi.mocked(detectDeviceTier).mockReturnValue("T1");
    const { container } = renderWith("", "bon");
    expect(bonCanvasStub(container).getAttribute("data-glb-url")).toMatch(/\/avatars\/bon-v3-hq-idle9\/bon-v3-lod1\.glb$/);
  });

  it("Default Bon at a genuine T0 keeps the production 2D sprite safety floor (no canvas, no selector)", () => {
    vi.mocked(detectDeviceTier).mockReturnValue("T0");
    const { queryAllByTestId, container } = renderWith("", "bon");
    expect(queryAllByTestId("character-canvas-stub").length).toBe(0);
    const bonSprites = Array.from(container.querySelectorAll("img")).filter((i) => /chibi-bon|\/bon-/.test(i.getAttribute("src") ?? ""));
    expect(bonSprites.length).toBe(1);
  });

  it("Peer view renders exactly one default bon-v3", () => {
    vi.mocked(detectDeviceTier).mockReturnValue("T2");
    const rosterBon = {
      id: "jerevon@offshorly.com", kind: "character" as const, path: "", x: 300, y: 300, width: 26, height: 37, transform: null,
    } as unknown as import("../../types/office").AssetLayer;
    const { container } = render(
      <TransformWrapper>
        <TransformComponent>
          <OfficeStage selfCharacterId="alex" hiddenCharacterIds={["bon"]} extraCharacterLayers={[rosterBon]} />
        </TransformComponent>
      </TransformWrapper>,
    );
    const stubs = bonCanvasStubs(container);
    expect(stubs.length).toBe(1);
    // Adaptive LOD (adaptiveLod.ts): bon is a PEER here (self is alex) and is
    // further away than the near radius, so he correctly gets the mid tier —
    // the ~5MB HQ mesh is reserved for self/focused/near characters.
    expect(stubs[0].getAttribute("data-glb-url")).toMatch(/\/avatars\/bon-v3-hq-idle9\/bon-v3-lod1\.glb$/);
    expect(Array.from(container.querySelectorAll("img")).filter((i) => /chibi-bon|\/bon-/.test(i.getAttribute("src") ?? "")).length).toBe(0);
  });

  it("Animation and movement inputs reach the default Bon canvas", () => {
    vi.mocked(detectDeviceTier).mockReturnValue("T2");
    // no selector; drive every state input for the self layer "bon"
    const { container } = render(
      <TransformWrapper>
        <TransformComponent>
          <OfficeStage
            selfCharacterId="bon"
            characterIsWalkingById={{ bon: true }}
            characterDirectionsById={{ bon: "right" }}
            characterIsSittingById={{ bon: false }}
            talkingCharacterIds={["bon"]}
            spatialTypingCharacterIds={["bon"]}
            globalChatActiveCharacterIds={["bon"]}
          />
        </TransformComponent>
      </TransformWrapper>,
    );
    const stub = bonCanvasStub(container);
    expect(stub.getAttribute("data-glb-url")).toMatch(/bon-v3-lod0\.glb$/);
    expect(stub.getAttribute("data-is-walking")).toBe("true");
    expect(stub.getAttribute("data-heading-degrees")).toBe("90");
    expect(stub.getAttribute("data-is-spatial-conversation")).toBe("true");
    expect(stub.getAttribute("data-is-typing")).toBe("true");
    expect(stub.getAttribute("data-is-global-chat-active")).toBe("true");
  });

  describe("overflow chain (the real clipping boundary)", () => {
    it("a live-3D character layer allows visual overflow so the widened canvas is not clipped", () => {
      vi.mocked(detectDeviceTier).mockReturnValue("T2");
      const { container } = render(
        <TransformWrapper>
          <TransformComponent>
            <OfficeStage selfCharacterId="bon" />
          </TransformComponent>
        </TransformWrapper>,
      );
      const stub = canvasStubs(container).find((el) =>
        /bon-v3-hq/.test(el.getAttribute("data-glb-url") ?? ""),
      )!;
      const wrapper = stub.parentElement as HTMLElement;
      // .layer's `overflow: hidden` used to crop the widened canvas back to the
      // wrapper's own width — this inline override is the fix.
      expect(wrapper.style.overflow).toBe("visible");
      // ...and the wrapper's own geometry (== the hit box) is untouched
      expect(wrapper.style.width).toMatch(/%$/);
      expect(wrapper.style.height).toMatch(/%$/);
      expect(wrapper.style.left).toMatch(/%$/);
      expect(wrapper.style.top).toMatch(/%$/);
    });

    it("sprite-only layers keep clipping (imgCrop / backrest clipPath depend on it)", () => {
      vi.mocked(detectDeviceTier).mockReturnValue("T0");   // no live-3D at all
      const { container } = render(
        <TransformWrapper>
          <TransformComponent>
            <OfficeStage selfCharacterId="bon" />
          </TransformComponent>
        </TransformWrapper>,
      );
      const sprite = Array.from(container.querySelectorAll("img")).find((i) =>
        /chibi-bon|\/bon-/.test(i.getAttribute("src") ?? ""),
      )!;
      const wrapper = sprite.parentElement as HTMLElement;
      expect(wrapper.style.overflow).toBe("");   // falls through to .layer's hidden
    });
  });

  describe("horizontal capacity (wide-pose cropping)", () => {
    const renderStage = () => render(
      <TransformWrapper>
        <TransformComponent>
          <OfficeStage selfCharacterId="bon" />
        </TransformComponent>
      </TransformWrapper>,
    );
    const stubFor = (c: HTMLElement, re: RegExp) =>
      canvasStubs(c).find((el) => re.test(el.getAttribute("data-glb-url") ?? ""));

    it("each character receives its own measured capacity, not a shared constant", () => {
      vi.mocked(detectDeviceTier).mockReturnValue("T2");
      const { container } = renderStage();
      expect(stubFor(container, /bon-v3-hq/)!.getAttribute("data-width-scale")).toBe("1.35");
      expect(stubFor(container, /alex-v2-hq/)!.getAttribute("data-width-scale")).toBe("1.65");
    });

    it("the wrapper layer keeps its own width/height — only the canvas paints wider", () => {
      vi.mocked(detectDeviceTier).mockReturnValue("T2");
      const { container } = renderStage();
      const stub = stubFor(container, /bon-v3-hq/)!;
      // layerHeight is what the canonical size policy calibrates against; it
      // must be untouched by the widening
      expect(stub.getAttribute("data-layer-height")).toBe("37.2");
      const wrapper = stub.parentElement as HTMLElement;
      // the wrapper's own inline geometry is still percentage-of-frame based
      expect(wrapper.style.width).toMatch(/%$/);
      expect(wrapper.style.height).toMatch(/%$/);
      expect(wrapper.style.left).toMatch(/%$/);
      expect(wrapper.style.top).toMatch(/%$/);
    });

    it("widening does not disturb the layer's position anchor", () => {
      vi.mocked(detectDeviceTier).mockReturnValue("T2");
      const { container } = renderStage();
      const bon = stubFor(container, /bon-v3-hq/)!.parentElement as HTMLElement;
      const alex = stubFor(container, /alex-v2-hq/)!.parentElement as HTMLElement;
      // both still anchored by their own manifest left/top, unchanged by capacity
      expect(bon.style.left).not.toBe("");
      expect(alex.style.left).not.toBe("");
      expect(bon.style.left).not.toBe(alex.style.left);
    });
  });

  describe("spatial-conversation quality override", () => {
    const renderChat = (talking: string[], self = "bon") => render(
      <TransformWrapper>
        <TransformComponent>
          <OfficeStage selfCharacterId={self} talkingCharacterIds={talking} />
        </TransformComponent>
      </TransformWrapper>,
    );
    const stubFor = (c: HTMLElement, re: RegExp) =>
      canvasStubs(c).find((el) => re.test(el.getAttribute("data-glb-url") ?? ""));

    it("both participants of a two-person chat get HQ LOD0 and the max-quality override", () => {
      vi.mocked(detectDeviceTier).mockReturnValue("T2");
      const { container } = renderChat(["bon", "alex"]);
      for (const re of [/bon-v3-hq/, /alex-v2-hq/]) {
        const stub = stubFor(container, re)!;
        expect(stub).toBeTruthy();
        expect(stub.getAttribute("data-glb-url")).toMatch(/-lod0\.glb$/);
        expect(stub.getAttribute("data-max-quality")).toBe("true");
      }
    });

    it("an unrelated character in the same office gets neither", () => {
      vi.mocked(detectDeviceTier).mockReturnValue("T2");
      const { container } = renderChat(["bon"], "bon");
      const alex = stubFor(container, /alex-v2-hq/)!;
      expect(alex).toBeTruthy();
      expect(alex.getAttribute("data-max-quality")).toBe("false");
      expect(alex.getAttribute("data-glb-url")).not.toMatch(/-lod0\.glb$/);
    });

    it("leaving the conversation releases the render-quality override immediately", () => {
      vi.mocked(detectDeviceTier).mockReturnValue("T2");
      const { container, rerender } = renderChat(["bon", "alex"]);
      expect(stubFor(container, /alex-v2-hq/)!.getAttribute("data-max-quality")).toBe("true");
      rerender(
        <TransformWrapper>
          <TransformComponent>
            <OfficeStage selfCharacterId="bon" talkingCharacterIds={[]} />
          </TransformComponent>
        </TransformWrapper>,
      );
      // the resolution pin is not debounced — it drops the moment the session ends
      expect(stubFor(container, /alex-v2-hq/)!.getAttribute("data-max-quality")).toBe("false");
    });

    it("the LOD tier demotes after the debounce hold, not instantly (anti-thrash)", () => {
      vi.mocked(detectDeviceTier).mockReturnValue("T2");
      const nowSpy = vi.spyOn(performance, "now").mockReturnValue(1000);
      const { container, rerender } = renderChat(["bon", "alex"]);
      expect(stubFor(container, /alex-v2-hq/)!.getAttribute("data-glb-url")).toMatch(/-lod0\.glb$/);

      const leave = () => rerender(
        <TransformWrapper>
          <TransformComponent>
            <OfficeStage selfCharacterId="bon" talkingCharacterIds={[]} />
          </TransformComponent>
        </TransformWrapper>,
      );
      // still inside the 400ms hold -> keeps the tier it had
      nowSpy.mockReturnValue(1000 + MIN_TIER_HOLD_MS - 1);
      leave();
      expect(stubFor(container, /alex-v2-hq/)!.getAttribute("data-glb-url")).toMatch(/-lod0\.glb$/);

      // past the hold -> returns to the adaptive tier
      nowSpy.mockReturnValue(1000 + MIN_TIER_HOLD_MS + 1);
      leave();
      expect(stubFor(container, /alex-v2-hq/)!.getAttribute("data-glb-url")).not.toMatch(/-lod0\.glb$/);
      nowSpy.mockRestore();
    });

    it("global chat and remote chat never trigger it", () => {
      vi.mocked(detectDeviceTier).mockReturnValue("T2");
      const { container } = render(
        <TransformWrapper>
          <TransformComponent>
            <OfficeStage selfCharacterId="bon" globalChatActiveCharacterIds={["bon", "alex"]} talkingCharacterIds={[]} />
          </TransformComponent>
        </TransformWrapper>,
      );
      const alex = stubFor(container, /alex-v2-hq/)!;
      expect(alex.getAttribute("data-max-quality")).toBe("false");
    });

    it("renders exactly one canvas per participant — no duplicates", () => {
      vi.mocked(detectDeviceTier).mockReturnValue("T2");
      const { container } = renderChat(["bon", "alex"]);
      expect(canvasStubs(container).filter((el) => /bon-v3-hq/.test(el.getAttribute("data-glb-url") ?? "")).length).toBe(1);
      expect(canvasStubs(container).filter((el) => /alex-v2-hq/.test(el.getAttribute("data-glb-url") ?? "")).length).toBe(1);
    });

    it("the override does not change the character's visible CSS footprint", () => {
      vi.mocked(detectDeviceTier).mockReturnValue("T2");
      const { container: chat } = renderChat(["bon", "alex"]);
      const inChat = stubFor(chat, /alex-v2-hq/)!.getAttribute("data-layer-height");
      const { container: idle } = renderChat([], "bon");
      const outOfChat = stubFor(idle, /alex-v2-hq/)!.getAttribute("data-layer-height");
      expect(inChat).toBe(outOfChat);
    });
  });

  it("Unregistered employees remain unchanged (lui stays a sprite; registry has exactly bon, alex, micah and angelo)", () => {
    vi.mocked(detectDeviceTier).mockReturnValue("T2");
    const { container } = renderWith("", "bon");
    expect(Object.keys(LIVE_3D_CHARACTERS).sort()).toEqual(["alex", "angelo", "bon", "micah"]);
    expect(bonCanvasStubs(container).length).toBe(1);
    // alex is a registered peer within the T2 crowd cap -> one alex canvas.
    expect(alexCanvasStubs(container).length).toBe(1);
    // lui has no registry entry -> still the 2D sprite, no canvas.
    expect(canvasStubs(container).filter((el) => /lui/.test(el.getAttribute("data-glb-url") ?? "")).length).toBe(0);
    const luiImgs = Array.from(container.querySelectorAll("img")).filter((i) => /lui/.test(i.getAttribute("src") ?? ""));
    expect(luiImgs.length).toBeGreaterThan(0);
  });

  it("`?live3d=bon` (registry id) previews the registry set, which is now bon-v3", () => {
    vi.mocked(detectDeviceTier).mockReturnValue("T2");
    const { container } = renderWith("?live3d=bon");
    expect(bonCanvasStub(container).getAttribute("data-glb-url")).toMatch(/bon-v3-lod0\.glb$/);
  });

  it("an unknown candidate id is ignored (falls back to normal gating)", () => {
    vi.mocked(detectDeviceTier).mockReturnValue("T2");
    const { container } = renderWith("?live3d=bon-v9", "bon");
    expect(bonCanvasStub(container).getAttribute("data-glb-url")).toMatch(/bon-v3-lod0\.glb$/);
  });
});

describe("OfficeStage live-3D tier/budget gating (no ?live3d= override)", () => {
  function renderGated(selfCharacterId?: string) {
    return render(
      <TransformWrapper>
        <TransformComponent>
          <OfficeStage selfCharacterId={selfCharacterId} />
        </TransformComponent>
      </TransformWrapper>,
    );
  }

  it("shows the self avatar (bon) as CharacterCanvas at T1, with no URL param", () => {
    vi.mocked(detectDeviceTier).mockReturnValue("T1");

    const { container } = renderGated("bon");

    expect(bonCanvasStubs(container).length).toBe(1);
  });

  it("shows the self avatar (bon) as CharacterCanvas at T2, with no URL param", () => {
    vi.mocked(detectDeviceTier).mockReturnValue("T2");

    const { container } = renderGated("bon");

    expect(bonCanvasStubs(container).length).toBe(1);
  });

  it("falls back to sprite for the self avatar at T0, the hard safety floor", () => {
    vi.mocked(detectDeviceTier).mockReturnValue("T0");

    const { queryByTestId, container } = renderGated("bon");

    expect(queryByTestId("character-canvas-stub")).toBeNull();
    expect(container.querySelector('img[src*="bon"]')).not.toBeNull();
  });

  it("shows a non-self bon as CharacterCanvas (LOD1) at T1, within the T1 peer crowd cap of 2", () => {
    vi.mocked(detectDeviceTier).mockReturnValue("T1");

    // No selfCharacterId passed -> every registered character is a peer/crowd
    // member. With four registered the single-entry relaxation no longer
    // applies, so they all go through LIVE_3D_CAP_BY_TIER.T1 (2) and exactly
    // two win a slot. WHICH two follows the depth-sort first-come rule and is
    // covered by the crowd-cap block below — what matters here is that peers
    // are animated at T1 and that the cap is honoured exactly.
    const { container } = renderGated(undefined);

    const stubs = canvasStubs(container);
    expect(stubs.length).toBe(LIVE_3D_CAP_BY_TIER.T1);
    for (const stub of stubs) expect(stub.getAttribute("data-glb-url")).toMatch(/-lod1\.glb$/);
  });

  it("angelo renders exactly once at T2 — as a peer, and as self — with his gelo-v1-hq set", () => {
    vi.mocked(detectDeviceTier).mockReturnValue("T2");
    const angeloStubs = (c: HTMLElement) =>
      canvasStubs(c).filter((el) => /\/avatars\/gelo-v1-hq(?:-[a-z0-9]+)*\//.test(el.getAttribute("data-glb-url") ?? ""));

    // as a PEER (viewer is micah)
    const peerView = renderGated("micah");
    expect(angeloStubs(peerView.container)).toHaveLength(1);
    // never doubled up as a sprite as well
    expect(peerView.container.querySelector('img[src*="angelo"]')).toBeNull();
    peerView.unmount();
    __resetDeviceTierCacheForTests();

    // as SELF
    const selfView = renderGated("angelo");
    expect(angeloStubs(selfView.container)).toHaveLength(1);
    expect(selfView.container.querySelector('img[src*="angelo"]')).toBeNull();
  });

  it("shows a non-self bon as CharacterCanvas at T2, within the crowd budget", () => {
    vi.mocked(detectDeviceTier).mockReturnValue("T2");

    const { container } = renderGated(undefined);

    expect(bonCanvasStubs(container).length).toBe(1);
  });

  it("at T1 a genuine peer viewer (self = alex) sees their own avatar AND bon live-3D at LOD1 (self allowance + T1 peer cap)", () => {
    vi.mocked(detectDeviceTier).mockReturnValue("T1");

    // selfCharacterId is "alex" -> alex gets the self allowance
    // (LIVE_3D_SELF_MIN_TIER, T1+), and the other three registered characters
    // compete for the T1 peer cap of 2.
    const { container } = renderGated("alex");

    const alexStubs = alexCanvasStubs(container);
    expect(alexStubs.length).toBe(1);
    expect(alexStubs[0].getAttribute("data-glb-url")).toMatch(/alex-v2-lod1\.glb$/);
    expect(canvasStubs(container).length).toBe(1 + LIVE_3D_CAP_BY_TIER.T1);
  });

  it("falls back to sprite for a character with no live-3D registry entry, regardless of tier", () => {
    vi.mocked(detectDeviceTier).mockReturnValue("T2");

    // "lui" has no LIVE_3D_CHARACTERS entry (bon, alex, micah and angelo ship).
    const { container } = renderGated(undefined);

    expect(canvasStubs(container).filter((el) => /lui/.test(el.getAttribute("data-glb-url") ?? "")).length).toBe(0);
    expect(container.querySelector('img[src*="lui"]')).not.toBeNull();
  });

  describe("crowd budget cap enforcement (registry temporarily widened for this test)", () => {
    const ORIGINAL_T2_CAP = LIVE_3D_CAP_BY_TIER.T2;

    beforeEach(() => {
      // The registry now holds 4 real, always-present manifest characters
      // (bon, alex, micah, angelo — all four exist in officeAssetLayers), so
      // "eligible > cap" is reachable by shrinking ONLY the T2 crowd cap to 2.
      // No fabricated registry entries are needed any more; the cap itself is
      // the single thing this fixture changes, and it is restored below.
      LIVE_3D_CAP_BY_TIER.T2 = 2;
    });

    afterEach(() => {
      LIVE_3D_CAP_BY_TIER.T2 = ORIGINAL_T2_CAP;
    });

    it("caps non-self live-3D characters at the tier's crowd budget, falling back to sprite for the excess", () => {
      vi.mocked(detectDeviceTier).mockReturnValue("T2");

      // No selfCharacterId -> bon/alex/micah/angelo are ALL crowd members.
      const { container } = renderGated(undefined);

      const stubs = container.querySelectorAll('[data-testid="character-canvas-stub"]');
      expect(stubs.length).toBe(2);
    });

    it("does not let self-avatar consumption count against (or get counted by) the crowd budget", () => {
      vi.mocked(detectDeviceTier).mockReturnValue("T2");

      // bon is self here — self is unconditionally allowed at T2 and must
      // not consume one of the 2 crowd slots also available to
      // alex/micah/angelo.
      const { container } = renderGated("bon");

      const stubs = container.querySelectorAll('[data-testid="character-canvas-stub"]');
      // bon (self) + 2 crowd slots (alex/micah/angelo, cap 2) = 3 total.
      expect(stubs.length).toBe(3);
    });
  });

  describe("tier visibility matrix: same employee, T0 vs T2, always exactly one visible avatar", () => {
    // Item 5 verification (see task notes): a device tier that grants no
    // live-3D budget must still render the 2D sprite (never drop the
    // layer), and src must never be empty regardless of tier.
    function renderBonAt(tier: "T0" | "T2") {
      vi.mocked(detectDeviceTier).mockReturnValue(tier);
      return render(
        <TransformWrapper>
          <TransformComponent>
            <OfficeStage
              selfCharacterId="bon"
              characterOverrides={{ bon: { x: 111, y: 222 } }}
              characterDirectionsById={{ bon: "left" }}
              characterIsWalkingById={{ bon: true }}
            />
          </TransformComponent>
        </TransformWrapper>,
      );
    }

    it("T0: exactly one visible bon avatar, rendered as the 2D sprite fallback with a non-empty src, at the overridden logical pos", () => {
      const { container, queryByTestId } = renderBonAt("T0");

      // Never live-3D at T0 (the hard safety floor).
      expect(queryByTestId("character-canvas-stub")).toBeNull();
      // Exactly one bon sprite <img> — never dropped, never duplicated.
      const bonImgs = Array.from(container.querySelectorAll<HTMLImageElement>('img[src*="bon"]'));
      expect(bonImgs).toHaveLength(1);
      expect(bonImgs[0].getAttribute("src")).toBeTruthy();
      // Same logical pos this test asked for, expressed as the layer's
      // %-based left/top style (OfficeStage converts world px -> %).
      const layerDiv = bonImgs[0].closest<HTMLElement>(`.${styles.layer}`)!;
      expect(layerDiv.style.left).not.toBe("");
      expect(layerDiv.style.top).not.toBe("");
    });

    it("T2: exactly one visible bon avatar, rendered live-3D, at the SAME logical pos the T0 case used", () => {
      const { container } = renderBonAt("T2");

      const stubs = bonCanvasStubs(container);
      // Exactly one live-3D node for bon — never dropped, never duplicated
      // into a second (e.g. stale sprite) node alongside it.
      expect(stubs).toHaveLength(1);
      expect(container.querySelectorAll('img[src*="bon"]')).toHaveLength(0);
      const layerDiv = stubs[0].closest<HTMLElement>(`.${styles.layer}`)!;
      expect(layerDiv.style.left).not.toBe("");
      expect(layerDiv.style.top).not.toBe("");
    });

    it("no live-3D registry entry + no crowd budget (a tier that grants nothing) still renders the 2D sprite, never an empty src, never a dropped layer", () => {
      // "lui" has no LIVE_3D_CHARACTERS entry at all, at any tier — the
      // worst case for "does a no-budget tier still render someone".
      vi.mocked(detectDeviceTier).mockReturnValue("T0");
      const { container } = render(
        <TransformWrapper>
          <TransformComponent>
            <OfficeStage selfCharacterId="bon" />
          </TransformComponent>
        </TransformWrapper>,
      );
      const luiImg = container.querySelector<HTMLImageElement>('img[src*="lui"]');
      expect(luiImg).not.toBeNull();
      expect(luiImg!.getAttribute("src")).toBeTruthy();
    });
  });

  describe("animation-state input wiring (layer-id-keyed)", () => {
    function renderStage(props: Record<string, unknown>) {
      vi.mocked(detectDeviceTier).mockReturnValue("T1");
      return render(
        <TransformWrapper>
          <TransformComponent>
            <OfficeStage selfCharacterId="bon" {...props} />
          </TransformComponent>
        </TransformWrapper>,
      );
    }

    it("isSpatialConversation mirrors talkingCharacterIds", () => {
      const { container } = renderStage({ talkingCharacterIds: ["bon"] });
      const el = bonCanvasStub(container);
      expect(el.getAttribute("data-is-spatial-conversation")).toBe("true");
      expect(el.getAttribute("data-is-typing")).toBe("false");
      expect(el.getAttribute("data-is-global-chat-active")).toBe("false");
    });

    it("isTyping mirrors spatialTypingCharacterIds (conversation-scoped keystroke signal)", () => {
      const { container } = renderStage({ talkingCharacterIds: ["bon"], spatialTypingCharacterIds: ["bon"] });
      expect(bonCanvasStub(container).getAttribute("data-is-typing")).toBe("true");
    });

    it("the any-conversation typingCharacterIds (bubble signal) alone never sets isTyping", () => {
      const { container } = renderStage({ talkingCharacterIds: ["bon"], typingCharacterIds: ["bon"] });
      expect(bonCanvasStub(container).getAttribute("data-is-typing")).toBe("false");
    });

    it("a recently-sent message (talkingTextById) alone never sets isTyping or isGlobalChatActive", () => {
      const { container } = renderStage({
        talkingCharacterIds: ["bon"],
        talkingTextById: { bon: "hey team", "jerevon@offshorly.com": "hey" },
      });
      const el = bonCanvasStub(container);
      expect(el.getAttribute("data-is-typing")).toBe("false");
      expect(el.getAttribute("data-is-global-chat-active")).toBe("false");
    });

    it("isGlobalChatActive mirrors globalChatActiveCharacterIds and is independent of the spatial signals", () => {
      const { container } = renderStage({ globalChatActiveCharacterIds: ["bon"] });
      const el = bonCanvasStub(container);
      expect(el.getAttribute("data-is-global-chat-active")).toBe("true");
      expect(el.getAttribute("data-is-spatial-conversation")).toBe("false");
      expect(el.getAttribute("data-is-typing")).toBe("false");
    });

    it("an email-keyed globalChatActiveCharacterIds entry does not light up the self avatar id (caller must remap)", () => {
      const { container } = renderStage({ globalChatActiveCharacterIds: ["jerevon@offshorly.com"] });
      expect(bonCanvasStub(container).getAttribute("data-is-global-chat-active")).toBe("false");
    });
  });

  describe("?deviceTier= dev-only override", () => {
    afterEach(() => {
      window.history.pushState({}, "", "/");
    });

    it("no override: real signal-based tiering still decides gating exactly as before (regression)", () => {
      vi.mocked(detectDeviceTier).mockReturnValue("T0");

      const { queryByTestId, container } = renderGated("bon");

      expect(queryByTestId("character-canvas-stub")).toBeNull();
      expect(container.querySelector('img[src*="bon"]')).not.toBeNull();
    });

    it("?deviceTier=T1 overrides an underlying T0 detection, matching a genuine T1 device's rendering path", () => {
      // Simulates Bon's low-hardwareConcurrency test rig: the real signal
      // path would resolve to T0 (mocked here), but the override forces the
      // session to behave as a genuine T1 device would — self live-3D shown.
      vi.mocked(detectDeviceTier).mockReturnValue("T0");
      window.history.pushState({}, "", "/?deviceTier=T1");

      const { container } = renderGated("bon");

      expect(bonCanvasStubs(container).length).toBe(1);
    });

    it("?deviceTier=T0 overrides an underlying T2 detection, forcing the sprite fallback like a genuine T0 device", () => {
      vi.mocked(detectDeviceTier).mockReturnValue("T2");
      window.history.pushState({}, "", "/?deviceTier=T0");

      const { queryByTestId, container } = renderGated("bon");

      expect(queryByTestId("character-canvas-stub")).toBeNull();
      expect(container.querySelector('img[src*="bon"]')).not.toBeNull();
    });

    it("ignores an invalid ?deviceTier= value and falls back to real signal-based tiering", () => {
      vi.mocked(detectDeviceTier).mockReturnValue("T2");
      window.history.pushState({}, "", "/?deviceTier=bogus");

      const { container } = renderGated("bon");

      expect(bonCanvasStubs(container).length).toBe(1);
    });
  });

  describe("runtime fallback on live-3D load failure", () => {
    it("falls back to the sprite for a character whose CharacterCanvas reports onError", () => {
      vi.mocked(detectDeviceTier).mockReturnValue("T1");

      const { container } = renderGated("bon");

      const bonStub = bonCanvasStub(container);
      fireEvent.click(bonStub.querySelector('[data-testid="character-canvas-error-trigger"]')!);

      expect(bonCanvasStubs(container).length).toBe(0);
      expect(container.querySelector('img[src*="bon"]')).not.toBeNull();
      // Only bon's canvas errored — alex's peer canvas (T1 crowd cap) stays.
      expect(alexCanvasStubs(container).length).toBe(1);
    });
  });

  describe("microbench-rescue for weak-static devices + confirmed-weak static-frame rendering", () => {
    const DESKTOP_SIGNALS: DeviceCapabilitySignals = {
      userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
      hardwareConcurrency: 2,
      deviceMemory: undefined,
      maxTouchPoints: 0,
      viewportWidth: 1440,
      hasWebGL2: true,
      hasWebGL1: false,
      unmaskedRenderer: "ANGLE (Apple, Apple M1 Pro, OpenGL 4.1)",
    };

    it("renders a static (non-animated) LOD2 3D frame for a weak-static T0 device before the rescue resolves, then upgrades to animated LOD1 once it resolves fast", async () => {
      vi.mocked(detectDeviceTier).mockReturnValue("T0");
      vi.mocked(collectDeviceSignals).mockReturnValue(DESKTOP_SIGNALS);
      vi.mocked(getSharedDeviceTierMicrobench).mockResolvedValue({
        medianFrameMs: 5,
        promoteToT2: false,
        sampleCount: 30,
      });

      const { container } = renderGated("bon");

      const before = bonCanvasStub(container);
      expect(before.dataset.animated).toBe("false");
      expect(before.dataset.glbUrl).toContain("lod2");

      // Flush the rescue microbench's promise chain (getSharedDeviceTierMicrobench
      // -> computeDeviceTier -> setTier), matching how the real async
      // useEffect->promise->setState sequence resolves.
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });

      const after = bonCanvasStub(container);
      expect(after.dataset.animated).toBe("true");
      expect(after.dataset.glbUrl).toContain("lod1");
    });

    it("stays a static LOD2 3D frame (never rescued to T1) when the microbench resolves too slow", async () => {
      vi.mocked(detectDeviceTier).mockReturnValue("T0");
      vi.mocked(collectDeviceSignals).mockReturnValue(DESKTOP_SIGNALS);
      vi.mocked(getSharedDeviceTierMicrobench).mockResolvedValue({
        medianFrameMs: 20,
        promoteToT2: false,
        sampleCount: 30,
      });

      const { container } = renderGated("bon");

      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });

      const stub = bonCanvasStub(container);
      expect(stub.dataset.animated).toBe("false");
      expect(stub.dataset.glbUrl).toContain("lod2");
    });

    it("renders a static (non-animated) LOD2 3D frame — not the sprite, not full animated 3D — for a software-renderer device, and never attempts the microbench rescue", async () => {
      vi.mocked(detectDeviceTier).mockReturnValue("T0");
      vi.mocked(collectDeviceSignals).mockReturnValue({
        ...DESKTOP_SIGNALS,
        hardwareConcurrency: 8,
        unmaskedRenderer: "Google SwiftShader",
      });

      const { container } = renderGated("bon");

      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });

      const stub = bonCanvasStub(container);
      expect(stub.dataset.animated).toBe("false");
      expect(stub.dataset.glbUrl).toContain("lod2");
      expect(container.querySelector('img[src*="bon"]')).toBeNull();
      expect(getSharedDeviceTierMicrobench).not.toHaveBeenCalled();
    });

    it("renders the plain sprite (not a static 3D frame) for a true no-WebGL/mobile T0 device", () => {
      vi.mocked(detectDeviceTier).mockReturnValue("T0");
      vi.mocked(collectDeviceSignals).mockReturnValue({
        ...DESKTOP_SIGNALS,
        hasWebGL2: false,
        hasWebGL1: false,
      });

      const { queryByTestId, container } = renderGated("bon");

      expect(queryByTestId("character-canvas-stub")).toBeNull();
      expect(container.querySelector('img[src*="bon"]')).not.toBeNull();
    });
  });
});

describe("overhead per-character resolver: StatusLabel / TalkingBubble mutual exclusivity", () => {
  // talkingCharacterIds ("conversation is open") deliberately never appears
  // in these opts — it no longer gates the overhead bubble render (see
  // typingCharacterIds/talkingTextById/greeting props below, which do).
  function renderWithPresence(opts: {
    selfCharacterId?: string;
    statusByLayerId?: Record<string, import("../../services/presence/status").OfficeStatus>;
    typingCharacterIds?: string[];
    talkingTextById?: Record<string, string>;
    greetingCharacterId?: string | null;
    greetingNonce?: number;
    greetingText?: string;
  }) {
    return render(
      <TransformWrapper>
        <TransformComponent>
          <OfficeStage
            showStatusLabels
            selfCharacterId={opts.selfCharacterId}
            statusByLayerId={opts.statusByLayerId}
            typingCharacterIds={opts.typingCharacterIds}
            talkingTextById={opts.talkingTextById}
            greetingCharacterId={opts.greetingCharacterId}
            greetingNonce={opts.greetingNonce}
            greetingText={opts.greetingText}
          />
        </TransformComponent>
      </TransformWrapper>,
    );
  }

  it("(a) only status set -> StatusLabel renders", () => {
    const { container, getByText } = renderWithPresence({
      selfCharacterId: "bon",
      statusByLayerId: { alex: "AVAILABLE" },
    });
    expect(getByText(/^Alex$/)).toBeTruthy();
    expect(container.querySelectorAll(`.${talkingBubbleStyles.bubble}`).length).toBe(0);
    expect(container.querySelectorAll(`.${talkingBubbleStyles.bubbleText}`).length).toBe(0);
  });

  it("(b) typingCharacterIds includes the id -> dots render, no label", () => {
    const { container, queryByText, getByText } = renderWithPresence({
      selfCharacterId: "bon",
      statusByLayerId: { alex: "IN_CONVERSATION", micah: "AVAILABLE" },
      typingCharacterIds: ["alex"],
    });
    // alex is typing: no StatusLabel pill text for it.
    expect(queryByText(/Alex ·/)).toBeNull();
    // ...dots-variant TalkingBubble renders instead.
    expect(container.querySelectorAll(`.${talkingBubbleStyles.bubble}`).length).toBe(1);
    expect(container.querySelectorAll(`.${talkingBubbleStyles.bubbleText}`).length).toBe(0);
    // micah is untouched, still shows its normal StatusLabel.
    expect(getByText(/^Micah$/)).toBeTruthy();
    const micahPill = [...container.querySelectorAll(`.${statusLabelStyles.pill}`)].find((el) =>
      el.textContent?.includes("Micah"),
    );
    expect(micahPill).toBeTruthy();
  });

  it("(c) talkingTextById[id] present -> text pill renders, no dots/no label", () => {
    const { container, queryByText, getByText } = renderWithPresence({
      selfCharacterId: "bon",
      statusByLayerId: { alex: "IN_CONVERSATION" },
      talkingTextById: { alex: "Hey, got a minute to look at this?" },
    });
    expect(queryByText(/Alex ·/)).toBeNull();
    expect(getByText("Hey, got a minute to look at this?")).toBeTruthy();
    expect(container.querySelectorAll(`.${talkingBubbleStyles.bubbleText}`).length).toBe(1);
    expect(container.querySelectorAll(`.${talkingBubbleStyles.bubble}`).length).toBe(0);
  });

  it("(d) greeting active for an id -> text pill renders (greeting text), no label", () => {
    const { container, queryByText, getByText } = renderWithPresence({
      selfCharacterId: "bon",
      statusByLayerId: { alex: "AVAILABLE" },
      greetingCharacterId: "alex",
      greetingNonce: 1,
      greetingText: "Hi there, I'm Alex!",
    });
    expect(queryByText(/^Alex$/)).toBeNull();
    expect(getByText("Hi there, I'm Alex!")).toBeTruthy();
    expect(container.querySelectorAll(`.${talkingBubbleStyles.bubbleText}`).length).toBe(1);
  });

  it("(e) priority: greeting wins over sent-text for the same id", () => {
    const { queryByText, getByText } = renderWithPresence({
      selfCharacterId: "bon",
      greetingCharacterId: "alex",
      greetingNonce: 1,
      greetingText: "Hi there, I'm Alex!",
      talkingTextById: { alex: "some sent text" },
    });
    expect(getByText("Hi there, I'm Alex!")).toBeTruthy();
    expect(queryByText("some sent text")).toBeNull();
  });

  it("(f) revert case: an id with neither typing, sent-text, nor greeting -> StatusLabel renders", () => {
    const { getByText } = renderWithPresence({
      selfCharacterId: "bon",
      statusByLayerId: { alex: "AVAILABLE" },
      // Simulates a sent-text bubble having expired and no typing/greeting
      // active — must revert to the status label, not stay stuck on dots.
      typingCharacterIds: [],
      talkingTextById: {},
    });
    expect(getByText(/^Alex$/)).toBeTruthy();
  });
});

// T1 peer crowd cap raised 0 -> 2 (tierBudgets.ts, 2026-08-29): a T1 viewer
// sees their own character plus up to two registered peers in animated LOD1,
// selected by the EXISTING rule — first-come in depth-sort render order —
// with every non-selected peer staying a 2D sprite. Only bon and alex are
// really registered; micah/lui are temporarily registered per test (with
// distinct, never-loaded GLB urls so each stub is attributable) to reach the
// "more eligible peers than budget" case.
describe("OfficeStage T1 peer crowd cap (LIVE_3D_CAP_BY_TIER.T1 = 2)", () => {
  const SPRITE_RE: Record<string, RegExp> = { bon: /chibi-bon|\/bon-/, alex: /alex/, micah: /micah/, lui: /lui/, angelo: /angelo/ };
  // Maps a stub's GLB url back to the avatar id that owns it. The asset FOLDER
  // does not always equal the registry key: angelo's files are the `gelo-v1`
  // pipeline chain, and each character carries its own version suffix
  // (bon-v3, alex-v2, micah-v4).
  function stubOwner(el: HTMLElement): string {
    const url = el.getAttribute("data-glb-url") ?? "";
    if (/bon-v2|bon-v3|\/jerevon\//.test(url)) return "bon";
    if (/\/avatars\/gelo-v\d+/.test(url)) return "angelo";
    // The folder can carry further build-variant suffixes (e.g. the masculine
    // idle rebuild `alex-v2-hq-idle9/`) — match the character, not the variant.
    const m = url.match(/\/avatars\/(alex|micah|lui)(?:-v\d+)?(?:-[a-z0-9]+)*\//);
    return m ? m[1] : "?";
  }
  function stubsOf(container: HTMLElement, id: string): HTMLElement[] {
    return canvasStubs(container).filter((el) => stubOwner(el) === id);
  }
  function spritesOf(container: HTMLElement, id: string): HTMLImageElement[] {
    return Array.from(container.querySelectorAll<HTMLImageElement>("img")).filter((i) => SPRITE_RE[id].test(i.getAttribute("src") ?? ""));
  }
  // The registry ships exactly bon/alex/micah/angelo, which is already the
  // four-character crowd these tests need — no fabricated entries, and no
  // change to any crowd budget.
  function withFourRegistered<T>(fn: () => T): T {
    expect(Object.keys(LIVE_3D_CHARACTERS).sort()).toEqual(["alex", "angelo", "bon", "micah"]);
    return fn();
  }
  function renderAt(tier: "T0" | "T1" | "T2", props: Record<string, unknown> = {}) {
    vi.mocked(detectDeviceTier).mockReturnValue(tier);
    return render(
      <TransformWrapper>
        <TransformComponent>
          <OfficeStage selfCharacterId="bon" {...props} />
        </TransformComponent>
      </TransformWrapper>,
    );
  }
  // The existing selection rule: OfficeStage iterates layers in depth-sort
  // order (createDepthCompare) and hands out crowd slots first-come.
  function depthOrder(ids: string[]): string[] {
    return officeAssetLayers.filter((l) => ids.includes(l.id)).slice().sort(createDepthCompare(undefined)).map((l) => l.id);
  }

  it("T1 crowd cap 1: self plus one registered peer -> both animated 3D at LOD1", () => {
    const { container } = renderAt("T1");
    for (const id of ["bon", "alex"]) {
      const stubs = stubsOf(container, id);
      expect(stubs.length).toBe(1);
      expect(stubs[0].getAttribute("data-glb-url")).toMatch(/-lod1\.glb$/);
      expect(stubs[0].getAttribute("data-animated")).not.toBe("false");
      expect(spritesOf(container, id).length).toBe(0);
    }
  });

  it("T1 crowd cap 2: self plus the two peers the cap allows -> all three animated 3D at LOD1", () => {
    withFourRegistered(() => {
      const { container } = renderAt("T1");
      // self (bon) is always allowed; the other three registered characters
      // compete for LIVE_3D_CAP_BY_TIER.T1 = 2 peer slots.
      expect(canvasStubs(container).length).toBe(1 + LIVE_3D_CAP_BY_TIER.T1);
      expect(stubsOf(container, "bon").length).toBe(1);
      for (const stub of canvasStubs(container)) {
        expect(stub.getAttribute("data-glb-url")).toMatch(/-lod1\.glb$/);
        expect(stub.getAttribute("data-animated")).not.toBe("false");
      }
    });
  });

  it("T1 crowd cap 3: self plus three registered peers -> exactly two peers selected, the remaining peer stays a 2D sprite", () => {
    withFourRegistered(() => {
      const { container } = renderAt("T1");
      expect(stubsOf(container, "bon").length).toBe(1);
      const peerStubs = canvasStubs(container).filter((el) => stubOwner(el) !== "bon");
      expect(peerStubs.length).toBe(2);
      const selected = peerStubs.map(stubOwner);
      const excluded = ["alex", "micah", "lui"].filter((id) => !selected.includes(id));
      expect(excluded.length).toBe(1);
      expect(stubsOf(container, excluded[0]).length).toBe(0);
      expect(spritesOf(container, excluded[0]).length).toBe(1);
    });
  });

  it("T1 crowd cap 4: peer selection is deterministic and follows the existing depth-sort first-come rule", () => {
    withFourRegistered(() => {
      const expected = depthOrder(["alex", "micah", "angelo"]).slice(0, 2).sort();
      const first = renderAt("T1");
      const a = canvasStubs(first.container).filter((el) => stubOwner(el) !== "bon").map(stubOwner).sort();
      first.unmount();
      __resetDeviceTierCacheForTests();
      const second = renderAt("T1");
      const b = canvasStubs(second.container).filter((el) => stubOwner(el) !== "bon").map(stubOwner).sort();
      expect(a).toEqual(expected);
      expect(b).toEqual(expected);
    });
  });

  it("T1 crowd cap 5: T0 stays sprite-only for self and every registered peer without a DEV override", () => {
    withFourRegistered(() => {
      const { container } = renderAt("T0");
      expect(canvasStubs(container).length).toBe(0);
      for (const id of ["bon", "alex", "micah", "angelo"]) expect(spritesOf(container, id).length).toBe(1);
    });
  });

  it("T1 crowd cap 6: T2 crowd cap is still 4 — every peer animated, each at its adaptive tier", () => {
    expect(LIVE_3D_CAP_BY_TIER.T2).toBe(4);
    expect(LIVE_3D_CAP_BY_TIER.T0).toBe(0);
    withFourRegistered(() => {
      const { container } = renderAt("T2");
      // The CAP is unchanged — all four still render live-3D. What changed is
      // the QUALITY each one gets: adaptive LOD keeps the HQ mesh for the
      // self/near/focused character and gives distant peers a cheaper tier,
      // so a crowd of four never means four ~5MB downloads.
      expect(canvasStubs(container).length).toBe(4);
      for (const id of ["bon", "alex", "micah", "angelo"]) {
        const stubs = stubsOf(container, id);
        expect(stubs.length).toBe(1);
        expect(stubs[0].getAttribute("data-glb-url")).toMatch(/-lod[012]\.glb$/);
      }
    });
  });

  it("T1 crowd cap 7: no employee renders twice — exactly one visual (canvas or sprite) per character at T1", () => {
    withFourRegistered(() => {
      const { container } = renderAt("T1");
      for (const id of ["bon", "alex", "micah", "angelo"]) {
        expect(stubsOf(container, id).length + spritesOf(container, id).length).toBe(1);
      }
    });
  });

  it("T1 crowd cap 8: walking, facing, sitting and animation inputs reach a selected T1 peer canvas", () => {
    const { container } = renderAt("T1", {
      characterIsWalkingById: { alex: true },
      characterDirectionsById: { alex: "left" },
      characterIsSittingById: { alex: false },
      talkingCharacterIds: ["alex"],
      spatialTypingCharacterIds: ["alex"],
      globalChatActiveCharacterIds: ["alex"],
    });
    const stubs = stubsOf(container, "alex");
    expect(stubs.length).toBe(1);
    const stub = stubs[0];
    expect(stub.getAttribute("data-glb-url")).toMatch(/alex-v2-lod1\.glb$/);
    expect(stub.getAttribute("data-animated")).not.toBe("false");
    expect(stub.getAttribute("data-is-walking")).toBe("true");
    expect(stub.getAttribute("data-heading-degrees")).toBe("-90");
    expect(stub.getAttribute("data-is-sitting")).toBe("false");
    expect(stub.getAttribute("data-is-spatial-conversation")).toBe("true");
    expect(stub.getAttribute("data-is-typing")).toBe("true");
    expect(stub.getAttribute("data-is-global-chat-active")).toBe("true");
  });
});

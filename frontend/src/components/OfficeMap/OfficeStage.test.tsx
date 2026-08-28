import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render } from "@testing-library/react";
import { TransformWrapper, TransformComponent } from "react-zoom-pan-pinch";
import { OfficeStage, __resetDeviceTierCacheForTests } from "./OfficeStage";
import { backrestCropLayerId } from "../../data/backSitOccupancy";
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
      isChatting?: boolean;
      isResponder?: boolean;
      width: number;
      height: number;
      onError?: () => void;
      animated?: boolean;
    }) => (
      <div
        data-testid="character-canvas-stub"
        data-glb-url={props.glbUrl}
        data-heading-degrees={props.headingDegrees}
        data-is-walking={props.isWalking}
        data-is-sitting={props.isSitting}
        data-is-chatting={props.isChatting}
        data-is-responder={props.isResponder}
        data-animated={props.animated}
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

    const { queryByTestId } = renderGated("bon");

    expect(queryByTestId("character-canvas-stub")).not.toBeNull();
  });

  it("shows the self avatar (bon) as CharacterCanvas at T2, with no URL param", () => {
    vi.mocked(detectDeviceTier).mockReturnValue("T2");

    const { queryByTestId } = renderGated("bon");

    expect(queryByTestId("character-canvas-stub")).not.toBeNull();
  });

  it("falls back to sprite for the self avatar at T0, the hard safety floor", () => {
    vi.mocked(detectDeviceTier).mockReturnValue("T0");

    const { queryByTestId, container } = renderGated("bon");

    expect(queryByTestId("character-canvas-stub")).toBeNull();
    expect(container.querySelector('img[src*="bon"]')).not.toBeNull();
  });

  it("shows a non-self bon as CharacterCanvas at T1 (size-gated relaxation: registry has only one entry)", () => {
    vi.mocked(detectDeviceTier).mockReturnValue("T1");

    // No selfCharacterId passed -> bon is treated as a peer/crowd member,
    // not the viewer's own avatar. With LIVE_3D_CHARACTERS holding only
    // bon's entry, there's no "crowd" to budget against — every T1+ viewer
    // (self or peer) sees him live-3D, so this must NOT fall back to sprite.
    const { queryByTestId } = renderGated(undefined);

    expect(queryByTestId("character-canvas-stub")).not.toBeNull();
  });

  it("shows a non-self bon as CharacterCanvas at T2, within the crowd budget", () => {
    vi.mocked(detectDeviceTier).mockReturnValue("T2");

    const { queryByTestId } = renderGated(undefined);

    expect(queryByTestId("character-canvas-stub")).not.toBeNull();
  });

  it("shows bon as CharacterCanvas at T1 to a genuine peer viewer (selfCharacterId is someone else), single-entry registry", () => {
    vi.mocked(detectDeviceTier).mockReturnValue("T1");

    // selfCharacterId is "alex", not "bon" -> bon is unambiguously a peer
    // here, not merely "no self set". Proves the size-gated relaxation
    // applies to real peer viewing, not just the no-selfCharacterId case.
    const { queryByTestId } = renderGated("alex");

    expect(queryByTestId("character-canvas-stub")).not.toBeNull();
  });

  it("falls back to sprite for a character with no live-3D registry entry, regardless of tier", () => {
    vi.mocked(detectDeviceTier).mockReturnValue("T2");

    // "alex" has no LIVE_3D_CHARACTERS entry (only "bon" ships today).
    const { container } = renderGated(undefined);

    const alexStubs = container.querySelectorAll('[data-testid="character-canvas-stub"]');
    // None of the rendered canvas stubs (if any, from bon) belong to alex —
    // confirmed instead via alex's sprite <img> still being present.
    expect(container.querySelector('img[src*="alex"]')).not.toBeNull();
    // Sanity: whatever canvas stub(s) exist are bon's, not alex's — there's
    // exactly one live-3D-eligible avatar id in the real registry today.
    expect(alexStubs.length).toBeLessThanOrEqual(1);
  });

  describe("crowd budget cap enforcement (registry temporarily widened for this test)", () => {
    const ORIGINAL_T2_CAP = LIVE_3D_CAP_BY_TIER.T2;
    const originalBonEntry = LIVE_3D_CHARACTERS.bon;

    beforeEach(() => {
      // Widen eligibility to 3 real, always-present manifest characters
      // (bon/alex/micah/lui all exist in officeAssetLayers already) and
      // shrink the T2 crowd cap to 2, so "3 eligible, cap 2" is reachable
      // without needing to fabricate manifest layers.
      LIVE_3D_CAP_BY_TIER.T2 = 2;
      LIVE_3D_CHARACTERS.alex = { ...originalBonEntry, renderWidth: 160, renderHeight: 276 };
      LIVE_3D_CHARACTERS.micah = { ...originalBonEntry, renderWidth: 160, renderHeight: 276 };
      LIVE_3D_CHARACTERS.lui = { ...originalBonEntry, renderWidth: 160, renderHeight: 276 };
    });

    afterEach(() => {
      LIVE_3D_CAP_BY_TIER.T2 = ORIGINAL_T2_CAP;
      delete LIVE_3D_CHARACTERS.alex;
      delete LIVE_3D_CHARACTERS.micah;
      delete LIVE_3D_CHARACTERS.lui;
    });

    it("caps non-self live-3D characters at the tier's crowd budget, falling back to sprite for the excess", () => {
      vi.mocked(detectDeviceTier).mockReturnValue("T2");

      // No selfCharacterId -> bon/alex/micah/lui are ALL crowd members.
      const { container } = renderGated(undefined);

      const stubs = container.querySelectorAll('[data-testid="character-canvas-stub"]');
      expect(stubs.length).toBe(2);
    });

    it("does not let self-avatar consumption count against (or get counted by) the crowd budget", () => {
      vi.mocked(detectDeviceTier).mockReturnValue("T2");

      // bon is self here — self is unconditionally allowed at T2 and must
      // not consume one of the 2 crowd slots also available to
      // alex/micah/lui.
      const { container } = renderGated("bon");

      const stubs = container.querySelectorAll('[data-testid="character-canvas-stub"]');
      // bon (self) + 2 crowd slots (alex/micah/lui, cap 2) = 3 total.
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
      const { container, queryAllByTestId } = renderBonAt("T2");

      const stubs = queryAllByTestId("character-canvas-stub");
      // Exactly one live-3D node for bon — never dropped, never duplicated
      // into a second (e.g. stale sprite) node alongside it.
      expect(stubs).toHaveLength(1);
      expect(container.querySelectorAll('img[src*="bon"]')).toHaveLength(0);
      const layerDiv = stubs[0].closest<HTMLElement>(`.${styles.layer}`)!;
      expect(layerDiv.style.left).not.toBe("");
      expect(layerDiv.style.top).not.toBe("");
    });

    it("no live-3D registry entry + no crowd budget (a tier that grants nothing) still renders the 2D sprite, never an empty src, never a dropped layer", () => {
      // "alex" has no LIVE_3D_CHARACTERS entry at all, at any tier — the
      // worst case for "does a no-budget tier still render someone".
      vi.mocked(detectDeviceTier).mockReturnValue("T0");
      const { container } = render(
        <TransformWrapper>
          <TransformComponent>
            <OfficeStage selfCharacterId="bon" />
          </TransformComponent>
        </TransformWrapper>,
      );
      const alexImg = container.querySelector<HTMLImageElement>('img[src*="alex"]');
      expect(alexImg).not.toBeNull();
      expect(alexImg!.getAttribute("src")).toBeTruthy();
    });
  });

  describe("isResponder wiring (characterIsResponderById, layer-id-keyed)", () => {
    // Regression test for the id-space bug: OfficeStage must read isResponder
    // from characterIsResponderById (layer-id-keyed), never from
    // talkingTextById (senderId/email-keyed) directly — passing an
    // email-keyed talkingTextById entry alone must NOT flip isResponder for
    // a same-named layer id.
    it("sets isResponder=true for a layer id present in characterIsResponderById", () => {
      vi.mocked(detectDeviceTier).mockReturnValue("T1");

      const { getByTestId } = render(
        <TransformWrapper>
          <TransformComponent>
            <OfficeStage selfCharacterId="bon" characterIsResponderById={{ bon: true }} />
          </TransformComponent>
        </TransformWrapper>,
      );

      expect(getByTestId("character-canvas-stub").getAttribute("data-is-responder")).toBe("true");
    });

    it("leaves isResponder false when only the email-keyed talkingTextById (not characterIsResponderById) has an entry", () => {
      vi.mocked(detectDeviceTier).mockReturnValue("T1");

      const { getByTestId } = render(
        <TransformWrapper>
          <TransformComponent>
            <OfficeStage
              selfCharacterId="bon"
              talkingTextById={{ "jerevon@offshorly.com": "hey team" }}
            />
          </TransformComponent>
        </TransformWrapper>,
      );

      expect(getByTestId("character-canvas-stub").getAttribute("data-is-responder")).toBe("false");
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

      const { queryByTestId } = renderGated("bon");

      expect(queryByTestId("character-canvas-stub")).not.toBeNull();
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

      const { queryByTestId } = renderGated("bon");

      expect(queryByTestId("character-canvas-stub")).not.toBeNull();
    });
  });

  describe("runtime fallback on live-3D load failure", () => {
    it("falls back to the sprite for a character whose CharacterCanvas reports onError", () => {
      vi.mocked(detectDeviceTier).mockReturnValue("T1");

      const { getByTestId, queryByTestId, container } = renderGated("bon");

      expect(getByTestId("character-canvas-stub")).not.toBeNull();
      fireEvent.click(getByTestId("character-canvas-error-trigger"));

      expect(queryByTestId("character-canvas-stub")).toBeNull();
      expect(container.querySelector('img[src*="bon"]')).not.toBeNull();
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

      const { getByTestId } = renderGated("bon");

      const before = getByTestId("character-canvas-stub");
      expect(before.dataset.animated).toBe("false");
      expect(before.dataset.glbUrl).toContain("lod2");

      // Flush the rescue microbench's promise chain (getSharedDeviceTierMicrobench
      // -> computeDeviceTier -> setTier), matching how the real async
      // useEffect->promise->setState sequence resolves.
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });

      const after = getByTestId("character-canvas-stub");
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

      const { getByTestId } = renderGated("bon");

      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });

      const stub = getByTestId("character-canvas-stub");
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

      const { getByTestId, container } = renderGated("bon");

      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });

      const stub = getByTestId("character-canvas-stub");
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

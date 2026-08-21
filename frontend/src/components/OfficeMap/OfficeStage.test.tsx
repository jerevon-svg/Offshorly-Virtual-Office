import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render } from "@testing-library/react";
import { TransformWrapper, TransformComponent } from "react-zoom-pan-pinch";
import { OfficeStage, __resetDeviceTierCacheForTests } from "./OfficeStage";
import { backrestCropLayerId } from "../../data/backSitOccupancy";
import { LIVE_3D_CHARACTERS } from "../../render3d/live3dCharacters";
import { LIVE_3D_CAP_BY_TIER } from "../../services/render/tierBudgets";
import { detectDeviceTier } from "../../services/render/deviceTier";
import styles from "./OfficeStage.module.css";

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
    }) => (
      <div
        data-testid="character-canvas-stub"
        data-heading-degrees={props.headingDegrees}
        data-is-walking={props.isWalking}
        data-is-sitting={props.isSitting}
        data-is-chatting={props.isChatting}
        data-is-responder={props.isResponder}
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
  return { ...actual, detectDeviceTier: vi.fn(actual.detectDeviceTier) };
});

// getDeviceTierOnce() (OfficeStage.tsx) caches detectDeviceTier()'s result
// at module scope for the whole session — reset before every test so each
// test's own mockReturnValue (or the default real-jsdom-T0 behavior) is
// actually re-read, instead of leaking whichever tier the first test in
// the file happened to compute.
beforeEach(() => {
  __resetDeviceTierCacheForTests();
});

// Real dev-team furniture id (see office-assets-manifest.json) whose seat
// (roomSeats.ts/seatDirections.ts) can be assigned "back" direction —
// path assets/office/furniture/dev-team/dev-visitor-chair.png, fraction 0.4
// in chairBackrestCrop.ts.
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

describe("OfficeStage synthetic backrest-crop layer generation", () => {
  it("generates exactly one synthetic crop layer, clipped to the looked-up fraction, for an occupied back-sit seat", () => {
    const { container } = renderStage({ [backrestCropLayerId(DEV_BACK_CHAIR_ID)]: 999 });

    const clipped = clipPathLayers(container);
    expect(clipped.length).toBe(1);
    // fraction 0.4 for dev-visitor-chair.png -> clip away bottom 60%.
    expect(clipped[0].style.clipPath).toBe("inset(0 0 60% 0)");
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

  it("defaults to front (0deg) and walking=true when no direction/walk-state entry is given for the toggled character", () => {
    const { getByTestId } = renderStageWithLive3d("bon");

    const stub = getByTestId("character-canvas-stub");
    expect(stub.dataset.headingDegrees).toBe("0");
    expect(stub.dataset.isWalking).toBe("true");
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

  it("falls back to sprite for a non-self bon at T1 (crowd cap is 0 at T1)", () => {
    vi.mocked(detectDeviceTier).mockReturnValue("T1");

    // No selfCharacterId passed -> bon is treated as a crowd member, not
    // the viewer's own avatar.
    const { queryByTestId } = renderGated(undefined);

    expect(queryByTestId("character-canvas-stub")).toBeNull();
  });

  it("shows a non-self bon as CharacterCanvas at T2, within the crowd budget", () => {
    vi.mocked(detectDeviceTier).mockReturnValue("T2");

    const { queryByTestId } = renderGated(undefined);

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
});

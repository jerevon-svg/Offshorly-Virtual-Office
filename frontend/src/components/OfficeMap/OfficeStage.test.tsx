import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { TransformWrapper, TransformComponent } from "react-zoom-pan-pinch";
import { OfficeStage } from "./OfficeStage";
import { backrestCropLayerId } from "../../data/backSitOccupancy";
import styles from "./OfficeStage.module.css";

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

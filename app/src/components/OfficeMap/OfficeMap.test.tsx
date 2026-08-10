import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { OfficeMap } from "./OfficeMap";

describe("OfficeMap", () => {
  it("renders without throwing", () => {
    expect(() => render(<OfficeMap />)).not.toThrow();
  });

  it("renders the layered office stage with multiple images", () => {
    const { container } = render(<OfficeMap />);
    const images = container.querySelectorAll("img");
    // 160 layers from the manifest: floor + rooms + decor + characters +
    // furniture (140 previous + 20 cms-team furniture pieces added when
    // cms-team's room background/furniture were split, mirroring the
    // ai-team/executive-team/dev-team/design-team migration).
    expect(images.length).toBe(160);
  });

  it("mounts the TransformWrapper wrapper div", () => {
    const { container } = render(<OfficeMap />);
    const wrapper = container.querySelector(".react-transform-wrapper");
    expect(wrapper).not.toBeNull();
  });
});

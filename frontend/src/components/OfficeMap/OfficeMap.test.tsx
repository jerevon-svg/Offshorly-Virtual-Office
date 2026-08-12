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
    // 164 layers from the manifest: floor + rooms + decor + characters +
    // furniture (161 previous + 3 for the new ai-door / executive-door-left /
    // executive-door-right visual door assets from Bon's Figma redesign).
    expect(images.length).toBe(164);
  });

  it("mounts the TransformWrapper wrapper div", () => {
    const { container } = render(<OfficeMap />);
    const wrapper = container.querySelector(".react-transform-wrapper");
    expect(wrapper).not.toBeNull();
  });
});

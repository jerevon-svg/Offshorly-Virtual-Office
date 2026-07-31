import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { OfficeMap } from "./OfficeMap";

describe("OfficeMap", () => {
  it("renders without throwing", () => {
    expect(() => render(<OfficeMap />)).not.toThrow();
  });

  it("renders the floorplan image with the expected src fragment", () => {
    render(<OfficeMap />);
    const img = screen.getByAltText("Offshorly virtual office floorplan");
    expect(img).toBeInTheDocument();
    expect(img.tagName).toBe("IMG");
    expect((img as HTMLImageElement).src).toContain("floorplan");
  });

  it("mounts the TransformWrapper wrapper div", () => {
    const { container } = render(<OfficeMap />);
    const wrapper = container.querySelector(".react-transform-wrapper");
    expect(wrapper).not.toBeNull();
  });
});

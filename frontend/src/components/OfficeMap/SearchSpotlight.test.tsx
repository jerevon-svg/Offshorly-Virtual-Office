import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { SearchSpotlight } from "./SearchSpotlight";
import type { AssetLayer } from "../../types/office";

function layer(id: string, name: string): AssetLayer {
  return {
    id,
    kind: "character",
    path: `/sprites/${name}.png`,
    x: 0,
    y: 0,
    width: 10,
    height: 10,
    transform: null,
    name,
  };
}

const PEOPLE = [layer("alex@offshorly.com", "Alex"), layer("micah@offshorly.com", "Micah")];

function setup(overrides: Partial<Parameters<typeof SearchSpotlight>[0]> = {}) {
  const props = {
    open: true,
    onClose: vi.fn(),
    people: PEOPLE,
    statusByLayerId: { "alex@offshorly.com": "AVAILABLE" as const },
    onLocate: vi.fn(),
    onChat: vi.fn(),
    onCall: vi.fn(),
    ...overrides,
  };
  render(<SearchSpotlight {...props} />);
  return props;
}

describe("SearchSpotlight", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("renders nothing while closed", () => {
    setup({ open: false });
    expect(screen.queryByTestId("search-spotlight")).toBeNull();
  });

  it("shows Recent teammates before anything is typed", () => {
    setup();
    expect(screen.getByText("Recent")).toBeInTheDocument();
    expect(screen.getByLabelText("Locate Alex")).toBeInTheDocument();
  });

  it("filters real teammates as you type", () => {
    setup();
    fireEvent.change(screen.getByLabelText("Find a teammate"), { target: { value: "ale" } });

    expect(screen.getByText("1 teammate found")).toBeInTheDocument();
    expect(screen.getByLabelText("Chat with Alex")).toBeInTheDocument();
    expect(screen.queryByLabelText("Chat with Micah")).toBeNull();
  });

  it("routes Locate / Chat / Call to the caller's own handlers and closes", () => {
    const props = setup();
    fireEvent.change(screen.getByLabelText("Find a teammate"), { target: { value: "alex" } });

    fireEvent.click(screen.getByLabelText("Chat with Alex"));
    expect(props.onChat).toHaveBeenCalledWith(PEOPLE[0]);
    expect(props.onClose).toHaveBeenCalled();
  });

  it("closes on Escape", () => {
    const props = setup();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(props.onClose).toHaveBeenCalled();
  });
});

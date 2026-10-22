// THE ELEVATOR'S FLOOR PANEL — rows from the registry, the current floor lit and refused, mouse + keyboard,
// Escape and an outside press close it. A four-storey building is described here on purpose: the panel must
// not know how many floors the real registry has.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
// @ts-expect-error node:fs is untyped under tsconfig.app.json (types: ["vite/client"] only); vitest runs it in node
import { readFileSync } from "node:fs";
import { Vo3dFloorPicker } from "./Vo3dFloorPicker";
import { FLOORS, FLOOR_ORDER, elevatorFloorRows, elevatorNeedsPicker, isElevatorDestination } from "./floors";

type Id = "f1" | "f2" | "f3" | "f4";
const ORDER: readonly Id[] = ["f1", "f2", "f3", "f4"];
const TABLE: Record<Id, { indicator: string; name: string }> = {
  f1: { indicator: "01", name: "Office" },
  f2: { indicator: "02", name: "Meetings" },
  f3: { indicator: "03", name: "Compass University" },
  f4: { indicator: "04", name: "Gaming & Social" },
};

afterEach(cleanup);

describe("floor panel model (app/floors)", () => {
  it("lists every floor top first, marks the current one and the direction to each other", () => {
    const rows = elevatorFloorRows<Id>("f2", ORDER, TABLE);
    expect(rows.map((r) => r.indicator)).toEqual(["04", "03", "02", "01"]);
    expect(rows.map((r) => r.current)).toEqual([false, false, true, false]);
    expect(rows.map((r) => r.direction)).toEqual(["up", "up", null, "down"]);
  });

  it("derives the real building's panel from the registry", () => {
    const rows = elevatorFloorRows(FLOOR_ORDER[0], FLOOR_ORDER, FLOORS);
    expect(rows.map((r) => r.id)).toEqual([...FLOOR_ORDER].reverse());
    expect(rows.find((r) => r.current)?.name).toBe(FLOORS[FLOOR_ORDER[0]].name);
  });

  it("asks only once there is more than one other floor — two floors stay one-click", () => {
    expect(elevatorNeedsPicker()).toBe(true); // the registry: Office, Meetings, Compass University, Gaming & Social
    expect(elevatorNeedsPicker(["a", "b"])).toBe(false);
    expect(elevatorNeedsPicker(["a", "b", "c"])).toBe(true);
  });

  it("refuses the floor you are on and anything unregistered", () => {
    expect(isElevatorDestination<string>("f1", "f3", ORDER)).toBe(true);
    expect(isElevatorDestination<string>("f2", "f2", ORDER)).toBe(false);
    expect(isElevatorDestination<string>("f1", "f9", ORDER)).toBe(false);
  });
});

function renderPanel(current: Id = "f2") {
  const onSelect = vi.fn();
  const onClose = vi.fn();
  render(<Vo3dFloorPicker rows={elevatorFloorRows<Id>(current, ORDER, TABLE)} onSelect={onSelect} onClose={onClose} />);
  return { onSelect, onClose };
}

describe("Vo3dFloorPicker", () => {
  it("shows number, name and where you are; the current floor is disabled", () => {
    renderPanel("f2");
    expect(screen.getByText("You're on 02 · Meetings")).toBeTruthy();
    expect(screen.getAllByRole("button").filter((b) => b.dataset.testid?.startsWith("floor-picker-")).map((b) => b.textContent)).toEqual([
      "04Gaming & Social▲", "03Compass University▲", "02MeetingsYou're here", "01Office▼",
    ]);
    const here = screen.getByTestId("floor-picker-f2") as HTMLButtonElement;
    expect(here.disabled).toBe(true);
    expect(here.getAttribute("aria-current")).toBe("location");
  });

  it("a click on a destination selects it; a click on the current floor does nothing", () => {
    const { onSelect } = renderPanel("f2");
    fireEvent.click(screen.getByTestId("floor-picker-f2"));
    expect(onSelect).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("floor-picker-f4"));
    expect(onSelect).toHaveBeenCalledWith("f4");
  });

  it("focuses the nearest destination, upward first, and arrows skip the current floor", () => {
    const { onSelect } = renderPanel("f2");
    expect(document.activeElement).toBe(screen.getByTestId("floor-picker-f3"));
    fireEvent.keyDown(window, { key: "ArrowDown" });
    expect(document.activeElement).toBe(screen.getByTestId("floor-picker-f1"));
    fireEvent.keyDown(window, { key: "ArrowDown" }); // wraps to the top
    expect(document.activeElement).toBe(screen.getByTestId("floor-picker-f4"));
    fireEvent.keyDown(window, { key: "End" });
    fireEvent.keyDown(window, { key: "Enter" });
    expect(onSelect).toHaveBeenCalledWith("f1");
  });

  it("a digit presses that floor's button; the current floor's digit is refused", () => {
    const { onSelect } = renderPanel("f2");
    fireEvent.keyDown(window, { key: "2" });
    expect(onSelect).not.toHaveBeenCalled();
    fireEvent.keyDown(window, { key: "3" });
    expect(onSelect).toHaveBeenCalledWith("f3");
  });

  it("stops the keys it answers before PLAYER sees them (Space would jump)", () => {
    renderPanel("f2");
    const player = vi.fn();
    window.addEventListener("keydown", player);
    fireEvent.keyDown(document.body, { key: " " });
    fireEvent.keyDown(document.body, { key: "ArrowUp" });
    expect(player).not.toHaveBeenCalled();
    fireEvent.keyDown(document.body, { key: "w" }); // not the panel's: walking away is still allowed
    expect(player).toHaveBeenCalledTimes(1);
    window.removeEventListener("keydown", player);
  });

  it("Escape, the close button and an outside press close it without selecting", () => {
    const { onSelect, onClose } = renderPanel("f1");
    fireEvent.keyDown(window, { key: "Escape" });
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    fireEvent.pointerDown(document.body);
    expect(onClose).toHaveBeenCalledTimes(3);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("an inside press does not close it", () => {
    const { onClose } = renderPanel("f1");
    fireEvent.pointerDown(screen.getByTestId("floor-picker"));
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe("the panel is wired through the existing ride path", () => {
  const strip = (f: string) => readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  const world = strip("src/dev/vo3d/app/world.ts");
  const overlay = strip("src/dev/vo3d/app/Vo3dOverlay.tsx");

  it("keeps the two-floor call the one-click ride, and asks only when the panel is wanted", () => {
    const fn = world.slice(world.indexOf("function requestElevator"), world.indexOf("function callElevator"));
    expect(fn).toContain("if ((!forceFloorPicker && !elevatorNeedsPicker(FLOOR_ORDER)) || !ask) return callElevator(otherFloor());");
    expect(fn).toContain("ask({ from: currentFloor });");
    expect(world).toContain('const forceFloorPicker = flags.get("liftpicker") === "1";');
  });

  it("routes every undirected call (interact key, click, GUI, dev) through requestElevator", () => {
    expect(world).toContain("if (ELEVATOR_CALL_IDS.has(id)) return requestElevator();");
    // INTERACTION V2 — the click's card (or a host-less click) runs the call plate's row through the same call
    expect(world).toContain('id.endsWith("/call") && ELEVATOR_ROOM_IDS.has(world.get(id).roomId)');
    expect(world).toContain("else if (isElevatorCall(id)) requestElevator();");
    expect(world).toContain("liftGui.add({ go: () => requestElevator() }");
    expect(world).not.toMatch(/callElevator\(\)/);
  });

  it("validates a chosen floor and hands it to callElevator — the ride, camera and Go Together are untouched", () => {
    expect(world).toContain("useElevator: (to) => (to !== undefined && !isElevatorDestination(currentFloor, to, FLOOR_ORDER) ? false : callElevator(to ?? otherFloor())),");
    expect(overlay).toContain("worldRef.current?.useElevator(to as Vo3dFloorId);");
    expect(overlay).toContain("rows={elevatorFloorRows(floorPicker.from, FLOOR_ORDER, FLOORS)}");
  });
});

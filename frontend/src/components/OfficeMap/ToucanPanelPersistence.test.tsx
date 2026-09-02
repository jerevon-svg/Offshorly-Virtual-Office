import { useState } from "react";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { ToucanAssistantPanel } from "./ToucanAssistantPanel";
// Vite's ?raw import, so the source assertions below need no node types.
import officeMapSource from "./OfficeMap.tsx?raw";

// REGRESSION: walking must not wipe the Toucan conversation.
//
// The bird re-enters "approaching" whenever the viewer walks further than
// FOLLOW_BREAK_PX from the park point (see decideSummon in ToucanFlyer.tsx).
// OfficeMap used to mount the panel behind `toucanPanelOpen && toucanState
// === "attending"`, so every such walk unmounted the panel and destroyed the
// transcript, the draft and any in-flight question — then remounted a fresh
// panel on arrival. The panel's lifetime is now the summoned session alone.
//
// Two halves, because either on its own would be weak:
//   1. a harness that drives attending -> approaching -> attending, with a
//      control proving the harness actually detects the old bug;
//   2. a source assertion that OfficeMap's panel mount no longer depends on
//      the bird's flight phase, which is the thing a future edit could undo.
//
// Driving the real OfficeMap here would mean completing the reception
// check-in walk (setHasCheckedIn only fires deep inside that sequence), which
// is far more brittle than what it would buy.

const MOCK_DELAY = 1100;

function Harness({ gateOnAttending }: { gateOnAttending: boolean }) {
  const [summonState, setSummonState] = useState<"attending" | "approaching">("attending");
  const panelOpen = true;
  return (
    <>
      <button onClick={() => setSummonState("approaching")}>walk away</button>
      <button onClick={() => setSummonState("attending")}>bird catches up</button>
      {panelOpen && (!gateOnAttending || summonState === "attending") && (
        <ToucanAssistantPanel onRelease={vi.fn()} onPendingChange={vi.fn()} />
      )}
    </>
  );
}

const composer = () => screen.getByLabelText("Message the toucan") as HTMLTextAreaElement;
const walkAwayAndBack = () => {
  fireEvent.click(screen.getByText("walk away"));
  fireEvent.click(screen.getByText("bird catches up"));
};

describe("Toucan panel survives the bird's follow flight", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  async function askAndSettle(text: string) {
    fireEvent.change(composer(), { target: { value: text } });
    fireEvent.keyDown(composer(), { key: "Enter" });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(MOCK_DELAY);
    });
  }

  it("keeps the transcript across attending -> approaching -> attending", async () => {
    render(<Harness gateOnAttending={false} />);
    await askAndSettle("hello toucan");
    expect(screen.getByText("hello toucan")).toBeInTheDocument();
    expect(screen.getByText("Hello! Nice to perch beside you.")).toBeInTheDocument();

    walkAwayAndBack();

    expect(screen.getByText("hello toucan")).toBeInTheDocument();
    expect(screen.getByText("Hello! Nice to perch beside you.")).toBeInTheDocument();
  });

  it("keeps an unsent draft across the same cycle", () => {
    render(<Harness gateOnAttending={false} />);
    fireEvent.change(composer(), { target: { value: "where is ang" } });

    walkAwayAndBack();

    expect(composer().value).toBe("where is ang");
  });

  it("keeps the greeting from being repeated after the bird re-parks", async () => {
    render(<Harness gateOnAttending={false} />);
    await askAndSettle("hello toucan");
    walkAwayAndBack();
    expect(screen.getAllByText(/I'm the office toucan/)).toHaveLength(1);
  });

  // CONTROL: the harness must actually be able to see the old bug, or the
  // three tests above prove nothing.
  it("would lose the transcript if the mount were gated on the flight phase", async () => {
    render(<Harness gateOnAttending />);
    await askAndSettle("hello toucan");
    expect(screen.getByText("hello toucan")).toBeInTheDocument();

    walkAwayAndBack();

    expect(screen.queryByText("hello toucan")).not.toBeInTheDocument();
    expect(screen.getAllByText(/I'm the office toucan/)).toHaveLength(1);
  });
});

describe("OfficeMap's panel mount", () => {
  it("does not depend on the bird's summon state", () => {
    const source = officeMapSource;
    const mount = source.slice(source.indexOf("<ToucanAssistantPanel") - 400, source.indexOf("<ToucanAssistantPanel"));
    const guard = mount.slice(mount.lastIndexOf("{toucanPanelOpen"));
    expect(guard).toContain("{toucanPanelOpen && (");
    expect(guard).not.toContain("toucanState");
  });

  it("still gates the character talking animation on attending", () => {
    const source = officeMapSource;
    expect(source).toContain('const toucanSessionActive = toucanPanelOpen && toucanState === "attending";');
  });
});

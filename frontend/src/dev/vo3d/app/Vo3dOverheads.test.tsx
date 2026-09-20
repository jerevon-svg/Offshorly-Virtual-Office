// Phase 7B — SPATIAL CHAT ABOVE THE BODIES. Two things are asserted, and they are the two a world-space
// overlay gets wrong: WHAT is drawn over whom (V1's own priority and stacking), and WHERE — that the
// element tracks the body through the camera every frame instead of being pinned where it first appeared.
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Vo3dOverheads, SELF_OVERHEAD_KEY, type Vo3dOverhead } from "./Vo3dOverheads";
import type { Vo3dWorld } from "./world";
import type { Vo3dScreenAnchor } from "./interactions";
import {
  __resetExperiencePreferencesForTests,
  setExperiencePreference,
} from "../../../services/settings/experiencePreferences";

const ALEX = "alex@offshorly.com";
const MICAH = "micah@offshorly.com";

let anchors: Record<string, Vo3dScreenAnchor> = {};
let selfAnchorValue: Vo3dScreenAnchor | null = null;
let askedFor: string[][] = [];
const world = {
  coworkerAnchors: (emails: readonly string[]) => {
    askedFor.push([...emails]);
    return anchors;
  },
  selfAnchor: () => selfAnchorValue,
} as unknown as Vo3dWorld;
const worldRef = { current: world };

const onOpenConversation = vi.fn((_e: string, _c: string) => {});

/** Drive exactly one animation frame, the way the layer's own loop is driven. */
let frames: FrameRequestCallback[] = [];
function pumpFrame() {
  const due = frames;
  frames = [];
  act(() => { for (const f of due) f(performance.now()); });
}

beforeEach(() => {
  anchors = {};
  selfAnchorValue = null;
  askedFor = [];
  frames = [];
  vi.clearAllMocks();
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => { frames.push(cb); return frames.length; });
  vi.stubGlobal("cancelAnimationFrame", () => {});
});
afterEach(() => vi.unstubAllGlobals());

const mount = (overheads: Vo3dOverhead[]) =>
  render(
    <Vo3dOverheads worldRef={worldRef} ready overheads={overheads} onOpenConversation={onOpenConversation} />,
  );

const at = (clientX: number, clientY: number, scale = 2, visible = true): Vo3dScreenAnchor =>
  ({ clientX, clientY, visible, scale });

describe("what is drawn", () => {
  it("draws nothing at all for a quiet office", () => {
    mount([]);
    expect(screen.getByTestId("vo3d-overheads").children.length).toBe(0);
  });

  it("shows typing dots for somebody who is typing", () => {
    mount([{ email: ALEX, displayName: "Alex", typing: true }]);
    expect(screen.getByTestId(`overhead-typing-${ALEX}`)).toBeTruthy();
    expect(screen.queryByTestId(`overhead-text-${ALEX}`)).toBeNull();
  });

  it("prefers what they JUST SAID over the dots that preceded it — V1's own priority", () => {
    mount([{ email: ALEX, displayName: "Alex", typing: true, sentText: "on my way" }]);
    expect(screen.getByTestId(`overhead-text-${ALEX}`).textContent).toBe("on my way");
    expect(screen.queryByTestId(`overhead-typing-${ALEX}`)).toBeNull();
  });

  it("stacks the unread indicator ABOVE whatever else is overhead, not instead of it", () => {
    mount([{ email: ALEX, displayName: "Alex", typing: true, unread: { conversationId: "c1", count: 3 } }]);
    expect(screen.getByTestId(`overhead-typing-${ALEX}`)).toBeTruthy();
    const badge = screen.getByTestId(`overhead-unread-${ALEX}`);
    expect(badge.textContent).toContain("3");
    // more clearance when a taller element sits underneath than when nothing does
    const withTyping = badge.style.marginBottom;
    render(<Vo3dOverheads worldRef={worldRef} ready overheads={[{ email: MICAH, displayName: "Micah", unread: { conversationId: "c2", count: 1 } }]} onOpenConversation={onOpenConversation} />);
    const alone = screen.getByTestId(`overhead-unread-${MICAH}`).style.marginBottom;
    expect(parseFloat(withTyping)).toBeGreaterThan(parseFloat(alone));
  });

  it("sizes the unread glyph in em, so it rides the same camera scale as the pills", () => {
    anchors = { [ALEX]: at(400, 300, 3) };
    mount([{ email: ALEX, displayName: "Alex", unread: { conversationId: "c1", count: 1 } }]);
    pumpFrame();
    const img = screen.getByTestId(`overhead-unread-${ALEX}`).querySelector("img")!;
    // HudIcon writes width/height INLINE, so a px value here would pin the icon at a fixed on-screen
    // size at every zoom — which is exactly the bug this replaced.
    expect(img.style.width).toMatch(/em$/);
    expect(img.style.height).toMatch(/em$/);
    expect(img.style.width).not.toMatch(/px/);
  });

  it("keeps the indicator proportional to the name pill rather than to the viewport", () => {
    // Two bodies at different depths: the one nearer the camera gets the larger anchor font-size, and
    // the indicator inherits it because every one of its metrics is em-based.
    anchors = { [ALEX]: at(400, 300, 3), [MICAH]: at(900, 250, 1) };
    mount([
      { email: ALEX, displayName: "Alex", unread: { conversationId: "c1", count: 1 } },
      { email: MICAH, displayName: "Micah", unread: { conversationId: "c2", count: 1 } },
    ]);
    pumpFrame();
    const near = parseFloat(screen.getByTestId(`overhead-${ALEX}`).style.fontSize);
    const far = parseFloat(screen.getByTestId(`overhead-${MICAH}`).style.fontSize);
    expect(near).toBeGreaterThan(far);
    // the glyph is expressed against that font-size, not against pixels
    const nearImg = screen.getByTestId(`overhead-unread-${ALEX}`).querySelector("img")!;
    const farImg = screen.getByTestId(`overhead-unread-${MICAH}`).querySelector("img")!;
    expect(nearImg.style.width).toBe(farImg.style.width); // same em...
    expect(nearImg.style.width).toMatch(/em$/); // ...resolving to different pixels via the anchor
  });

  it("caps the count the way the dock's badges do", () => {
    mount([{ email: ALEX, displayName: "Alex", unread: { conversationId: "c1", count: 42 } }]);
    expect(screen.getByTestId(`overhead-unread-${ALEX}`).textContent).toContain("9+");
  });

  it("names the person in the accessible label rather than only showing a glyph", () => {
    // Placed first: an element the camera has not positioned yet is visibility:hidden, and a hidden
    // element is correctly absent from the accessibility tree. This is the state a viewer actually sees.
    anchors = { [ALEX]: at(400, 300) };
    mount([{ email: ALEX, displayName: "Alex Cruz", unread: { conversationId: "c1", count: 1 } }]);
    pumpFrame();
    expect(screen.getByRole("button", { name: "1 unread message from Alex Cruz" })).toBeTruthy();
  });

  it("keeps an off-screen body's indicator out of the accessibility tree, not just out of sight", () => {
    anchors = { [ALEX]: at(400, 300, 2, false) };
    mount([{ email: ALEX, displayName: "Alex Cruz", unread: { conversationId: "c1", count: 1 } }]);
    pumpFrame();
    expect(screen.queryByRole("button", { name: /unread message/ })).toBeNull();
  });

  it("opens that person's conversation when the indicator is clicked", () => {
    mount([{ email: ALEX, displayName: "Alex", unread: { conversationId: "conv-1", count: 2 } }]);
    fireEvent.click(screen.getByTestId(`overhead-unread-${ALEX}`));
    expect(onOpenConversation).toHaveBeenCalledWith(ALEX, "conv-1");
  });
});

describe("where it is drawn", () => {
  it("places each element at its own body's head, SIZED by that body's depth", () => {
    anchors = { [ALEX]: at(400, 300, 2), [MICAH]: at(900, 250, 0.5) };
    mount([
      { email: ALEX, displayName: "Alex", typing: true },
      { email: MICAH, displayName: "Micah", typing: true },
    ]);
    pumpFrame();
    const a = screen.getByTestId(`overhead-${ALEX}`);
    const m = screen.getByTestId(`overhead-${MICAH}`);
    expect(a.style.transform).toContain("translate(400px, 300px)");
    expect(m.style.transform).toContain("translate(900px, 250px)");
    expect(a.style.visibility).toBe("visible");
    // THE SIZE IS A FONT-SIZE, NEVER A scale(). A transform scale rasterises the pill once at 6px and
    // stretches the bitmap, which is what made these blurry — see the module header.
    expect(a.style.transform).not.toContain("scale");
    expect(parseFloat(a.style.fontSize)).toBeGreaterThan(parseFloat(m.style.fontSize));
  });

  it("clamps the type so it never collapses or swells past a nameplate", () => {
    anchors = { [ALEX]: at(400, 300, 0.01), [MICAH]: at(900, 250, 99) };
    mount([
      { email: ALEX, displayName: "Alex", typing: true },
      { email: MICAH, displayName: "Micah", typing: true },
    ]);
    pumpFrame();
    expect(parseFloat(screen.getByTestId(`overhead-${ALEX}`).style.fontSize)).toBeGreaterThanOrEqual(7);
    expect(parseFloat(screen.getByTestId(`overhead-${MICAH}`).style.fontSize)).toBeLessThanOrEqual(22);
  });

  it("rounds the translate to whole pixels so glyphs never straddle a device pixel", () => {
    anchors = { [ALEX]: at(400.4, 300.6, 2) };
    mount([{ email: ALEX, displayName: "Alex", typing: true }]);
    pumpFrame();
    expect(screen.getByTestId(`overhead-${ALEX}`).style.transform).toContain("translate(400px, 301px)");
  });

  it("anchors the viewer's OWN row to their avatar, not to a coworker body", () => {
    anchors = {};
    selfAnchorValue = at(700, 400, 3);
    mount([{ email: SELF_OVERHEAD_KEY, displayName: "You", status: { color: "#22C55E", shortName: "You" } }]);
    pumpFrame();
    const node = screen.getByTestId(`overhead-${SELF_OVERHEAD_KEY}`);
    expect(node.style.transform).toContain("translate(700px, 400px)");
    expect(screen.getByTestId(`overhead-status-${SELF_OVERHEAD_KEY}`).textContent).toContain("You");
    // self is never asked for through the coworker anchor path
    expect(askedFor[0]).toEqual([]);
  });

  it("FOLLOWS the body: a new frame moves the element, without React re-rendering it", () => {
    anchors = { [ALEX]: at(400, 300) };
    mount([{ email: ALEX, displayName: "Alex", typing: true }]);
    pumpFrame();
    const node = screen.getByTestId(`overhead-${ALEX}`);
    expect(node.style.transform).toContain("translate(400px, 300px)");
    anchors = { [ALEX]: at(655, 120) };
    pumpFrame();
    // the SAME element moved — not a remount, which would restart the entrance animation
    expect(screen.getByTestId(`overhead-${ALEX}`)).toBe(node);
    expect(node.style.transform).toContain("translate(655px, 120px)");
  });

  it("hides rather than unmounts a body that has gone off screen", () => {
    anchors = { [ALEX]: at(400, 300) };
    mount([{ email: ALEX, displayName: "Alex", typing: true }]);
    pumpFrame();
    const node = screen.getByTestId(`overhead-${ALEX}`);
    anchors = { [ALEX]: at(400, 300, 2, false) };
    pumpFrame();
    expect(node.style.visibility).toBe("hidden");
    expect(node.isConnected).toBe(true);
    anchors = { [ALEX]: at(410, 305) };
    pumpFrame();
    expect(node.style.visibility).toBe("visible");
  });

  it("asks the world for every body it is drawing over, in ONE call per frame", () => {
    anchors = { [ALEX]: at(1, 1), [MICAH]: at(2, 2) };
    mount([
      { email: ALEX, displayName: "Alex", typing: true },
      { email: MICAH, displayName: "Micah", typing: true },
    ]);
    pumpFrame();
    expect(askedFor).toHaveLength(1);
    expect(askedFor[0].sort()).toEqual([ALEX, MICAH]);
  });

  it("does not ask the world anything at all while nobody has an overhead", () => {
    mount([]);
    pumpFrame();
    expect(askedFor).toHaveLength(0);
  });
});

// ---- PHASE 7C — SETTINGS -> INTERFACE ------------------------------------------------------------
// The two switches remove elements; they never restyle one. What matters is that turning one off takes
// the element out of the DOM (a hidden unread badge is still a focusable button) and that turning the
// other off leaves the first one alone.
describe("the in-world display preferences", () => {
  const both: Vo3dOverhead[] = [
    { email: ALEX, displayName: "Alex", status: { color: "#4bb96a", shortName: "Available" } },
    { email: MICAH, displayName: "Micah", typing: true, unread: { conversationId: "c1", count: 2 } },
  ];

  beforeEach(() => {
    window.localStorage.clear();
    __resetExperiencePreferencesForTests();
  });

  it("draws everything by default", () => {
    render(<Vo3dOverheads worldRef={worldRef} ready overheads={both} onOpenConversation={onOpenConversation} />);
    expect(screen.getByTestId(`overhead-status-${ALEX}`)).toBeInTheDocument();
    expect(screen.getByTestId(`overhead-typing-${MICAH}`)).toBeInTheDocument();
    expect(screen.getByTestId(`overhead-unread-${MICAH}`)).toBeInTheDocument();
  });

  it("drops the nameplate — and the whole anchor with it — when nameplates are off", () => {
    act(() => setExperiencePreference("nameplates", false));
    render(<Vo3dOverheads worldRef={worldRef} ready overheads={both} onOpenConversation={onOpenConversation} />);
    expect(screen.queryByTestId(`overhead-status-${ALEX}`)).not.toBeInTheDocument();
    // Alex had nothing but a nameplate, so there is no longer anything to anchor for him.
    expect(screen.queryByTestId(`overhead-${ALEX}`)).not.toBeInTheDocument();
    // Chat is a separate switch and is untouched.
    expect(screen.getByTestId(`overhead-typing-${MICAH}`)).toBeInTheDocument();
    expect(screen.getByTestId(`overhead-unread-${MICAH}`)).toBeInTheDocument();
  });

  it("drops bubbles, dots and unread badges when overhead chat is off, keeping nameplates", () => {
    act(() => setExperiencePreference("worldChatIndicators", false));
    render(
      <Vo3dOverheads
        worldRef={worldRef}
        ready
        overheads={[...both, { email: "jan@offshorly.com", displayName: "Jan", sentText: "hello" }]}
        onOpenConversation={onOpenConversation}
      />,
    );
    expect(screen.getByTestId(`overhead-status-${ALEX}`)).toBeInTheDocument();
    expect(screen.queryByTestId(`overhead-typing-${MICAH}`)).not.toBeInTheDocument();
    expect(screen.queryByTestId(`overhead-unread-${MICAH}`)).not.toBeInTheDocument();
    expect(screen.queryByTestId("overhead-text-jan@offshorly.com")).not.toBeInTheDocument();
  });

  it("reacts to a switch flipped while the world is on screen", () => {
    render(<Vo3dOverheads worldRef={worldRef} ready overheads={both} onOpenConversation={onOpenConversation} />);
    expect(screen.getByTestId(`overhead-status-${ALEX}`)).toBeInTheDocument();
    act(() => setExperiencePreference("nameplates", false));
    expect(screen.queryByTestId(`overhead-status-${ALEX}`)).not.toBeInTheDocument();
  });
});

// PHASE 7D — A CALL CAMERA OVER THE RIGHT BODY.
//
// The association is the thing to pin: callStore keys videoByIdentity by the LiveKit identity, which is
// the lowercased email the bodies are already drawn under, so a track can only ever be rendered in the
// anchor of the person it belongs to. These also pin the two rules that differ from every other overhead
// — video is ADDITIVE rather than one-of-three, and neither display switch hides it.
describe("the call camera over a body", () => {
  /** A stand-in for a LiveKit camera track: the two methods the element actually calls. */
  const fakeTrack = () => {
    const t = {
      attached: [] as HTMLElement[],
      detached: [] as HTMLElement[],
      attach(el: HTMLElement) {
        t.attached.push(el);
        return el;
      },
      detach(el: HTMLElement) {
        t.detached.push(el);
        return el;
      },
    };
    return t;
  };

  beforeEach(() => {
    window.localStorage.clear();
    __resetExperiencePreferencesForTests();
  });

  it("renders the track inside THAT person's anchor and nobody else's", () => {
    const alexCam = fakeTrack();
    render(
      <Vo3dOverheads
        worldRef={worldRef}
        ready
        overheads={[
          { email: ALEX, displayName: "Alex", video: alexCam as never },
          { email: MICAH, displayName: "Micah", status: { color: "#4bb96a", shortName: "Micah" } },
        ]}
        onOpenConversation={onOpenConversation}
      />,
    );
    const tile = screen.getByTestId(`overhead-video-${ALEX}`);
    expect(screen.getByTestId(`overhead-${ALEX}`)).toContainElement(tile);
    expect(screen.queryByTestId(`overhead-video-${MICAH}`)).not.toBeInTheDocument();
    // The element is really wired to the track, not merely drawn.
    expect(alexCam.attached).toHaveLength(1);
  });

  it("gives somebody with ONLY a camera an anchor of their own", () => {
    render(
      <Vo3dOverheads
        worldRef={worldRef}
        ready
        overheads={[{ email: ALEX, displayName: "Alex", video: fakeTrack() as never }]}
        onOpenConversation={onOpenConversation}
      />,
    );
    expect(screen.getByTestId(`overhead-video-${ALEX}`)).toBeInTheDocument();
  });

  it("is ADDITIVE — a nameplate, a bubble or a badge still shows beneath it", () => {
    render(
      <Vo3dOverheads
        worldRef={worldRef}
        ready
        overheads={[
          {
            email: ALEX,
            displayName: "Alex",
            video: fakeTrack() as never,
            sentText: "on my way",
            unread: { conversationId: "c1", count: 1 },
          },
        ]}
        onOpenConversation={onOpenConversation}
      />,
    );
    expect(screen.getByTestId(`overhead-video-${ALEX}`)).toBeInTheDocument();
    expect(screen.getByTestId(`overhead-text-${ALEX}`)).toBeInTheDocument();
    expect(screen.getByTestId(`overhead-unread-${ALEX}`)).toBeInTheDocument();
  });

  it("detaches with ITS OWN element when the camera goes off, leaving other surfaces attached", () => {
    const cam = fakeTrack();
    const { rerender } = render(
      <Vo3dOverheads
        worldRef={worldRef}
        ready
        overheads={[{ email: ALEX, displayName: "Alex", video: cam as never }]}
        onOpenConversation={onOpenConversation}
      />,
    );
    const el = cam.attached[0];
    rerender(
      <Vo3dOverheads
        worldRef={worldRef}
        ready
        overheads={[{ email: ALEX, displayName: "Alex", status: { color: "#4bb96a", shortName: "Alex" } }]}
        onOpenConversation={onOpenConversation}
      />,
    );
    expect(screen.queryByTestId(`overhead-video-${ALEX}`)).not.toBeInTheDocument();
    // WITH the element, never the no-argument detach() that would rip the expanded CallOverlay's own
    // element off the same track.
    expect(cam.detached).toEqual([el]);
  });

  it("is not hidden by either in-world display switch — a camera is call media, not chrome", () => {
    act(() => {
      setExperiencePreference("nameplates", false);
      setExperiencePreference("worldChatIndicators", false);
    });
    render(
      <Vo3dOverheads
        worldRef={worldRef}
        ready
        overheads={[{ email: ALEX, displayName: "Alex", video: fakeTrack() as never, typing: true }]}
        onOpenConversation={onOpenConversation}
      />,
    );
    expect(screen.getByTestId(`overhead-video-${ALEX}`)).toBeInTheDocument();
    expect(screen.queryByTestId(`overhead-typing-${ALEX}`)).not.toBeInTheDocument();
  });
});

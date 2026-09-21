import { StrictMode } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Vo3dHost } from "./Vo3dHost";

// The real world builds a WebGL renderer, which jsdom has no context for — and the point of these tests
// is the HOST's lifecycle contract, not the world's. Every mount is recorded so the tests can assert on
// WHICH canvas each world was handed and whether it was disposed.
const mounts: { canvas: HTMLCanvasElement; dispose: ReturnType<typeof vi.fn> }[] = [];
// The host reaches its world through a dynamic `import()`, which resolves a tick or more after mount —
// and the first one in a run also pays for resolving the module. Both numbers are headroom over
// waitFor's 1s default and vitest's 5s per-test default, not an expectation of how long it takes.
const WORLD_IMPORT_TIMEOUT = 10000;
const TEST_TIMEOUT = 20000;
// Each test sets this to decide what createVo3dWorld does for that test.
let behaviour: "ok" | "throws" = "ok";

vi.mock("./world", async () => ({
  createVo3dWorld: (canvas: HTMLCanvasElement) => {
    if (behaviour === "throws") throw new Error("boom in createVo3dWorld");
    const dispose = vi.fn();
    mounts.push({ canvas, dispose });
    // Phase 4A: the world is a Vo3dWorld, and the host pushes the roster into it on creation.
    return { dispose, setCoworkers: vi.fn(), restoreSelf: vi.fn(() => false), setOfficeAccess: vi.fn(), setOccupiedSeats: vi.fn(), setCoworkerInteractions: vi.fn(), subscribeViewMode: () => () => {}, subscribePlayerView: () => () => {}, setViewMode: vi.fn(), setPlayerView: vi.fn(), devToolsVisible: () => false, setDevToolsVisible: vi.fn(), setConversationPoses: vi.fn(), setGlobalChatActive: vi.fn(), exitPlayerMode: vi.fn(), selectCoworkerByEmail: vi.fn(() => false), clearCoworkerSelection: vi.fn(), coworkerAnchor: vi.fn(() => null), approachCoworker: vi.fn(() => false), standUp: vi.fn() };
  },
}));

beforeEach(() => {
  mounts.length = 0;
  behaviour = "ok";
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Vo3dHost", () => {
  it("mounts one world on a canvas that is in the document", async () => {
    const { container } = render(<Vo3dHost />);
    await waitFor(() => expect(mounts).toHaveLength(1), { timeout: WORLD_IMPORT_TIMEOUT });

    expect(container.querySelectorAll("canvas")).toHaveLength(1);
    expect(mounts[0].canvas.isConnected).toBe(true);
    expect(mounts[0].canvas.parentElement).toBe(screen.getByTestId("vo3d-host"));
  }, TEST_TIMEOUT);

  it("disposes the world and removes the canvas on unmount", async () => {
    const { container, unmount } = render(<Vo3dHost />);
    await waitFor(() => expect(mounts).toHaveLength(1), { timeout: WORLD_IMPORT_TIMEOUT });
    const { canvas, dispose } = mounts[0];

    unmount();

    expect(dispose).toHaveBeenCalledTimes(1);
    expect(canvas.isConnected).toBe(false);
    expect(container.querySelectorAll("canvas")).toHaveLength(0);
  }, TEST_TIMEOUT);

  // THE core regression guard, in two halves.
  //
  // StrictMode (main.tsx wraps the whole app in it) runs effect -> cleanup -> effect on every dev mount.
  // Each run must build and own its OWN canvas: the first run's canvas is torn out by its cleanup, and
  // the world that does get built must sit on the second, untouched one — never on the first.
  it("gives each StrictMode effect run its own canvas and leaves exactly one alive", async () => {
    // Watching the DOM is the only way to see the canvas the first effect run created and threw away:
    // that run is cancelled (its import resolves after its cleanup) before it ever reaches the world.
    const added: HTMLCanvasElement[] = [];
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.addedNodes) {
          if (node instanceof HTMLCanvasElement) added.push(node);
        }
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });

    render(
      <StrictMode>
        <Vo3dHost />
      </StrictMode>,
    );
    await waitFor(() => expect(mounts).toHaveLength(1), { timeout: WORLD_IMPORT_TIMEOUT });
    observer.disconnect();

    expect(added).toHaveLength(2);
    expect(added[0]).not.toBe(added[1]);
    expect(added[0].isConnected).toBe(false); // the first run's canvas went out with its cleanup
    // The world was built on the SECOND canvas — one no disposed world has ever touched.
    expect(mounts[0].canvas).toBe(added[1]);
    expect(mounts[0].canvas.isConnected).toBe(true);
    expect(screen.getByTestId("vo3d-host").querySelectorAll("canvas")).toHaveLength(1);
  }, TEST_TIMEOUT);

  // The other half: a full unmount/remount, where BOTH runs get far enough to build a world. This is the
  // case render/Renderer.dispose()'s forceContextLoss() makes fatal if a canvas is ever reused.
  it("gives a remounted world a canvas no disposed world has used", async () => {
    const first = render(<Vo3dHost />);
    await waitFor(() => expect(mounts).toHaveLength(1), { timeout: WORLD_IMPORT_TIMEOUT });
    first.unmount();
    expect(mounts[0].dispose).toHaveBeenCalledTimes(1);

    render(<Vo3dHost />);
    await waitFor(() => expect(mounts).toHaveLength(2), { timeout: WORLD_IMPORT_TIMEOUT });

    expect(mounts[1].canvas).not.toBe(mounts[0].canvas);
    expect(mounts[0].canvas.isConnected).toBe(false);
    expect(mounts[1].canvas.isConnected).toBe(true);
  }, TEST_TIMEOUT);

  it("builds nothing when the component unmounts before the world module resolves", async () => {
    // The host appends its canvas synchronously and then AWAITS the module, so unmounting in the same
    // tick lands the cleanup between those two steps — the exact race the `cancelled` flag exists for.
    const { unmount } = render(<Vo3dHost />);
    unmount();
    // Give the pending import and any continuation of it a full macrotask to misbehave.
    await new Promise((r) => setTimeout(r, 0));

    expect(mounts).toHaveLength(0);
    expect(document.querySelectorAll("canvas")).toHaveLength(0);
  });

  it("shows the error state, not a crash, when the world throws while starting", async () => {
    behaviour = "throws";
    render(<Vo3dHost />);

    expect(await screen.findByText(/failed to start/i)).toBeInTheDocument();
    expect(screen.getByText(/boom in createVo3dWorld/)).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /back to v1/i })).toHaveLength(1);
    expect(mounts).toHaveLength(0);
  });

  it("shows a loading state before the world is ready and a way back once it is", async () => {
    render(<Vo3dHost />);
    expect(screen.getByRole("status")).toHaveTextContent(/loading/i);

    await waitFor(() => expect(mounts).toHaveLength(1), { timeout: WORLD_IMPORT_TIMEOUT });
    await waitFor(() => expect(screen.queryByRole("status")).toBeNull(), { timeout: WORLD_IMPORT_TIMEOUT });
    expect(screen.getByRole("button", { name: /back to v1/i })).toBeInTheDocument();
  }, TEST_TIMEOUT);

  it("tolerates a second cleanup pass (dispose is called at most once per world)", async () => {
    const { unmount } = render(<Vo3dHost />);
    await waitFor(() => expect(mounts).toHaveLength(1), { timeout: WORLD_IMPORT_TIMEOUT });
    unmount();
    unmount(); // React no-ops the second one; the assertion is that nothing double-disposes.
    expect(mounts[0].dispose).toHaveBeenCalledTimes(1);
  }, TEST_TIMEOUT);
});

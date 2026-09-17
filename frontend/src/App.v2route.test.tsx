import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The `?world=v2` switch is read ONCE at module scope (App.tsx), exactly like the chat-test route, so
// each case sets the URL and then imports a fresh copy of the module.
async function renderAppAt(search: string) {
  window.history.replaceState({}, "", `/${search}`);
  vi.resetModules();
  const { default: App } = await import("./App");
  return render(<App />);
}

// Stand-ins for the two trees under test. OfficeMap is mocked because mounting the real one boots the
// whole office; what matters here is only WHETHER it is rendered.
vi.mock("./components/OfficeMap/OfficeMap", () => ({
  OfficeMap: () => <div data-testid="v1-office" />,
}));
vi.mock("./components/LoadingCover/LoadingCover", () => ({
  LoadingCover: () => <div data-testid="v1-loading-cover" />,
}));
vi.mock("./audio/BackgroundMusicControl", () => ({
  BackgroundMusicControl: () => null,
}));
// getCurrentUserId is part of this module's surface too — Phase 2's identity resolver reads it, and the
// real one is a module singleton the mock must stand in for or the V2 route throws on mount.
vi.mock("./auth/useAuthGate", () => ({ useAuthGate: () => "allowed", getCurrentUserId: () => "bon" }));
vi.mock("./services/render/telemetry", () => ({ initDeviceTierTelemetry: () => {} }));

// The V2 world is mocked at the same seam Vo3dHost imports it from, so no WebGL is needed.
const disposes: (() => void)[] = [];
vi.mock("./dev/vo3d/app/world", () => ({
  createVo3dWorld: () => {
    const dispose = vi.fn();
    disposes.push(dispose);
    return { dispose };
  },
}));

beforeEach(() => {
  disposes.length = 0;
});

afterEach(() => {
  window.history.replaceState({}, "", "/");
});

describe("?world=v2 route", () => {
  it("renders V1's office by default", async () => {
    await renderAppAt("");
    expect(screen.getByTestId("v1-office")).toBeInTheDocument();
    expect(screen.queryByTestId("vo3d-host")).toBeNull();
  });

  it("renders the V2 host INSTEAD OF V1's office at ?world=v2", async () => {
    await renderAppAt("?world=v2");
    expect(await screen.findByTestId("vo3d-host")).toBeInTheDocument();
    expect(screen.queryByTestId("v1-office")).toBeNull();
    // LoadingCover waits on startup signals only OfficeMap publishes, so it must not be mounted either.
    expect(screen.queryByTestId("v1-loading-cover")).toBeNull();
  });

  it("ignores any other value of ?world", async () => {
    await renderAppAt("?world=v1");
    expect(screen.getByTestId("v1-office")).toBeInTheDocument();
    expect(screen.queryByTestId("vo3d-host")).toBeNull();
  });
});

// RENDERER ISOLATION, stated as the thing that is actually true rather than as a proxy for it: V1's WebGL
// context is a lazily-built module singleton (render3d/SharedRenderer.ts) constructed on the first
// renderToCanvas() call from a CharacterCanvas. In V2 mode no component that can make that call is
// mounted, so the singleton is never constructed — as opposed to being constructed and hidden.
describe("V1's shared renderer in V2 mode", () => {
  it("is never constructed", async () => {
    const shared = await import("./render3d/SharedRenderer");
    const spy = vi.spyOn(shared, "renderToCanvas");

    await renderAppAt("?world=v2");
    await screen.findByTestId("vo3d-host");
    await waitFor(() => expect(disposes).toHaveLength(1), { timeout: 5000 });

    expect(spy).not.toHaveBeenCalled();
    // Nothing that could reach the shared renderer is in the tree at all.
    expect(document.querySelector("[data-testid='v1-office']")).toBeNull();
    spy.mockRestore();
  });

  // PHASE 2 re-assertion. Reading V1's identity means the V2 route now imports V1 modules it did not
  // before (auth/currentUserStore, auth/useAuthGate, data/avatarIdentity). None of them touches WebGL —
  // only CharacterCanvas, ToucanFlyer and glbCache reach the shared renderer, and none is in this tree.
  // This case exists so that stays true the next time someone widens what identity reads.
  it("is still never constructed once a signed-in employee is resolved", async () => {
    const { setCurrentUserFromMeResponse, resetCurrentUserForTests } = await import(
      "./auth/currentUserStore"
    );
    setCurrentUserFromMeResponse({
      id: "atlas-1",
      email: "jerevon@offshorly.com",
      full_name: "Bon",
      role: "dev",
      team: null,
    });
    const shared = await import("./render3d/SharedRenderer");
    const spy = vi.spyOn(shared, "renderToCanvas");

    await renderAppAt("?world=v2");
    await screen.findByTestId("vo3d-host");
    await waitFor(() => expect(disposes).toHaveLength(1), { timeout: 5000 });

    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
    resetCurrentUserForTests();
  });
});

import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// PHASE 8 — the office is resolved ONCE PER MOUNT, after the auth gate opens (App.tsx): the `?world=`
// override first, then this employee's saved preference, then the default. Each case sets the URL and the
// stored preference and then imports a fresh copy of the module, so nothing carries between cases.
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

// PHASE 9A — THE SERVER'S CATALOG, mocked at the one seam App reads it through. Which offices an
// employee may open is a server answer now, so these cases have to state one; the default here is the
// two permanent offices with the 3D one as the company default, which is exactly what a real backend
// answers before anything has been published. `catalogAnswer` is reassigned per case for the ones that
// are ABOUT the catalog.
let catalogAnswer = {
  available: ["v2", "classic"],
  previewable: [] as string[],
  default: "v2",
  creator: false,
  publications: [],
  status: "ok",
};
vi.mock("./services/office/experienceCatalog", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./services/office/experienceCatalog")>();
  return { ...actual, fetchExperienceCatalog: async () => catalogAnswer };
});

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
  catalogAnswer = {
    available: ["v2", "classic"],
    previewable: [],
    default: "v2",
    creator: false,
    publications: [],
    status: "ok",
  };
});

afterEach(() => {
  window.history.replaceState({}, "", "/");
  window.localStorage.clear();
});

/** Write a saved preference for the employee the auth mock signs in — no identity is set in these cases,
 *  so the store's own key for "signed in but unidentified" is the one being written. */
const PREF_KEY = "vo:officeExperience:v1:anon";
function savePreference(value: "v2" | "classic"): void {
  window.localStorage.setItem(PREF_KEY, JSON.stringify(value));
}

describe("which office a URL opens", () => {
  it("renders the 3D office by default, with no parameter at all", async () => {
    await renderAppAt("");
    expect(await screen.findByTestId("vo3d-host")).toBeInTheDocument();
    expect(screen.queryByTestId("v1-office")).toBeNull();
    // NOTHING IS ASSERTED HERE ABOUT THE LOADING COVER, and that is a correction rather than a gap.
    // This case is about WHICH OFFICE A URL OPENS. The cover used to be asserted absent at this point,
    // which only held by accident of timing: the component is shared, Vo3dHost has booted under it
    // since Phase 8, and it lifts when the WORLD settles — which in this file means when the stubbed
    // world fails. Waiting on that made the case depend on an error path it is not about, and it
    // timed out under parallel load. The cover's actual lifetime is owned by
    // dev/vo3d/app/Vo3dHost.test.tsx, which asserts both that V2 boots under it and that it is gone
    // once the world reports failure.
  });

  it("renders Classic on a bare URL when that is the saved preference", async () => {
    savePreference("classic");
    await renderAppAt("");
    expect(await screen.findByTestId("v1-office")).toBeInTheDocument();
    expect(screen.queryByTestId("vo3d-host")).toBeNull();
  });

  it("survives a reload: the saved Classic preference is read again on a fresh mount", async () => {
    savePreference("classic");
    const first = await renderAppAt("");
    expect(await screen.findByTestId("v1-office")).toBeInTheDocument();
    first.unmount();
    await renderAppAt("");
    expect(await screen.findByTestId("v1-office")).toBeInTheDocument();
  });

  it("falls back to the 3D office when the saved value is not one the UI could have written", async () => {
    window.localStorage.setItem(PREF_KEY, JSON.stringify("nonsense"));
    await renderAppAt("");
    expect(await screen.findByTestId("vo3d-host")).toBeInTheDocument();
  });

  it("falls back to the 3D office when the stored payload is not even JSON", async () => {
    window.localStorage.setItem(PREF_KEY, "{oops");
    await renderAppAt("");
    expect(await screen.findByTestId("vo3d-host")).toBeInTheDocument();
  });

  // THE OVERRIDE BEATS THE PREFERENCE, in both directions. That is what makes `?world=` a support and QA
  // lever which needs no deploy and cannot be locked out by a bad saved value — including the case that
  // matters most, an employee whose saved 3D office will not start.
  it("?world=v1 opens Classic even when the preference says 3D", async () => {
    savePreference("v2");
    await renderAppAt("?world=v1");
    expect(await screen.findByTestId("v1-office")).toBeInTheDocument();
    expect(screen.queryByTestId("vo3d-host")).toBeNull();
  });

  it("?world=v2 opens the 3D office even when the preference says Classic", async () => {
    savePreference("classic");
    await renderAppAt("?world=v2");
    expect(await screen.findByTestId("vo3d-host")).toBeInTheDocument();
    expect(screen.queryByTestId("v1-office")).toBeNull();
  });

  it("treats any other value of ?world as no override at all and uses the preference", async () => {
    savePreference("classic");
    await renderAppAt("?world=banana");
    expect(await screen.findByTestId("v1-office")).toBeInTheDocument();
  });
});

// ══ PHASE 9A — WHAT AN EMPLOYEE CANNOT DO BY TYPING ══
//
// The allowed set is the SERVER's answer for this verified identity, and every step of resolution is
// intersected with it. A URL parameter and a localStorage key are both things an employee can type, so
// neither is trusted to name an office on its own. These cases are the proof: the season is never in
// `available`, and both routes to it land in the 3D office instead.
describe("an unpublished experience cannot be reached by tampering", () => {
  it("ignores ?world=halloween when the server did not list it", async () => {
    await renderAppAt("?world=halloween");
    const host = await screen.findByTestId("vo3d-host");
    expect(host).toBeInTheDocument();
    // The ordinary, undecorated office — not a season that happens to have no decorations yet.
    expect(host.dataset.season).toBe("none");
  });

  it("ignores a hand-edited saved preference naming an unpublished season", async () => {
    window.localStorage.setItem(PREF_KEY, JSON.stringify("christmas"));
    await renderAppAt("");
    expect((await screen.findByTestId("vo3d-host")).dataset.season).toBe("none");
  });

  it("does not ERASE the tampered preference — resolution filters, storage is left alone", async () => {
    // The same mechanism protects a LEGITIMATE saved season through an unpublish: the employee's
    // choice survives and comes back when the season does. Filtering at resolution rather than at
    // write time is what buys both properties at once.
    window.localStorage.setItem(PREF_KEY, JSON.stringify("christmas"));
    await renderAppAt("");
    await screen.findByTestId("vo3d-host");
    expect(window.localStorage.getItem(PREF_KEY)).toBe(JSON.stringify("christmas"));
  });

  it("opens a season once the server DOES list it, through the same two routes", async () => {
    catalogAnswer = {
      available: ["v2", "classic", "halloween"],
      previewable: [],
      default: "v2",
      creator: false,
      publications: [],
      status: "ok",
    };
    window.localStorage.setItem(PREF_KEY, JSON.stringify("halloween"));
    const saved = await renderAppAt("");
    expect((await screen.findByTestId("vo3d-host")).dataset.season).toBe("halloween");
    saved.unmount();

    window.localStorage.clear();
    await renderAppAt("?world=halloween");
    expect((await screen.findByTestId("vo3d-host")).dataset.season).toBe("halloween");
  });

  it("mounts the SAME V2 world for a season — there is no second world implementation", async () => {
    catalogAnswer = {
      available: ["v2", "classic", "halloween"],
      previewable: [],
      default: "halloween",
      creator: false,
      publications: [],
      status: "ok",
    };
    await renderAppAt("");
    expect(await screen.findByTestId("vo3d-host")).toBeInTheDocument();
    expect(screen.queryByTestId("v1-office")).toBeNull();
  });
});

describe("the company default", () => {
  it("opens for an employee who has never chosen", async () => {
    catalogAnswer = { ...catalogAnswer, default: "classic" };
    await renderAppAt("");
    expect(await screen.findByTestId("v1-office")).toBeInTheDocument();
  });

  it("does NOT override an employee's own explicit choice", async () => {
    catalogAnswer = { ...catalogAnswer, default: "classic" };
    savePreference("v2");
    await renderAppAt("");
    expect(await screen.findByTestId("vo3d-host")).toBeInTheDocument();
  });

  it("falls back to the 3D office when the default names something unavailable", async () => {
    catalogAnswer = { ...catalogAnswer, available: ["v2", "classic"], default: "halloween" };
    await renderAppAt("");
    expect(await screen.findByTestId("vo3d-host")).toBeInTheDocument();
  });
});

describe("a catalog that cannot be read", () => {
  it("still opens the office, on the permanent offices only", async () => {
    catalogAnswer = {
      available: ["v2", "classic"],
      previewable: [],
      default: "v2",
      creator: false,
      publications: [],
      status: "unavailable",
    };
    savePreference("classic");
    await renderAppAt("");
    // The saved Classic preference is a PERMANENT office, so an outage does not disturb it at all.
    expect(await screen.findByTestId("v1-office")).toBeInTheDocument();
  });

  it("never overwrites a saved seasonal preference while the backend is unreachable", async () => {
    catalogAnswer = {
      available: ["v2", "classic"],
      previewable: [],
      default: "v2",
      creator: false,
      publications: [],
      status: "unavailable",
    };
    window.localStorage.setItem(PREF_KEY, JSON.stringify("halloween"));
    await renderAppAt("");
    // This load is the 3D office, because nothing could confirm the season is available...
    expect(await screen.findByTestId("vo3d-host")).toBeInTheDocument();
    // ...but the employee's choice is untouched, so the next successful load honours it again.
    expect(window.localStorage.getItem(PREF_KEY)).toBe(JSON.stringify("halloween"));
  });
});

// WHERE A SETTINGS SWITCH NAVIGATES. The override is dropped in BOTH directions — saving "3D Office"
// while `?world=v1` is still in the URL would save one office and open the other — and nothing else about
// the URL is touched, so an existing deep link keeps whatever it was carrying.
describe("the URL a Settings switch navigates to", () => {
  it("drops an existing world override and keeps every other parameter", async () => {
    const { switchUrl } = await import("./services/settings/officeExperience");
    expect(switchUrl("https://x.test/virtual-office/?world=v1&room=dev&tab=2")).toBe(
      "https://x.test/virtual-office/?room=dev&tab=2",
    );
    expect(switchUrl("https://x.test/virtual-office/?world=v2")).toBe("https://x.test/virtual-office/");
    // Nothing to drop is not a special case, and a fragment is not a parameter.
    expect(switchUrl("https://x.test/virtual-office/?deep=link#frag")).toBe(
      "https://x.test/virtual-office/?deep=link#frag",
    );
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

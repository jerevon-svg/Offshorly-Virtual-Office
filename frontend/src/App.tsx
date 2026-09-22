import { useEffect, useRef, useState } from "react";
import { OfficeMap } from "./components/OfficeMap/OfficeMap";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { useAuthGate } from "./auth/useAuthGate";
import { BackgroundMusicControl } from "./audio/BackgroundMusicControl";
import { ChatTestPage } from "./pages/ChatTestPage";
import { Vo3dHost } from "./dev/vo3d/app/Vo3dHost";
import { initDeviceTierTelemetry } from "./services/render/telemetry";
import { LoadingCover } from "./components/LoadingCover/LoadingCover";
import { setStartupSignal } from "./startup/startupReadiness";
import { resolveOfficeExperience } from "./services/settings/officeExperience";
import { allowedExperiences } from "./services/office/experienceCatalog";
import { loadExperienceCatalog } from "./services/office/experienceCatalogStore";
import { applyExperienceTheme, clearExperienceTheme } from "./services/settings/experienceTheme";
import "./styles/halloweenTheme.css";
import "./styles/christmasTheme.css";

// DEV-ONLY chat test harness entry point (see src/pages/ChatTestPage.tsx).
// `import.meta.env.DEV` is Vite's build-time flag — false in every built/
// production bundle, so this whole branch (and the ChatTestPage import
// above) is dead code eliminated from `vite build`, not just hidden behind
// a runtime check. The `?chatTest=1` query param is only meaningful in a
// `vite dev` session.
const isChatTestRoute =
  import.meta.env.DEV && new URLSearchParams(window.location.search).has("chatTest");

// PHASE 8 — THE V2 WORLD IS NO LONGER A DEV ROUTE. It used to be `import.meta.env.DEV && ?world=v2`,
// which folded to false in every build, so V2 did not exist in a production bundle at all. It is now the
// DEFAULT office, chosen by services/settings/officeExperience, and Classic (V1) is the alternative.
//
// THE COST OF DROPPING THE DEV GUARD IS ONE MODULE, NOT THE WORLD. Vo3dHost is now bundled, but the 3D
// world itself is still reached ONLY through Vo3dHost's dynamic `import("./world")` — so a Classic
// session still never fetches it, exactly as a V1 dev page never did.
//
// The chat-test route above keeps its DEV guard; nothing about it changed.

// Split out so the dev-test route (below) never calls useAuthGate at all —
// calling it conditionally from a single App() body would violate the
// Rules of Hooks, and unconditionally would fire a real Atlas /auth/me
// call (and possible login redirect) on a page that's meant to work
// without any Atlas session.
function OfficeApp() {
  const status = useAuthGate();

  // WHICH OFFICE, RESOLVED ONCE, AFTER AUTHENTICATION AND AFTER THE SERVER'S CATALOG, THEN HELD.
  //
  // AFTER AUTHENTICATION because the preference is keyed per employee: asked before /auth/me lands it
  // would read "anon" and open the wrong person's office. The gate below already renders a cover until
  // `status` leaves "pending", so the first render that can reach this line is one where the identity is
  // known.
  //
  // AFTER THE CATALOG (Phase 9A) because which offices this employee MAY open is a server answer now,
  // not a constant — a season can be published, unpublished, or private to a Creator. Resolving before
  // it landed would mean either ignoring it (and letting a typed `?world=halloween` or a hand-edited
  // storage key decide) or guessing. So the boot cover is held for one request. It is the same cover
  // the office already boots under, it is on the path that was already waiting for /auth/me, and the
  // read NEVER REJECTS: a backend that is down, slow or pre-migration answers as the two permanent
  // offices and the cover lifts anyway. Nobody is locked out by it and nobody's saved preference is
  // written by it.
  //
  // HELD because the office must never change under a signed-in session. This is deliberately a ref
  // filled during render rather than a subscription: if it re-read the store live, a change written in
  // ANOTHER TAB — or a company default a Creator moved — would swap this tab's whole office out from
  // under an open call. Switching is an explicit, confirmed navigation — see
  // components/OfficeMap/OfficeExperiencePanel.tsx — and this is the value the next document reads on
  // its way up.
  //
  // The assignment is idempotent and touches nothing outside this component, so it is safe under
  // StrictMode's double render: the second pass finds it already set.
  const [catalog, setCatalog] = useState<Awaited<ReturnType<typeof loadExperienceCatalog>> | null>(null);
  useEffect(() => {
    if (status !== "allowed") return;
    let live = true;
    void loadExperienceCatalog().then((answer) => {
      // LIFECYCLE: the gate can close (a 401 mid-flight redirects to login) while this is in the air.
      if (live) setCatalog(answer);
    });
    return () => {
      live = false;
    };
  }, [status]);

  const experienceRef = useRef<ReturnType<typeof resolveOfficeExperience> | null>(null);
  if (status === "allowed" && catalog !== null && experienceRef.current === null) {
    experienceRef.current = resolveOfficeExperience(
      window.location.search,
      allowedExperiences(catalog),
      catalog.default,
    );
  }

  // Phase B device-tier telemetry: fires once, after mount, purely to
  // measure/log capability signals for later per-tier capping. Runs in a
  // post-render effect so it never blocks first paint, and never touches
  // rendering/UI — see services/render/telemetry.ts.
  useEffect(() => {
    initDeviceTierTelemetry();
  }, []);

  // DRESS THE INTERFACE FOR THE RESOLVED EXPERIENCE. One attribute on <html>; the skin is a
  // stylesheet scoped to it — one per season (styles/halloweenTheme.css, styles/christmasTheme.css) —
  // so the ordinary 3D office and Classic are never styled and switching away cannot leak. Runs
  // after the office is resolved, and undresses on
  // unmount so a remount never inherits the previous experience's chrome.
  useEffect(() => {
    applyExperienceTheme(experienceRef.current);
    return clearExperienceTheme;
  }, [catalog]);

  // Boot cover readiness: the auth gate opening is the first critical
  // startup signal (startup/startupReadiness.ts); OfficeMap publishes the
  // rest once it mounts underneath the cover.
  useEffect(() => {
    setStartupSignal("auth", status === "allowed");
  }, [status]);

  if (status === "pending") {
    // Same cover the office boots under — no bare "Loading…" flash.
    return <LoadingCover />;
  }

  if (status === "denied" || status === "unauthenticated") {
    // useAuthGate already redirects (to HOME_PATH or LOGIN_PATH
    // respectively); render nothing while that happens.
    return null;
  }

  // THE 3D OFFICE, WHICH IS NOW THE DEFAULT. Deliberately placed AFTER the auth gate (so V2 is reached
  // with exactly the same session guarantees V1 has) and INSTEAD OF the whole V1 tree rather than inside
  // it. The second part is the
  // renderer-isolation requirement, not a layout choice: V1's WebGL context is the lazily-built module
  // singleton in render3d/SharedRenderer.ts, shared by every CharacterCanvas under OfficeStage,
  // ProfileCharacter and ToucanFlyer, and it has no production teardown. Not RENDERING OfficeMap is what
  // keeps that singleton from ever being constructed; hiding it with CSS would not. LoadingCover is
  // omitted for the same class of reason — it waits on startup signals only OfficeMap publishes
  // (startup/startupReadiness.ts), so it would hang over V2 forever.
  // THE CATALOG HAS NOT LANDED YET. The same cover, for the same reason: this is still boot, and the
  // one question left to answer is which office to build. It cannot hang — the read resolves to the
  // permanent offices on any failure — so there is no timeout, no retry and no error branch here.
  if (experienceRef.current === null) {
    return <LoadingCover />;
  }

  // Every seasonal experience is the SAME V2 WORLD with a decorative layer over it, so anything that
  // is not the Classic office is the 3D one. There is no second world implementation and no branch
  // per season: `v2`, `halloween` and `christmas` all mount exactly this tree.
  if (experienceRef.current !== "classic") {
    return (
      <ErrorBoundary>
        <Vo3dHost experience={experienceRef.current} />
        {/* PHASE 7C — THE SAME hidden instance V1 gets below, for the same one reason: armAutoplay().
            Without it the V2 route never armed the music singleton at all, so Settings -> Audio could
            move the stored volume while nothing was ever playing — a control that looked live and was
            not. It is the SAME singleton (audio/backgroundMusic.ts), not a second player. */}
        <BackgroundMusicControl hidden />
      </ErrorBoundary>
    );
  }

  return (
    <ErrorBoundary>
      <OfficeMap />
      {/* Mounted but hidden: the visible music control now lives in the dock's Settings flyout
          (components/OfficeMap/HudSettings.tsx). This instance stays here purely for its
          armAutoplay() effect, so playback is still armed on the first user gesture anywhere in
          the office rather than only once somebody opens Settings. Both instances read and write
          the same singleton store (audio/backgroundMusic.ts). */}
      <BackgroundMusicControl hidden />
      <LoadingCover />
    </ErrorBoundary>
  );
}

function App() {
  if (isChatTestRoute) {
    return <ChatTestPage />;
  }
  return <OfficeApp />;
}

export default App;

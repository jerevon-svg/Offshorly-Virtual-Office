import { useEffect } from "react";
import { OfficeMap } from "./components/OfficeMap/OfficeMap";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { useAuthGate } from "./auth/useAuthGate";
import { BackgroundMusicControl } from "./audio/BackgroundMusicControl";
import { ChatTestPage } from "./pages/ChatTestPage";
import { Vo3dHost } from "./dev/vo3d/app/Vo3dHost";
import { initDeviceTierTelemetry } from "./services/render/telemetry";
import { LoadingCover } from "./components/LoadingCover/LoadingCover";
import { setStartupSignal } from "./startup/startupReadiness";

// DEV-ONLY chat test harness entry point (see src/pages/ChatTestPage.tsx).
// `import.meta.env.DEV` is Vite's build-time flag — false in every built/
// production bundle, so this whole branch (and the ChatTestPage import
// above) is dead code eliminated from `vite build`, not just hidden behind
// a runtime check. The `?chatTest=1` query param is only meaningful in a
// `vite dev` session.
const isChatTestRoute =
  import.meta.env.DEV && new URLSearchParams(window.location.search).has("chatTest");

// DEV-ONLY V2 world route (V1 <-> V2 integration, Phase 1). Same build-time contract as the chat-test
// route above: `import.meta.env.DEV` is statically false in `vite build`, so this constant folds to
// false, the branch below becomes unreachable, and the Vo3dHost import (and with it the entire
// dev/vo3d world, which is only ever reached through Vo3dHost's dynamic import) is dropped from the
// production bundle. `?world=v2` is only meaningful in a `vite dev` session.
const isV2WorldRoute =
  import.meta.env.DEV && new URLSearchParams(window.location.search).get("world") === "v2";

// Split out so the dev-test route (below) never calls useAuthGate at all —
// calling it conditionally from a single App() body would violate the
// Rules of Hooks, and unconditionally would fire a real Atlas /auth/me
// call (and possible login redirect) on a page that's meant to work
// without any Atlas session.
function OfficeApp() {
  const status = useAuthGate();

  // Phase B device-tier telemetry: fires once, after mount, purely to
  // measure/log capability signals for later per-tier capping. Runs in a
  // post-render effect so it never blocks first paint, and never touches
  // rendering/UI — see services/render/telemetry.ts.
  useEffect(() => {
    initDeviceTierTelemetry();
  }, []);

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

  // V2 PREVIEW. Deliberately placed AFTER the auth gate (so V2 is reached with exactly the same session
  // guarantees V1 has) and INSTEAD OF the whole V1 tree rather than inside it. The second part is the
  // renderer-isolation requirement, not a layout choice: V1's WebGL context is the lazily-built module
  // singleton in render3d/SharedRenderer.ts, shared by every CharacterCanvas under OfficeStage,
  // ProfileCharacter and ToucanFlyer, and it has no production teardown. Not RENDERING OfficeMap is what
  // keeps that singleton from ever being constructed; hiding it with CSS would not. LoadingCover is
  // omitted for the same class of reason — it waits on startup signals only OfficeMap publishes
  // (startup/startupReadiness.ts), so it would hang over V2 forever.
  if (isV2WorldRoute) {
    return (
      <ErrorBoundary>
        <Vo3dHost />
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

import { useEffect } from "react";
import { OfficeMap } from "./components/OfficeMap/OfficeMap";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { useAuthGate } from "./auth/useAuthGate";
import { BackgroundMusicControl } from "./audio/BackgroundMusicControl";
import { ChatTestPage } from "./pages/ChatTestPage";
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

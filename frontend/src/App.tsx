import { OfficeMap } from "./components/OfficeMap/OfficeMap";
import { useAuthGate } from "./auth/useAuthGate";
import { BackgroundMusicControl } from "./audio/BackgroundMusicControl";
import { ChatTestPage } from "./pages/ChatTestPage";

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

  if (status === "pending") {
    return <div>Loading…</div>;
  }

  if (status === "denied" || status === "unauthenticated") {
    // useAuthGate already redirects (to HOME_PATH or LOGIN_PATH
    // respectively); render nothing while that happens.
    return null;
  }

  return (
    <>
      <OfficeMap />
      <BackgroundMusicControl />
    </>
  );
}

function App() {
  if (isChatTestRoute) {
    return <ChatTestPage />;
  }
  return <OfficeApp />;
}

export default App;

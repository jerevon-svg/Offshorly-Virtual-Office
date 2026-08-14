import { OfficeMap } from "./components/OfficeMap/OfficeMap";
import { useAuthGate } from "./auth/useAuthGate";
import { BackgroundMusicControl } from "./audio/BackgroundMusicControl";

function App() {
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

export default App;

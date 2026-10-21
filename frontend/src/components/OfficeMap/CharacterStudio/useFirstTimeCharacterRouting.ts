import { useEffect, useState } from "react";
import { avatarIdForEmail } from "../../../data/avatarIdentity";
import { hasHumanBody } from "../../../dev/vo3d/avatar/humanBody";
import { isLive3dEligible } from "../../../render3d/live3dCharacters";
import { characterStudioAvailable, getCharacterStatus } from "../../../services/humanbase/characterStudio";
import { deriveStartupProgress, useStartupSignals } from "../../../startup/startupReadiness";
import { LOADING_COVER_MAX_WAIT_MS } from "../../LoadingCover/LoadingCover";

/** the loading cover's fade-out (LoadingCover FADE_OUT_MS) plus a beat — the panel opens once the office is actually visible */
const AFTER_COVER_MS = 700;

// FIRST-TIME ROUTING (DEV-ONLY until validated) — someone who arrives in the office with no character at all (no live-3D model,
// no HumanBase body, nothing approved in HumanBase Studio) is taken to their own Profile, whose character panel opens in CREATE.
// Once per session (closing the profile is respected), only for the signed-in person, and only when the Studio confirms that this
// session IS that person. Anything else — a production build, the Studio not running, a character already there — does nothing.
// It waits for the loading cover to lift (the startup readiness it reads, or its safety cap), so the reveal is never played unseen.
export function useFirstTimeCharacterRouting(self: string | null | undefined, ready: boolean, openProfile: (email: string) => void): void {
  const startupReady = deriveStartupProgress(useStartupSignals()).ready;
  const [capped, setCapped] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setCapped(true), LOADING_COVER_MAX_WAIT_MS + AFTER_COVER_MS);
    return () => clearTimeout(t);
  }, []);
  const officeVisible = ready && (startupReady || capped);

  useEffect(() => {
    if (!officeVisible || !self || !characterStudioAvailable()) return;
    const id = avatarIdForEmail(self);
    if (isLive3dEligible(id) || hasHumanBody(id)) return;
    const key = `vo.characterStudio.routed:${self.trim().toLowerCase()}`;
    try {
      if (sessionStorage.getItem(key)) return;
    } catch {
      /* storage unavailable: route at most once per load */
    }
    let off = false;
    let timer = 0;
    getCharacterStatus()
      .then((s) => {
        if (off || s.email.toLowerCase() !== self.trim().toLowerCase() || s.approvedAvatar) return;
        timer = window.setTimeout(() => {
          try {
            sessionStorage.setItem(key, "1");
          } catch {
            /* best effort */
          }
          openProfile(self);
        }, AFTER_COVER_MS);
      })
      .catch(() => {
        /* the Studio is not running or the session is not verified: no routing */
      });
    return () => {
      off = true;
      window.clearTimeout(timer);
    };
  }, [self, officeVisible, openProfile]);
}

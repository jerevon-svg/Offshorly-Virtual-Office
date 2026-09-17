// vo3d app — THE REACT HOST. The counterpart to bootstrap.ts: that file mounts the V2 world on a page
// it owns forever, this one mounts the SAME world inside V1's React tree, where it can be unmounted.
//
// Reached only through V1's DEV-only `?world=v2` route (see App.tsx). Still a FULLSCREEN technical
// preview: no V1 HUD, chat, movement or attendance is mounted alongside it.
//
// Phase 2 adds exactly ONE thing to that list — READ-ONLY IDENTITY. This component resolves the employee
// V1 has already signed in (adapters/v1Identity) and hands the world their own 3D character. It is a
// read and nothing else: no fetch, no store, no subscription, no write back. Movement sync, attendance,
// status and multiplayer remain deferred, and V2 still makes no API call of its own — which is what
// keeps apiFetch's 401 -> /login redirect off this route entirely.
import { useEffect, useRef, useState } from "react";
import { resolveVo3dIdentity } from "../adapters/v1Identity";
import type { Vo3dIdentity } from "./identity";
import type { Vo3dWorld } from "./world";

// WHY THE CANVAS IS NOT JSX. Three separate reasons, all load-bearing:
//
//  1. render/Renderer.dispose() calls forceContextLoss() — a disposed world's canvas is DEAD and cannot
//     be given to a second createVo3dWorld(). React would hand back the same element on a remount.
//  2. <StrictMode> (main.tsx) deliberately double-invokes effects in dev: mount -> cleanup -> mount. That
//     is exactly the remount case in 1., on every single mount, so a JSX canvas would be broken always
//     rather than occasionally.
//  3. Renderer sizes itself from window.innerWidth/innerHeight and writes inline px onto the canvas
//     (render/Renderer.resize), so the element must fill the window; it is not a React-laid-out box.
//
// Creating it here, inside the effect, means every effect run owns a canvas nothing else has ever
// touched, and the cleanup that disposes the world takes that canvas out of the document with it.
function makeCanvas(): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.style.display = "block";
  canvas.style.width = "100vw";
  canvas.style.height = "100vh";
  return canvas;
}

// The world module is ~200KB of source plus the three.js addon graph, and it is reached ONLY through
// this dynamic import — so a normal V1 dev page load never fetches it, and `vite build` can drop it along
// with this whole DEV-only component (App.tsx's isV2WorldRoute is statically false in a build).
//
// Memoised because the mount that needs it can happen several times per session — StrictMode alone makes
// it twice per page load — and the module is a fetch-once, evaluate-once thing in every one of them. Each
// mount attaches its own continuation to the one promise rather than issuing its own import.
let worldModule: Promise<typeof import("./world")> | null = null;
function loadWorld(): Promise<typeof import("./world")> {
  worldModule ??= import("./world");
  return worldModule;
}

type Phase =
  | { kind: "loading" }
  | { kind: "ready"; identity: Vo3dIdentity | null }
  | { kind: "error"; message: string };

/** Drop `?world=v2` and reload into the normal V1 office. A plain location assignment rather than a
 *  router navigation: V2 has scattered listeners and GPU state across window, document and document.body,
 *  and a full document teardown is the one teardown that cannot leave anything behind. */
function backToV1(): void {
  const url = new URL(window.location.href);
  url.searchParams.delete("world");
  window.location.href = url.toString();
}

export function Vo3dHost() {
  const hostRef = useRef<HTMLDivElement>(null);
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const canvas = makeCanvas();
    host.appendChild(canvas);

    let world: Vo3dWorld | null = null;
    let cancelled = false;

    // RESOLVED HERE, PER MOUNT, and never hoisted to module scope. Two reasons: App.tsx renders this
    // component only after useAuthGate reaches "allowed", so inside the effect the answer is already
    // known and synchronous — there is no loading state to model; and StrictMode's mount -> cleanup ->
    // mount re-runs this effect, which must re-read rather than reuse a value captured at import time.
    // `null` is a legitimate answer (V1 could not parse an identity) and is passed through as "no
    // identity" — NOT as a guess that this is Bon.
    const identity = resolveVo3dIdentity();

    void loadWorld()
      .then(({ createVo3dWorld }) => {
        // The unmount may have already run — StrictMode's cleanup fires within the same tick that this
        // import was started in. Building a world now would be building one nobody will ever dispose.
        if (cancelled) return;
        world = createVo3dWorld(canvas, identity ?? undefined);
        setPhase({ kind: "ready", identity });
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        // A failure in here is a failure of the PREVIEW, not of V1: the boundary in App.tsx would blank
        // the page, so the error is caught and rendered as a way back instead.
        console.error("Vo3dHost: failed to mount the V2 world", e);
        setPhase({ kind: "error", message: e instanceof Error ? e.message : String(e) });
      });

    return () => {
      cancelled = true;
      // Idempotent by construction: this cleanup runs once per effect run, and Vo3dWorld.dispose() is
      // itself guarded (app/world.ts), so a double call is a no-op rather than a teardown of a dead world.
      world?.dispose();
      world = null;
      canvas.remove();
    };
  }, []);

  return (
    <div
      ref={hostRef}
      data-testid="vo3d-host"
      style={{ position: "fixed", inset: 0, overflow: "hidden", background: "#e7ded4" }}
    >
      {phase.kind !== "ready" && (
        <div
          role="status"
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 12,
            color: "#5b5048",
            font: "14px/1.5 system-ui, sans-serif",
            textAlign: "center",
            padding: 24,
          }}
        >
          {phase.kind === "loading" ? (
            <span>Loading VO 3D V2…</span>
          ) : (
            <>
              <span>VO 3D V2 failed to start.</span>
              <span style={{ opacity: 0.7, maxWidth: 520 }}>{phase.message}</span>
            </>
          )}
          <button type="button" onClick={backToV1} style={{ font: "inherit", padding: "6px 12px" }}>
            Back to V1
          </button>
        </div>
      )}
      {phase.kind === "ready" && phase.identity && (
        // THE REDACTED READOUT. Deliberately carries the display name, the resolved character id and
        // where the identity came from — and NOTHING else. No email, no employee id, no token, nothing
        // derived from the session. It exists so a real signed-in session can be verified from the
        // outside (including by an automated check) without anything sensitive being on screen.
        <div
          data-testid="vo3d-identity"
          data-display-name={phase.identity.displayName}
          data-avatar-id={phase.identity.avatarId ?? ""}
          data-avatar-missing={phase.identity.avatarId === null ? "true" : "false"}
          data-source={phase.identity.source}
          style={{
            position: "absolute",
            top: 12,
            right: 12,
            zIndex: 1003,
            font: "12px/1.4 system-ui, sans-serif",
            padding: "6px 10px",
            borderRadius: 8,
            background: "rgba(30,24,20,0.72)",
            color: "#f4ede4",
            pointerEvents: "none",
          }}
        >
          {phase.identity.displayName}
          <span style={{ opacity: 0.7 }}>
            {" · "}
            {phase.identity.avatarId ?? "no 3D avatar"}
          </span>
        </div>
      )}
      {phase.kind === "ready" && phase.identity?.avatarId === null && (
        // The explicit missing-avatar state. It says the character is absent, names the person it is
        // absent FOR, and offers nothing that looks like a retry — there is no asset to fetch. The one
        // thing it must never do is imply the empty world is somebody else's body.
        <div
          role="status"
          data-testid="vo3d-missing-avatar"
          style={{
            position: "absolute",
            bottom: 16,
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 1003,
            maxWidth: 520,
            textAlign: "center",
            font: "12px/1.5 system-ui, sans-serif",
            padding: "8px 14px",
            borderRadius: 8,
            background: "rgba(30,24,20,0.82)",
            color: "#f4ede4",
          }}
        >
          No 3D avatar is registered for {phase.identity.displayName} yet, so no character is shown. The
          world is fully explorable.
        </div>
      )}
      {phase.kind === "ready" && (
        // TOP-CENTRE, above everything. V2's world claims three corners of the window with panels it
        // parks on document.body — the bench readout top-left (devtools/Bench.ts, z-index 10), the
        // editor panel bottom-left (editor/EditorPanel.ts, z-index 1002) and lil-gui down the whole
        // right edge (z-index 1001) — and the one way out of the preview must not sit under any of them.
        <button
          type="button"
          onClick={backToV1}
          style={{
            position: "absolute",
            top: 12,
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 1003,
            font: "12px/1.4 system-ui, sans-serif",
            padding: "6px 10px",
            borderRadius: 8,
            border: "none",
            cursor: "pointer",
            background: "rgba(30,24,20,0.72)",
            color: "#f4ede4",
          }}
        >
          Back to V1
        </button>
      )}
    </div>
  );
}

import { useState } from "react";
import { ConversationView } from "../components/Chat/ConversationView";
import { chatMode, realChatService } from "../services/chat";
import type { AssetLayer } from "../types/office";

// DEV-ONLY test harness for Phase 3 real chat (backend/, Socket.IO +
// Postgres + Atlas-JWT auth). Lets Bon validate live message delivery
// across two browser profiles/tabs WITHOUT real Atlas logins, by using the
// backend's dev-only `x-dev-email` bypass (backend/src/http.ts
// `devEmailFrom` / backend/src/socket.ts `devEmailFromHandshake`, both
// hard-gated server-side to NODE_ENV !== "production").
//
// Reached only via `?chatTest=1` AND only when import.meta.env.DEV is true
// (see the guard in App.tsx) — Vite strips DEV-only code paths from a
// production build, so this page cannot exist in a deployed bundle.
//
// Deliberately bypasses the real office/roster identity-resolution logic
// (OfficeMap.tsx's resolvePeerChatId/selfChatId) — this is throwaway
// scaffolding, not a real chat entry point.

export function ChatTestPage() {
  const [yourEmail, setYourEmail] = useState("tester1@local.test");
  const [peerEmail, setPeerEmail] = useState("tester2@local.test");
  const [active, setActive] = useState<{ self: string; peer: string } | null>(null);

  function handleStart() {
    const self = yourEmail.trim().toLowerCase();
    const peer = peerEmail.trim().toLowerCase();
    if (!self || !peer) return;
    realChatService.setDevIdentity(self);
    setActive({ self, peer });
  }

  function handleReset() {
    realChatService.setDevIdentity(null);
    setActive(null);
  }

  const peerLayer: AssetLayer = active
    ? {
        id: active.peer,
        kind: "character",
        path: "",
        x: 0,
        y: 0,
        width: 0,
        height: 0,
        transform: null,
        name: active.peer,
      }
    : ({} as AssetLayer);

  return (
    <div style={{ padding: 24, fontFamily: "monospace", maxWidth: 480 }}>
      <h2>Chat dev test harness</h2>
      <p style={{ color: "#a00" }}>
        DEV-ONLY. Uses the backend's <code>x-dev-email</code> bypass — never available in a
        production build.
      </p>
      {chatMode !== "real" && (
        <p style={{ color: "#a00" }}>
          VITE_CHAT_MODE is not "real" — set VITE_CHAT_MODE=real and VITE_CHAT_SOCKET_URL, then
          restart the dev server.
        </p>
      )}

      {!active ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <label>
            Your email
            <input
              style={{ display: "block", width: "100%" }}
              value={yourEmail}
              onChange={(e) => setYourEmail(e.target.value)}
            />
          </label>
          <label>
            Peer email
            <input
              style={{ display: "block", width: "100%" }}
              value={peerEmail}
              onChange={(e) => setPeerEmail(e.target.value)}
            />
          </label>
          <button type="button" onClick={handleStart}>
            Start chat
          </button>
        </div>
      ) : (
        <div>
          <p>
            Connected as <strong>{active.self}</strong> — chatting with{" "}
            <strong>{active.peer}</strong>
          </p>
          <button type="button" onClick={handleReset}>
            Reset
          </button>
          <ConversationView
            peer={peerLayer}
            selfId={active.self}
            peerChatId={active.peer}
            onClose={handleReset}
          />
        </div>
      )}
    </div>
  );
}

export default ChatTestPage;

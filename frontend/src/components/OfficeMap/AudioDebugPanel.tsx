import { useEffect, useState } from "react";
import { Track } from "livekit-client";
import { getRoomForDevDiagnostics, resumeAudioPlayback, useCallState } from "../../services/call/callStore";
import styles from "./AudioDebugPanel.module.css";

// ---------------------------------------------------------------------------------------------
// TEMPORARY, DEV-ONLY Stage A voice diagnostic.
//
// Purpose: prove on a SINGLE PC (two browser sessions) that microphone audio actually travels
// between participants — which "In Call" alone does not demonstrate.
//
// It only READS LiveKit's own Room/participant/track state on a timer. It creates no connection,
// requests no token, publishes no track, and never routes the local microphone to local speakers
// (no side-tone, so no feedback loop). Nothing here goes through Socket.IO.
//
// The whole component is behind import.meta.env.DEV and returns null when not connected, so it is
// dead code in production builds and cannot affect production layout.
// ---------------------------------------------------------------------------------------------

const POLL_MS = 100;

// ---------------------------------------------------------------------------------------------
// Level metering. LiveKit's participant.audioLevel / isSpeaking come from the SFU's active-speaker
// detection, which is threshold-gated — it stays 0 for quiet or synthetic audio, so it cannot
// prove "samples are flowing". Instead we tap each MediaStreamTrack with a Web Audio
// AnalyserNode and compute RMS ourselves.
//
// This is READ-ONLY analysis: nothing is ever connected to ctx.destination, so the local
// microphone is NEVER routed to local speakers (no side-tone, no feedback risk). Remote levels
// read the received track directly, which is the actual proof that remote audio arrives.
// ---------------------------------------------------------------------------------------------

let audioCtx: AudioContext | null = null;
const analysers = new Map<
  string,
  { analyser: AnalyserNode; buf: Float32Array<ArrayBuffer>; stream: MediaStream }
>();

function rmsFor(key: string, mediaStreamTrack: MediaStreamTrack | undefined): number {
  if (!mediaStreamTrack) {
    analysers.delete(key);
    return 0;
  }
  if (!audioCtx) {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return 0;
    audioCtx = new Ctor();
  }
  if (audioCtx.state === "suspended") void audioCtx.resume();

  let entry = analysers.get(key);
  if (!entry || entry.stream.getAudioTracks()[0]?.id !== mediaStreamTrack.id) {
    const stream = new MediaStream([mediaStreamTrack]);
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 512;
    // Source -> analyser ONLY. Deliberately not connected to destination.
    audioCtx.createMediaStreamSource(stream).connect(analyser);
    entry = { analyser, buf: new Float32Array(new ArrayBuffer(analyser.fftSize * 4)), stream };
    analysers.set(key, entry);
  }
  entry.analyser.getFloatTimeDomainData(entry.buf);
  let sum = 0;
  for (const v of entry.buf) sum += v * v;
  return Math.sqrt(sum / entry.buf.length);
}

function disposeAnalysers(): void {
  analysers.clear();
}

type RemoteRow = {
  identity: string;
  hasPublication: boolean;
  subscribed: boolean;
  hasTrack: boolean;
  muted: boolean;
  level: number;
  speaking: boolean;
};

type Reading = {
  localPublished: boolean;
  localMuted: boolean;
  localLevel: number;
  localSpeaking: boolean;
  canPlayback: boolean;
  attachedElements: number;
  remotes: RemoteRow[];
};

function meter(rms: number): string {
  // Speech RMS sits around 0.02-0.2, so scale generously; anything audible lights a bar.
  const filled = Math.max(rms > 0.002 ? 1 : 0, Math.min(6, Math.round(rms * 40)));
  return "█".repeat(filled) + "░".repeat(6 - filled);
}

function Flag({ ok, yes = "Yes", no = "No" }: { ok: boolean; yes?: string; no?: string }) {
  return <span className={ok ? styles.yes : styles.no}>{ok ? yes : no}</span>;
}

export function AudioDebugPanel() {
  const call = useCallState();
  const [open, setOpen] = useState(true);
  const [reading, setReading] = useState<Reading | null>(null);
  const connected = call.status === "connected";

  useEffect(() => {
    if (!connected) {
      disposeAnalysers();
      setReading(null);
      return;
    }
    const id = setInterval(() => {
      const room = getRoomForDevDiagnostics();
      if (!room) {
        setReading(null);
        return;
      }
      const lp = room.localParticipant;
      const micPub = lp.getTrackPublication(Track.Source.Microphone);
      const remotes: RemoteRow[] = [];
      room.remoteParticipants.forEach((rp) => {
        const pub = rp.getTrackPublication(Track.Source.Microphone);
        remotes.push({
          identity: rp.identity,
          hasPublication: !!pub,
          subscribed: !!pub?.isSubscribed,
          hasTrack: !!pub?.audioTrack,
          muted: !!pub?.isMuted,
          level: rmsFor(`remote:${rp.identity}`, pub?.audioTrack?.mediaStreamTrack),
          speaking: rp.isSpeaking,
        });
      });
      setReading({
        localPublished: !!micPub?.track,
        localMuted: !!micPub?.isMuted,
        localLevel: rmsFor("local", micPub?.track?.mediaStreamTrack),
        localSpeaking: lp.isSpeaking,
        canPlayback: room.canPlaybackAudio,
        attachedElements: document.querySelectorAll("[data-livekit-remote-audio]").length,
        remotes,
      });
    }, POLL_MS);
    return () => {
      clearInterval(id);
      disposeAnalysers();
    };
  }, [connected]);

  if (!import.meta.env.DEV) return null;
  if (!connected || !reading) return null;

  return (
    <div className={styles.panel}>
      <button type="button" className={styles.header} onClick={() => setOpen((v) => !v)}>
        {open ? "▾" : "▸"} Audio Debug (dev)
      </button>
      {open && (
        <>
          <div className={styles.section}>
            <div>
              <span className={styles.label}>Local mic</span>
            </div>
            <div>
              Published: <Flag ok={reading.localPublished} />
              {"  "}Muted: <Flag ok={reading.localMuted} yes="Yes" no="No" />
            </div>
            <div>
              Level: <span className={styles.meter}>{meter(reading.localLevel)}</span>{" "}
              {reading.localSpeaking ? "🔊" : ""}
            </div>
          </div>

          <div className={styles.section}>
            <div>
              <span className={styles.label}>
                Remote ({reading.remotes.length}) · attached {reading.attachedElements}
              </span>
            </div>
            {reading.remotes.length === 0 && <div className={styles.no}>no remote participants</div>}
            {reading.remotes.map((r) => (
              <div key={r.identity} style={{ marginTop: 3 }}>
                <div>{r.identity}</div>
                <div>
                  Pub: <Flag ok={r.hasPublication} /> Sub: <Flag ok={r.subscribed} /> Track:{" "}
                  <Flag ok={r.hasTrack} />
                </div>
                <div>
                  Muted: <Flag ok={r.muted} yes="Yes" no="No" /> Level:{" "}
                  <span className={styles.meter}>{meter(r.level)}</span> {r.speaking ? "🔊" : ""}
                </div>
              </div>
            ))}
          </div>

          <div className={styles.section}>
            <div>
              Playback allowed: <Flag ok={reading.canPlayback} />
            </div>
            {call.audioPlaybackBlocked && (
              <>
                <div className={styles.warn}>Autoplay blocked by the browser.</div>
                <button
                  type="button"
                  className={styles.resume}
                  onClick={() => void resumeAudioPlayback()}
                >
                  Enable audio
                </button>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}

export default AudioDebugPanel;

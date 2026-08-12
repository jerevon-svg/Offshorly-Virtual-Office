import bgmUrl from "../assets/audio/bgm.mp3";

// Module-level singleton controller for the ambient background-music track.
// The HTMLAudioElement lives at MODULE SCOPE (created lazily on first real
// use), entirely outside React's render/effect lifecycle, so nothing
// (StrictMode's double-effect, any component remount, any internal view
// change inside OfficeMap) can ever recreate it or restart playback.

const MUTED_KEY = "vo:bgm:muted";
const VOLUME_KEY = "vo:bgm:volume";
const DEFAULT_VOLUME = 0.2;
const DEFAULT_MUTED = false;

let audio: HTMLAudioElement | null = null;
let armed = false;
let started = false;

let volumeState = readStoredVolume();
let mutedState = readStoredMuted();

const listeners = new Set<() => void>();

function readStoredVolume(): number {
  try {
    const raw = window.localStorage.getItem(VOLUME_KEY);
    if (raw === null) return DEFAULT_VOLUME;
    const parsed = Number(raw);
    if (Number.isNaN(parsed)) return DEFAULT_VOLUME;
    return clamp01(parsed);
  } catch {
    return DEFAULT_VOLUME;
  }
}

function readStoredMuted(): boolean {
  try {
    const raw = window.localStorage.getItem(MUTED_KEY);
    if (raw === null) return DEFAULT_MUTED;
    return raw === "true";
  } catch {
    return DEFAULT_MUTED;
  }
}

function persistVolume(n: number) {
  try {
    window.localStorage.setItem(VOLUME_KEY, String(n));
  } catch {
    // localStorage unavailable (e.g. private browsing) — in-memory state
    // still holds the value for the rest of this session.
  }
}

function persistMuted(b: boolean) {
  try {
    window.localStorage.setItem(MUTED_KEY, String(b));
  } catch {
    // ignore — see persistVolume
  }
}

function clamp01(n: number): number {
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

function notify() {
  for (const cb of listeners) cb();
}

function getAudio(): HTMLAudioElement {
  if (!audio) {
    audio = new Audio(bgmUrl);
    audio.loop = true;
    audio.volume = volumeState;
    audio.muted = mutedState;
    audio.preload = "auto";
  }
  return audio;
}

export function getVolume(): number {
  return volumeState;
}

export function setVolume(n: number) {
  volumeState = clamp01(n);
  if (audio) audio.volume = volumeState;
  persistVolume(volumeState);
  notify();
  // Setting volume above 0 is a natural "make it audible" gesture — un-mute.
  if (volumeState > 0 && mutedState) {
    setMuted(false);
  }
}

export function isMuted(): boolean {
  return mutedState;
}

export function setMuted(b: boolean) {
  mutedState = b;
  if (audio) audio.muted = mutedState;
  persistMuted(mutedState);
  notify();
}

function onGesture() {
  getAudio()
    .play()
    .then(() => {
      started = true;
      document.removeEventListener("pointerdown", onGesture);
      document.removeEventListener("keydown", onGesture);
    })
    .catch(() => {
      // Autoplay rejected despite a gesture (rare edge-case timing) —
      // swallow silently and leave listeners attached so the next
      // gesture retries. Do NOT remove listeners here.
    });
}

export function armAutoplay() {
  if (armed) return;
  armed = true;
  document.addEventListener("pointerdown", onGesture);
  document.addEventListener("keydown", onGesture);
}

export function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

// Exposed for tests only — not part of the public API surface used by
// components.
export const __testing = {
  isStarted: () => started,
  reset: () => {
    audio = null;
    armed = false;
    started = false;
    listeners.clear();
    volumeState = DEFAULT_VOLUME;
    mutedState = DEFAULT_MUTED;
  },
};

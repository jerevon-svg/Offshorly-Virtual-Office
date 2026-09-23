// vo3d media — ONE VIDEO, ONE TEXTURE, for the whole Championship Cave.
//
// THE RULE THIS FILE EXISTS TO ENFORCE. A 270° wraparound is three wall runs and a floor reflection. The
// obvious build gives each of them its own <video> and its own texture, and then a 1920 × 1080 H.264
// stream is decoded FOUR TIMES, uploaded four times a frame, and played four times out of sync with
// itself — including four copies of the audio. So there is exactly one HTMLVideoElement and exactly one
// THREE.VideoTexture in the CAVE, they live here, and every surface that shows the video is handed the
// SAME texture object. One decode, one GPU upload per frame, one audio stream, no drift by construction.
//
// LIFECYCLE. The element is created LAZILY, on the first entry, so a session that never opens the CAVE
// never fetches, decodes or allocates anything. Leaving PAUSES it: a paused video stops decoding, and the
// surfaces are hidden anyway, so an unattended CAVE costs nothing per frame. Re-entering resumes from
// where it stopped, which is also what makes repeated enter/exit cheap.
//
// AUTOPLAY. Browsers refuse audible playback that no gesture asked for. Entering the CAVE IS a gesture
// (the E key, or a GUI click), so the first play() is attempted WITH SOUND from inside that gesture. If
// it is refused anyway — a stricter policy, an autoplaying reload, a headless run — the element is muted
// and retried, so the picture always comes up even when the sound cannot; `blocked` then records why, and
// the next user gesture can unmute. Nothing here ever throws into the caller.
import * as THREE from "three";

/** The source. ONE file, and the CAVE's first/default media. */
export const CAVE_VIDEO_URL = `${import.meta.env.BASE_URL}vo3d/suntoucan.mp4`;

export type CaveMediaState = {
  /** "absent" until the first entry creates the element */
  status: "absent" | "loading" | "playing" | "paused" | "error";
  muted: boolean;
  /** why sound (or playback) was refused, for the dev readout. "" when nothing was refused. */
  blocked: string;
  /** seconds, for the dev readout */
  time: number;
  duration: number;
};

export class CaveMedia {
  private video: HTMLVideoElement | null = null;
  private _texture: THREE.VideoTexture | null = null;
  readonly state: CaveMediaState = { status: "absent", muted: false, blocked: "", time: 0, duration: 0 };

  /** The ONE texture every CAVE surface samples, or null before the first entry / outside a browser. */
  get texture(): THREE.VideoTexture | null {
    return this._texture;
  }
  get element(): HTMLVideoElement | null {
    return this.video;
  }

  /** Build the element and its texture. Idempotent; a no-op with no DOM (tests, SSR). */
  ensure(): THREE.VideoTexture | null {
    if (this._texture) return this._texture;
    if (typeof document === "undefined") return null;
    const v = document.createElement("video");
    v.src = CAVE_VIDEO_URL;
    v.loop = true;
    v.playsInline = true;
    v.preload = "auto";
    v.crossOrigin = "anonymous";
    // NOT muted by default: this is a media experience and the audio is part of it. The gesture that
    // opens the CAVE is what earns the right to say so; play() falls back to muted if it is refused.
    v.muted = false;
    v.volume = 0.85;
    v.addEventListener("error", () => { this.state.status = "error"; this.state.blocked = "video failed to load"; });
    this.video = v;
    const tex = new THREE.VideoTexture(v);
    tex.colorSpace = THREE.SRGBColorSpace;
    // THE WRAPAROUND MAPPING IS IN THE GEOMETRY, not in the wrap mode — so this CLAMPS.
    //
    // The obvious build sets MirroredRepeatWrapping and lets the sampler fold the picture back along the
    // wings. It works, and it folds at texture coordinate 0 and 1 — i.e. at the frame's outermost column,
    // which in this source is usually black. Two black edges meeting read as a bezel at the exact join
    // the wrap exists to hide. build/cave.ts therefore mirrors on the CPU, at real vertices, about a
    // CROPPED edge (rooms/cave.ts SCREEN.edgeCrop), and every uv it emits already lies inside the frame.
    // Clamping is then the correct mode and the one that guarantees a stray uv can never wrap at all.
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.generateMipmaps = false;
    this._texture = tex;
    this.state.status = "loading";
    return tex;
  }

  /** Start (or resume) playback. Call from inside a user gesture so the audio is allowed. */
  play(): void {
    const v = this.video ?? (this.ensure(), this.video);
    if (!v) return;
    this.state.blocked = "";
    const attempt = v.play();
    if (!attempt) { this.state.status = "playing"; return; }
    attempt.then(() => { this.state.status = "playing"; this.state.muted = v.muted; }).catch((err: unknown) => {
      // Refused with sound: the picture still matters more than the sound, so come up muted and say so.
      v.muted = true;
      this.state.muted = true;
      this.state.blocked = `audio blocked by the browser (${String(err).slice(0, 60)}) — unmute to hear it`;
      v.play().then(() => { this.state.status = "playing"; }).catch(() => { this.state.status = "error"; this.state.blocked = "playback refused"; });
    });
  }

  /** Stop decoding. The element and its position are kept, so re-entry resumes instantly. */
  pause(): void {
    if (!this.video) return;
    this.video.pause();
    this.state.status = "paused";
  }

  toggle(): void {
    if (!this.video || this.video.paused) this.play();
    else this.pause();
  }

  setMuted(m: boolean): void {
    if (!this.video) return;
    this.video.muted = m;
    this.state.muted = m;
    if (!m) this.state.blocked = "";
  }

  /** Refresh the dev readout. Cheap; called from the CAVE's own per-frame tick, and only while inside. */
  sample(): void {
    const v = this.video;
    if (!v) return;
    this.state.time = Math.round(v.currentTime * 10) / 10;
    this.state.duration = Number.isFinite(v.duration) ? Math.round(v.duration * 10) / 10 : 0;
    if (this.state.status === "loading" && !v.paused) this.state.status = "playing";
  }

  /** Tear the whole thing down. Not used by the running app — the CAVE keeps its media for the session. */
  dispose(): void {
    this.pause();
    this._texture?.dispose();
    this._texture = null;
    if (this.video) { this.video.removeAttribute("src"); this.video.load(); }
    this.video = null;
    this.state.status = "absent";
  }
}

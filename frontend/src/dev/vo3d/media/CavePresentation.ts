// vo3d media — PRESENTATION MODE: a live LiveKit screen share, on the CAVE's front panel.
//
// THE SEAM THIS FILE IS. Everything above it is the app's ONE existing LiveKit call
// (services/call/callStore.ts): one Room, one subscription, one set of tracks. Everything below it
// is three.js. This is the whole bridge between them, and it is deliberately tiny:
//
//     a subscribed ScreenShare video track  →  ONE <video>  →  ONE VideoTexture  →  the front panel
//
// It creates no room, no token, no second call, and it never touches audio. The call's audio —
// microphones AND the shared surface's own audio, which LiveKit publishes as a SEPARATE
// ScreenShareAudio source — keeps playing through callStore's existing hidden audio elements. That
// is why the element here is MUTED and must stay muted: unmuting it would play the presenter's
// desktop audio a second time, out of phase with the first.
//
// LIFECYCLE, and why it is two booleans rather than one. A share can start while nobody is in the
// CAVE, and somebody can walk out of the CAVE while a share is still running. Attaching in either
// of those states would decode a 1080p desktop stream into a texture nothing is drawing. So this
// holds the SOURCE (told to it by the call) and the ACTIVE flag (told to it by the CAVE), and it
// attaches only when it has both — which also makes "walk out, walk back in" free, and makes a
// share that ends while you are elsewhere cost exactly nothing.
//
// NO PER-FRAME ALLOCATION. attach() runs once per share; sample() reads two numbers off the
// element and compares them. The texture uploads itself once a frame, from the one decode the
// element is already doing — the same contract CaveMedia holds for the boxing video.
import * as THREE from "three";

/** What this adapter needs of a track. livekit-client's RemoteVideoTrack and LocalVideoTrack both
 *  satisfy it exactly, and nothing here imports livekit-client — which is what keeps this file
 *  testable with a fake, and keeps the dev page free of the SDK until a share actually arrives. */
export type PresentationSource = {
  attach(element: HTMLVideoElement): HTMLVideoElement;
  detach(element: HTMLVideoElement): HTMLVideoElement;
};

export type CavePresentationState = {
  /** "off" = nobody is sharing · "waiting" = a share exists but the CAVE is empty · "live" */
  status: "off" | "waiting" | "live" | "error";
  /** LiveKit identity of whoever is presenting, or "" */
  presenter: string;
  /** source pixels, once the element has metadata. 0 until then. */
  width: number;
  height: number;
  note: string;
};

/** The panel's own aspect — 320 × 180 on the front chord (rooms/cave.ts SCREEN). */
export const PANEL_ASPECT = 16 / 9;

export class CavePresentation {
  private source: PresentationSource | null = null;
  private video: HTMLVideoElement | null = null;
  private _texture: THREE.VideoTexture | null = null;
  private active = false;
  private _aspect = PANEL_ASPECT;
  /** bumped whenever the RENDERER needs to be told something new (texture swapped, aspect known) */
  private dirty = false;
  readonly state: CavePresentationState = { status: "off", presenter: "", width: 0, height: 0, note: "" };

  /** The texture the front panel samples, or null when nothing is live. */
  get texture(): THREE.VideoTexture | null {
    return this._texture;
  }
  /** Source aspect, for the letterbox fit. Falls back to the panel's own until metadata lands. */
  get aspect(): number {
    return this._aspect;
  }
  get live(): boolean {
    return this._texture !== null;
  }
  get element(): HTMLVideoElement | null {
    return this.video;
  }

  /** THE CALL SIDE. Told by the bridge whenever the room's active share changes — a new presenter,
   *  a replaced track, or null when sharing stopped. Idempotent for the same source. */
  setSource(source: PresentationSource | null, presenter = ""): void {
    if (source === this.source) {
      if (source) this.state.presenter = presenter;
      return;
    }
    this.teardown();
    this.source = source;
    this.state.presenter = source ? presenter : "";
    this.sync();
  }

  /** THE CAVE SIDE. Told by the transition: true on entering, false on leaving. */
  setActive(active: boolean): void {
    if (this.active === active) return;
    this.active = active;
    this.sync();
  }

  /** Attach iff there is something to show AND somewhere to show it; detach otherwise. */
  private sync(): void {
    if (this.source && this.active) {
      this.attach();
      return;
    }
    this.teardown();
    this.state.status = this.source ? "waiting" : "off";
  }

  private attach(): void {
    if (this._texture || !this.source) return;
    if (typeof document === "undefined") return; // tests / SSR: no element, no texture, no throw
    const v = document.createElement("video");
    // MUTED IS LOAD-BEARING — see the audio note at the top of this file. It is also what makes
    // autoplay legal without a gesture, so a share that starts while you are already standing in
    // the CAVE comes up on the wall by itself.
    v.muted = true;
    v.autoplay = true;
    v.playsInline = true;
    v.dataset.caveScreenShare = "1";
    v.style.cssText = "position:fixed;width:1px;height:1px;opacity:0;pointer-events:none;left:-10px;top:-10px";
    document.body.appendChild(v);
    this.source.attach(v);
    this.video = v;
    const tex = new THREE.VideoTexture(v);
    tex.colorSpace = THREE.SRGBColorSpace;
    // A desktop share is TEXT. Clamp (never wrap — the fold that serves the 270° video would put a
    // mirrored slide edge on screen), linear filter, and no mipmaps: the panel is drawn at roughly
    // 1:1, and a mipmap chain on a per-frame-updated texture is a per-frame blur and a per-frame cost.
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.generateMipmaps = false;
    this._texture = tex;
    this.state.status = "live";
    this.state.note = "";
    this.dirty = true;
    const attempt = v.play();
    if (attempt) {
      attempt.catch((err: unknown) => {
        // Muted playback is essentially never refused, but a headless/backgrounded tab can still
        // say no. Report it; nothing throws into the CAVE's frame loop.
        this.state.note = `playback refused (${String(err).slice(0, 50)})`;
      });
    }
  }

  /** Per-frame while inside, and only then. Two reads and two compares — no allocation. */
  sample(): void {
    const v = this.video;
    if (!v) return;
    if (v.videoWidth === this.state.width && v.videoHeight === this.state.height) return;
    this.state.width = v.videoWidth;
    this.state.height = v.videoHeight;
    if (v.videoWidth > 0 && v.videoHeight > 0) {
      this._aspect = v.videoWidth / v.videoHeight;
      // A presenter switching monitors (or rotating a window) changes the shape of the picture
      // without changing the track — the panel has to be refitted, or the share gets stretched.
      this.dirty = true;
    }
  }

  /** True ONCE per change, so the caller only touches materials when something actually moved. */
  consumeChange(): boolean {
    const d = this.dirty;
    this.dirty = false;
    return d;
  }

  /** Detach the element and drop the texture. Leaves the SOURCE alone: the call still owns the
   *  track, and re-entering the CAVE attaches a fresh element to the same live share. */
  private teardown(): void {
    const v = this.video;
    this.video = null;
    // The RENDERER has to be told, and it has to be told here: setSource() tears the old source
    // down BEFORE it re-syncs, so a flag raised only by sync() is never raised for a share that
    // ended (the CAVE then kept a hidden-track panel up and never resumed its own video — found
    // by driving a real share, not by reading the code).
    if (this._texture) this.dirty = true;
    this._texture?.dispose();
    this._texture = null;
    this._aspect = PANEL_ASPECT;
    this.state.width = 0;
    this.state.height = 0;
    if (!v) return;
    try {
      // ALWAYS with the element: a no-argument detach() would rip every other tile off this track
      // (the call overlay attaches its own elements to the same tracks).
      this.source?.detach(v);
    } catch {
      // Track already ended — clearing the element below is still the right cleanup.
    }
    v.pause();
    v.srcObject = null;
    v.remove();
  }

  /** Full stop: forget the source too. Used on page teardown and by the tests. */
  dispose(): void {
    this.teardown();
    this.source = null;
    this.active = false;
    this.state.status = "off";
    this.state.presenter = "";
    this.state.note = "";
    this.dirty = false;
  }
}

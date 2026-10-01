// vo3d playground — THE STANDALONE PAGE (monkey-playground.html). DEV-ONLY, TEMPORARY.
//
// A bare three.js view of the MonkeyAgent traversal playground: the VO camera (orthographic, pitched 52°,
// framed like an in-Lab shot) and a close perspective camera, real shadows (so foot and hand contact can be
// judged), and `window.__mp` for the capture harness: pick a scenario, seek any instant, frame any view.
//
// Keys: space play/pause · [ ] step 1/30 s · 1–9 scenarios · v / c VO / close camera · ← → orbit.
import * as THREE from "three";
import { MonkeyPlayground, SCENARIOS } from "./monkeyPlayground";
import type { BodyPose } from "../avatar/monkeyMotion";

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xcfd8e0);
scene.add(new THREE.HemisphereLight(0xf4f1ea, 0x8a8170, 1.25));
const sun = new THREE.DirectionalLight(0xfff4e2, 2.1);
sun.position.set(-160, 340, 220);
sun.castShadow = true;
sun.shadow.mapSize.set(4096, 4096);
const sc = sun.shadow.camera as THREE.OrthographicCamera;
sc.left = -320; sc.right = 320; sc.top = 220; sc.bottom = -220; sc.near = 10; sc.far = 900;
sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.6;
scene.add(sun);

const pg = new MonkeyPlayground();
scene.add(pg.root);

// ---- cameras -----------------------------------------------------------------------------------------------
type View = { kind: "vo" | "close"; target: THREE.Vector3; yaw: number; pitch: number; size: number };
const view: View = { kind: "vo", target: new THREE.Vector3(0, 10, -20), yaw: 0, pitch: 52, size: 120 };
const ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 6000);
const persp = new THREE.PerspectiveCamera(40, 1, 1, 6000);
let follow: string | null = null;
function placeCameras(): THREE.Camera {
  const aspect = window.innerWidth / window.innerHeight;
  if (follow) {
    const a = pg.agents.get(follow);
    const p = a?.loco.lastPose?.pos;
    if (p) view.target.lerp(new THREE.Vector3(p.x, p.y + 16, p.z), 0.15);
  }
  const pitch = THREE.MathUtils.degToRad(view.pitch), yaw = THREE.MathUtils.degToRad(view.yaw);
  const dir = new THREE.Vector3(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
  if (view.kind === "vo") {
    // the VO orbit: an orthographic camera far off along the pitch/yaw direction; `size` is the half-height
    ortho.position.copy(view.target).addScaledVector(dir, 2500);
    ortho.up.set(0, 1, 0); ortho.lookAt(view.target);
    ortho.top = view.size; ortho.bottom = -view.size; ortho.left = -view.size * aspect; ortho.right = view.size * aspect;
    ortho.updateProjectionMatrix();
    return ortho;
  }
  persp.aspect = aspect;
  persp.position.copy(view.target).addScaledVector(dir, view.size);
  persp.up.set(0, 1, 0); persp.lookAt(view.target);
  persp.updateProjectionMatrix();
  return persp;
}

// ---- loop --------------------------------------------------------------------------------------------------
let playing = true;
let last = performance.now();
const hud = document.getElementById("hud")!;
const perf = { frames: 0, acc: 0, fps: 0, ms: 0, worst: 0 };
function render(dt: number): void {
  const cam = placeCameras();
  const t0 = performance.now();
  if (playing) pg.advance(dt, cam, window.innerHeight);
  else pg.advance(0, cam, window.innerHeight);
  const poseMs = performance.now() - t0;
  renderer.render(scene, cam);
  perf.frames++; perf.acc += dt; perf.ms += poseMs; perf.worst = Math.max(perf.worst, dt * 1000);
  if (perf.acc >= 1) { perf.fps = perf.frames / perf.acc; perf.ms /= perf.frames; Object.assign(window, { __mpPerf: { ...perf } }); perf.frames = 0; perf.acc = 0; perf.ms = 0; perf.worst = 0; }
  const rows = [...pg.agents.values()].filter((a) => a.body.root.visible).map((a) => `${a.id.padEnd(5)} ${a.loco.debug.mode.padEnd(8)} ${a.loco.debug.gait.padEnd(8)} ${a.loco.debug.node}`);
  hud.textContent = `${pg.scenario.id} · t ${pg.t.toFixed(2)} / ${pg.scenario.length}s ${playing ? "▶" : "❚❚"}\n${pg.scenario.note}\n${rows.join("\n")}`;
}
function loop(now: number): void {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (playing && pg.t > pg.scenario.length + 1.5) pg.seek(0);
  render(dt);
  requestAnimationFrame(loop);
}

window.addEventListener("resize", () => renderer.setSize(window.innerWidth, window.innerHeight));
window.addEventListener("keydown", (e) => {
  if (e.key === " ") playing = !playing;
  else if (e.key === "]") { playing = false; pg.seek(pg.t + 1 / 30); }
  else if (e.key === "[") { playing = false; pg.seek(Math.max(0, pg.t - 1 / 30)); }
  else if (e.key === "v") view.kind = "vo";
  else if (e.key === "c") view.kind = "close";
  else if (e.key === "ArrowLeft") view.yaw -= 10;
  else if (e.key === "ArrowRight") view.yaw += 10;
  else if (/^[1-9]$/.test(e.key)) pg.play(Object.keys(SCENARIOS)[Number(e.key) - 1] ?? "tour");
});

// ---- the harness API ---------------------------------------------------------------------------------------
const api = {
  ready: false,
  scenarios: Object.keys(SCENARIOS),
  pg,
  play(id: string) { pg.play(id); playing = true; },
  pause() { playing = false; },
  /** pose the scenario at exactly t (and settle the mixer for clip-backed actions) */
  seek(t: number) {
    playing = false;
    pg.seek(Math.max(0, t - 0.6));
    for (let i = 0; i < 36; i++) pg.advance(0.6 / 36);
    render(0);
  },
  view(v: Partial<{ kind: "vo" | "close"; target: [number, number, number]; yaw: number; pitch: number; size: number; follow: string | null }>) {
    if (v.kind) view.kind = v.kind;
    if (v.target) view.target.set(...v.target);
    if (v.yaw !== undefined) view.yaw = v.yaw;
    if (v.pitch !== undefined) view.pitch = v.pitch;
    if (v.size !== undefined) view.size = v.size;
    if (v.follow !== undefined) follow = v.follow;
    render(0);
  },
  /** detach (false) / reattach (true) an agent's locomotion driver — shows the raw clip pose for comparison */
  driver(id: string, on: boolean) { const a = pg.agents.get(id); if (!a) return; a.body.driver = on ? (a.loco as unknown as { drive: () => void }).drive.bind(a.loco) : null; render(0); },
  /** frame an agent relative to ITS facing: side (its left), right, front, back, or q (three-quarter front-left) */
  frameAgent(id: string, o: { side?: "left" | "right" | "front" | "back" | "q"; size?: number; pitch?: number; dy?: number; kind?: "vo" | "close" } = {}) {
    const P = pg.agents.get(id)?.loco.lastPose;
    if (!P) return;
    const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(P.q); fwd.y = 0; fwd.normalize();
    const yawF = Math.atan2(fwd.x, fwd.z);
    const off = { front: 0, left: Math.PI / 2, back: Math.PI, right: -Math.PI / 2, q: Math.PI / 4 }[o.side ?? "left"];
    view.kind = o.kind ?? "close";
    view.yaw = THREE.MathUtils.radToDeg(yawF + off);
    view.pitch = o.pitch ?? 8;
    view.size = o.size ?? 70;
    view.target.set(P.pos.x, P.pos.y + (o.dy ?? 14), P.pos.z);
    follow = null;
    render(0);
  },
  /** every agent's scheduled plans: segment kinds and times (for choosing capture instants) */
  timeline() {
    return [...pg.agents.values()].filter((a) => a.body.root.visible).map((a) => ({
      id: a.id,
      plans: (a.loco as unknown as { plans: { t0: number; t1: number; action: string; segs: { kind: string; t0: number; dur: number; run?: { gait: string } }[] }[] }).plans
        .map((p) => ({ t0: +p.t0.toFixed(2), t1: +p.t1.toFixed(2), action: p.action, segs: p.segs.map((s) => ({ kind: s.kind, gait: s.run?.gait, t0: +s.t0.toFixed(2), dur: +s.dur.toFixed(2) })) })),
    }));
  },
  /** DEV: show an agent in its bind T-pose (all rotations rest), optionally orienting the left hand */
  tpose(id: string, hand: null | { fwd: [number, number, number]; down: [number, number, number] } = null) {
    const a = pg.agents.get(id); if (!a) return;
    a.loco.debugOverride = (_t, base) => {
      const P = { ...base, hips: new THREE.Vector3(), pelvis: new THREE.Vector3(), spine: new THREE.Vector3(), neck: new THREE.Vector3(),
        arm: [{ swing: 0, out: Math.PI / 2, bend: 0, end: 0 }, { swing: 0, out: Math.PI / 2, bend: 0, end: 0 }] as BodyPose["arm"],
        leg: [{ swing: 0, out: 0, bend: 0, end: 0 }, { swing: 0, out: 0, bend: 0, end: 0 }] as BodyPose["leg"],
        hand: [null, null] as BodyPose["hand"], foot: [null, null] as BodyPose["foot"], lookW: 0, w: 1 };
      if (hand) {
        const rig = a.loco.rigReady!;
        const wrist = rig.pos("LeftHand").clone();
        P.hand = [{ p: wrist, pole: wrist.clone().add(new THREE.Vector3(0, 0, -5)), w: 0.0001, fwd: new THREE.Vector3(...hand.fwd), down: new THREE.Vector3(...hand.down), ow: 10000 }, null];
      }
      return P;
    };
    render(0);
  },
  clearOverride(id: string) { const a = pg.agents.get(id); if (a) a.loco.debugOverride = null; },
  /** CPU cost of the locomotion layer: mean ms per agent per frame for (pose + body.update incl. mixer and IK) */
  bench(frames = 600) {
    const agents = [...pg.agents.values()].filter((a) => a.body.root.visible);
    const t0 = pg.t, cam = placeCameras();
    const s = performance.now();
    for (let i = 0; i < frames; i++) { pg.advance(1 / 60, cam, window.innerHeight); }
    const ms = (performance.now() - s) / frames;
    pg.seek(t0);
    return { agents: agents.length, msPerFrame: +ms.toFixed(3), msPerAgent: +(ms / Math.max(1, agents.length)).toFixed(3) };
  },
  /** where an agent is now (for framing) */
  where(id: string) { const p = pg.agents.get(id)?.loco.lastPose?.pos; return p ? [p.x, p.y, p.z] : null; },
  debug() { return [...pg.agents.values()].map((a) => ({ id: a.id, ...a.loco.debug, reach: a.loco.debug.reach.map((r) => +r.toFixed(2)), stats: a.body.stats() })); },
  renderInfo() { return { ...renderer.info.render, gl: (() => { const g = renderer.getContext(); const ext = g.getExtension("WEBGL_debug_renderer_info"); return ext ? g.getParameter(ext.UNMASKED_RENDERER_WEBGL) : "?"; })() }; },
};
Object.assign(window, { __mp: api });

const q0 = new URLSearchParams(location.search);
void pg.load(q0.get("agents") ? q0.get("agents")!.split(",") : undefined).then(() => {
  const q = q0;
  pg.play(q.get("s") ?? "tour");
  api.ready = true;
  requestAnimationFrame(loop);
});

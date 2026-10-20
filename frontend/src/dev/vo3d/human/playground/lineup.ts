// vo3d human — PERMANENT PRODUCTION LINEUP (human-base-lineup.html?humanbase=1). DEV-ONLY, isolated: nothing in
// the app imports this. Every body is built through the PRODUCTION path — avatar/humanBody humanBodyFor() →
// createHumanBody() — the one local (avatar/Avatar) and remote (world/Coworkers) bodies take, so what this page shows
// is exactly the production appearance, head mounts included. One ground plane, one camera, so relative scale is
// judged honestly.
//
//   ?set=<name>     first (default: the approved five) | batch2 (the second batch, Bon in the middle as the
//                   canonical reference) | all (the whole HumanBase roster)
//   ?ids=a,b,c      an explicit row instead of a set (e.g. a candidate between approved references)
//   ?candidate=<id>:<path>  that employee wears a CANDIDATE identity file (served from frontend/, e.g. the fail-closed
//                   build's scripts/avatar-pipeline/output/human-base/candidates/<id>/pass2/<id>-v1.glb) — for visual sign-off
//                   An id may carry a version label — `jona@base`, `jona@corr-v1` — so several versions of ONE employee stand in one
//                   row, each with its own candidate file (the label never reaches the appearance: it is the employee's own)
//   ?mount=0        the heads as authored (no group proportion normalization) — the A/B "before"
//   ?view=<name>    front (default) | front34 | side | rear | vo | orthoFront | orthoSide | faces
//   ?mode=<clip>    idle (default) | walk | run | sit
//   ?turn=<deg>     every body turned in place (0 front, 45 three-quarter, 90 profile, 180 back) — one camera, five
//                   profiles side by side
//   ?capture=1      hides the panel
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { candidateAppearance, createHumanBody, HUMANBASE_CATALOGUE, humanBodyFor, identityHeadAsset, type HumanBody } from "../../avatar/humanBody";
import { CLIP_IDLE, CLIP_RUN, CLIP_SIT, CLIP_WALK } from "../../adapters/v1Avatar";
import { HUMAN_STANDING_HEIGHT as H } from "../humanBaseContract";

const Q = new URLSearchParams(location.search);
if (Q.get("humanbase") !== "1") { document.getElementById("gate")!.style.display = "flex"; document.getElementById("panel")!.style.display = "none"; throw new Error("gated behind ?humanbase=1"); }
if (Q.get("capture") === "1") document.body.classList.add("capture");

/** the review sets, screen-left → screen-right from the front */
const SETS: Record<string, readonly string[]> = {
  first: ["angelo", "micah", "bon", "france", "clang"],
  batch2: ["kael", "jona", "bon", "nicole", "lui"],
  all: ["angelo", "micah", "france", "clang", "bon", "kael", "jona", "nicole", "lui"],
};
const SET = SETS[Q.get("set") ?? ""] ? Q.get("set")! : "first";
const IDS = Q.get("ids")?.split(",").filter(Boolean);
const ORDER: readonly string[] = IDS?.length ? IDS : SETS[SET];
const CANDIDATE = new Map((Q.get("candidate") ?? "").split(",").filter(Boolean).map((c) => { const i = c.indexOf(":"); return [c.slice(0, i), c.slice(i + 1)] as const; }));
const SPACING = 24;
/** wider rows push every camera back so the whole row stays framed (the first five = 1) */
const ROW_K = Math.max(1, ORDER.length / 5);
const MOUNTS = Q.get("mount") !== "0";

// ---- renderer + scene (the QA viewer's VO look) ----
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
document.body.prepend(renderer.domElement);
const scene = new THREE.Scene(); scene.background = new THREE.Color(0xd9dfe6);
scene.add(new THREE.HemisphereLight(0xf4f1ea, 0x8a8170, 1.3));
const sun = new THREE.DirectionalLight(0xfff4e2, 2.2); sun.position.set(-90, 220, 160); sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
const sc = sun.shadow.camera as THREE.OrthographicCamera; sc.left = -120; sc.right = 120; sc.top = 120; sc.bottom = -120; sc.near = 10; sc.far = 700;
sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.5; scene.add(sun);
const fill = new THREE.DirectionalLight(0xe8eef6, 0.6); fill.position.set(60, -40, -160); scene.add(fill);
const ground = new THREE.Mesh(new THREE.CircleGeometry(220, 64), new THREE.MeshStandardMaterial({ color: 0xc9cfd6, roughness: 0.95 }));
ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);
// height rules every 6 units behind the row (relative scale at a glance)
const RULE_X = ((ORDER.length - 1) / 2) * SPACING + 22;
for (let y = 6; y <= 48; y += 6) {
  const g = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-RULE_X, y, -14), new THREE.Vector3(RULE_X, y, -14)]);
  scene.add(new THREE.Line(g, new THREE.LineBasicMaterial({ color: y === H ? 0x5dd9b3 : 0xaab3be })));
}

const aspect = () => window.innerWidth / window.innerHeight;
const persp = new THREE.PerspectiveCamera(30, aspect(), 0.5, 3000);
const ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.5, 3000);
let camera: THREE.Camera = persp;
const controls = new OrbitControls(persp, renderer.domElement); controls.enableDamping = true;
function fitOrtho(halfH: number): void { const a = aspect(); ortho.left = -halfH * a; ortho.right = halfH * a; ortho.top = halfH; ortho.bottom = -halfH; ortho.updateProjectionMatrix(); }
addEventListener("resize", () => { persp.aspect = aspect(); persp.updateProjectionMatrix(); fitOrtho((ortho.top - ortho.bottom) / 2); renderer.setSize(innerWidth, innerHeight); });

// ---- views: every one frames the whole row on the SAME ground plane ----
const FOCUS = new THREE.Vector3(0, H * 0.62, 0);
const VIEWS: Record<string, () => void> = {
  front: () => setPersp(30, new THREE.Vector3(0, H * 0.62, 235), FOCUS),
  front34: () => setPersp(30, new THREE.Vector3(150, H * 0.75, 180), FOCUS),
  side: () => setPersp(30, new THREE.Vector3(235, H * 0.62, 0), FOCUS),
  rear: () => setPersp(30, new THREE.Vector3(0, H * 0.7, -235), FOCUS),
  // VO's third-person player camera (player/PlayerCamera: fov 55, pitch 0.34, boom 2.6 H at 0.72 H), turned to the faces
  vo: () => { const f = new THREE.Vector3(0, H * 0.72, 0), b = 2.6 * H, p = 0.34; setPersp(55, new THREE.Vector3(0, f.y + Math.sin(p) * b, Math.cos(p) * b), f); },
  orthoFront: () => setOrtho(new THREE.Vector3(0, H * 0.7, 400), new THREE.Vector3(0, H * 0.7, 0), H * 0.78),
  orthoSide: () => setOrtho(new THREE.Vector3(400, H * 0.7, 0), new THREE.Vector3(0, H * 0.7, 0), H * 0.78),
  faces: () => setOrtho(new THREE.Vector3(0, H * 0.82, 400), new THREE.Vector3(0, H * 0.82, 0), H * 0.42),
};
let currentView = VIEWS[Q.get("view") ?? ""] ? Q.get("view")! : "front";
function setPersp(fov: number, pos: THREE.Vector3, target: THREE.Vector3): void {
  pos = target.clone().addScaledVector(pos.clone().sub(target), ROW_K);
  camera = persp; persp.fov = fov; persp.updateProjectionMatrix(); persp.position.copy(pos); controls.target.copy(target); controls.enabled = true; controls.update();
}
function setOrtho(pos: THREE.Vector3, target: THREE.Vector3, halfH: number): void {
  if (pos.x === target.x) halfH *= ROW_K;   // a front-on ortho view must fit the whole row's width
  camera = ortho; fitOrtho(halfH); ortho.position.copy(pos); ortho.lookAt(target); controls.enabled = false;
}
function view(name: string): void { if (!VIEWS[name]) return; currentView = name; VIEWS[name](); }
let turnDeg = Number(Q.get("turn") ?? 0) || 0;
function turn(deg: number): void { turnDeg = deg; for (const { body } of bodies) body.human.root.rotation.y = (deg * Math.PI) / 180; }

// ---- the set, through the production resolver ----
const bodies: { id: string; body: HumanBody }[] = [];
for (const [i, id] of ORDER.entries()) {
  const castId = id.split("@")[0];   // `<employee>@<version label>`: the label only tells the row's slots apart
  // a candidate is reviewed in its production appearance even while not enabled, wearing EXACTLY the mount its final gate
  // validated (the build's report.json next to the candidate: validatedMount + bindingHash) — the runtime's own appearanceFor path
  // (the report of a candidate's VERSION — scripts/avatar-pipeline/human-base/candidate-versions.mjs reportFor: legacy pass / corr-pass,
  // or <tag>-passN → report.<tag>.json)
  const rep = CANDIDATE.has(id) ? await fetch(`${import.meta.env.BASE_URL}${CANDIDATE.get(id)!.replace(/\/(?:([^/]+)-)?pass\d\/[^/]+$/, (_m: string, t?: string) => (t === undefined ? "/report.json" : t === "corr" ? "/report.corrected.json" : `/report.${t}.json`))}`).then((r) => (r.ok ? r.json() : null)).catch(() => null) : null;
  if (CANDIDATE.has(id) && !rep?.validatedMount) throw new Error(`${id}: candidate has no gate-validated mount (report.json) — rebuild it`);
  const cfg = CANDIDATE.has(id) ? candidateAppearance(castId, { [castId]: { artifactHash: rep.artifactHash, pipelineVersion: rep.pipelineVersion, mount: rep.validatedMount, bindingHash: rep.bindingHash, validatedAt: rep.builtAt, bodyPreset: rep.bodyPreset === "feminine" ? "feminine" : "standard" } }, rep.bodyPreset === "feminine" ? "feminine" : "standard") : humanBodyFor(castId, "?humanbase=1");
  if (!cfg) throw new Error(`${id} is not a HumanBase employee`);
  if (!MOUNTS) delete cfg.identity.mount;
  const cand = CANDIDATE.get(id), head = HUMANBASE_CATALOGUE.get(cfg.identity.headAssetId) ?? (cand ? identityHeadAsset(castId, "") : undefined);
  const body = await createHumanBody(cfg, cand && head ? new Map(HUMANBASE_CATALOGUE).set(head.id, { ...head, url: `${import.meta.env.BASE_URL}${cand}` }) : undefined);
  body.human.root.position.set((i - (ORDER.length - 1) / 2) * SPACING, 0, 0);
  scene.add(body.human.root);
  bodies.push({ id, body });
}

const MODES: Record<string, string> = { idle: CLIP_IDLE, walk: CLIP_WALK, run: CLIP_RUN, sit: CLIP_SIT };
let mode = MODES[Q.get("mode") ?? ""] ? Q.get("mode")! : "idle";
function setMode(m: string): void {
  if (!MODES[m]) return; mode = m;
  for (const { body } of bodies) body.human.play(body.clipName(MODES[m]), 0.2);
}

/** WORLD-SPACE PROPORTIONS at the current pose. Anatomical anchors come from each identity's own landmarks carried by
 *  the Head bind matrix (mount included); the hair/whole-head silhouette from the skinned vertices themselves. */
function measure(): Record<string, unknown>[] {
  const v = new THREE.Vector3(), m4 = new THREE.Matrix4();
  return bodies.map(({ id, body }) => {
    const h = body.human, lm = h.identityLandmarks as unknown as { eyes: { l: number[]; r: number[] }; attach: { ears: { l: { root: number[] }; r: { root: number[] } } } };
    h.root.updateMatrixWorld(true);
    const headM = h.rig.bindMatrixOf("Head", m4), pt = (p: number[]) => new THREE.Vector3(p[0], p[1], p[2]).applyMatrix4(headM);
    const eyeL = pt(lm.eyes.l), eyeR = pt(lm.eyes.r), chin = pt([0, 0.805, 0.3]), earL = pt(lm.attach.ears.l.root), earR = pt(lm.attach.ears.r.root);
    const neckTop = h.bones.get("Head")!.getWorldPosition(new THREE.Vector3());
    let top = -Infinity, minX = Infinity, maxX = -Infinity;
    for (const slot of ["identity", "glasses"]) for (const o of h.piece(slot)?.meshes ?? []) {
      const s = o as THREE.SkinnedMesh; if (!s.isSkinnedMesh) continue;
      const n = s.geometry.getAttribute("position").count;
      for (let i = 0; i < n; i += 3) { s.getVertexPosition(i, v); s.localToWorld(v); top = Math.max(top, v.y); minX = Math.min(minX, v.x); maxX = Math.max(maxX, v.x); }
    }
    const faceLen = eyeL.y - chin.y, ipd = eyeL.distanceTo(eyeR), skullW = earL.distanceTo(earR);
    const r3 = (x: number) => +x.toFixed(3);
    return { id, mount: h.headMount, neckTopY: r3(neckTop.y), chinY: r3(chin.y), eyeY: r3(eyeL.y), faceLen: r3(faceLen), ipd: r3(ipd), skullW: r3(skullW),
      headTopWithHair: r3(top), headWidthWithHair: r3(maxX - minX), faceLenToBody: r3(faceLen / neckTop.y), ipdToBody: r3(ipd / neckTop.y), skullWToBody: r3(skullW / neckTop.y), wholeHeadToBody: r3((top - chin.y) / neckTop.y) };
  });
}

// ---- panel ----
const panel = document.getElementById("panel")!;
const el = (tag: string, text = "", cls = "") => { const e = document.createElement(tag); e.textContent = text; if (cls) e.className = cls; return e; };
const rows: { b: HTMLButtonElement; on: () => boolean }[] = [];
function group(title: string, items: [string, () => unknown, () => boolean][]): void {
  panel.append(el("h2", title)); const r = el("div", "", "row");
  for (const [label, act, on] of items) { const b = el("button", label) as HTMLButtonElement; b.onclick = () => { act(); for (const x of rows) x.b.classList.toggle("on", x.on()); }; r.append(b); rows.push({ b, on }); }
  panel.append(r);
}
panel.append(el("h1", `HumanBase · lineup (${IDS?.length ? "custom" : SET}${CANDIDATE.size ? ` · candidate: ${[...CANDIDATE.keys()].join(", ")}` : ""})`), el("p", `${ORDER.join(" · ")} — the production appearance (humanBodyFor → createHumanBody). Head mounts ${MOUNTS ? "ON" : "OFF (?mount=0)"}. Green rule = ${H} units (standing height).`, "sub"));
const go = (patch: Record<string, string | null>) => { const q = new URLSearchParams(location.search); for (const [k, v] of Object.entries(patch)) { if (v === null) q.delete(k); else q.set(k, v); } location.search = q.toString(); };
group("Set", Object.keys(SETS).map((n) => [n, () => go({ set: n }), () => SET === n]));
group("View", Object.keys(VIEWS).map((n) => [n, () => view(n), () => currentView === n]));
group("Turn all in place", [0, 45, 90, 135, 180, -90].map((d) => [`${d}°`, () => turn(d), () => turnDeg === d]));
group("Behaviour", Object.keys(MODES).map((m) => [m, () => setMode(m), () => mode === m]));
group("Head mounts", [["on", () => go({ mount: null }), () => MOUNTS], ["off (as authored)", () => go({ mount: "0" }), () => !MOUNTS]]);
const st = el("div"); st.id = "stats"; panel.append(st);
group("Measure", [["proportions (this pose)", () => { st.textContent = JSON.stringify(measure(), null, 1); }, () => false]]);
for (const x of rows) x.b.classList.toggle("on", x.on());

view(currentView); setMode(mode); turn(turnDeg);
const clock = new THREE.Clock();
let paused = false;
renderer.setAnimationLoop(() => {
  const dt = paused ? 0 : Math.min(0.05, clock.getDelta());
  for (const { body } of bodies) body.human.update(dt);
  if (controls.enabled) controls.update();
  renderer.render(scene, camera);
});
Object.assign(window, { __lineup: { view, setMode, measure, turn, ready: true, pause: (p: boolean) => { paused = p; }, step: (dt: number) => { for (const { body } of bodies) body.human.update(dt); } } });

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { appearanceFor, candidateAppearance, createHumanBody, HUMANBASE_CATALOGUE, humanBodyFor, identityHeadAsset, type HumanBody } from "../../../dev/vo3d/avatar/humanBody";
import { newEmployeeAvatar } from "../../../dev/vo3d/human/humanCatalogue";
import { CLIP_IDLE, CLIP_TALK_AGREE, CLIP_TALK_LISTEN, CLIP_WALK } from "../../../dev/vo3d/adapters/v1Avatar";
import type { EmployeeAvatar } from "../../../dev/vo3d/human/humanBaseContract";
import type { StudioCandidate } from "../../../services/humanbase/characterStudio";
import type { OutfitSlot } from "../../../dev/vo3d/avatar/characterRuntime";

// HUMANBASE PREVIEW — the production HumanBase body (createHumanBody: the same rig, clips and wardrobe the office uses) in a small
// studio stage. Three subjects:
//   base      — the generic CANONICAL head on the shared body, drawn as a restrained hologram: a placeholder, never presented as the
//               employee (the caller labels it "base character")
//   candidate — the employee's own generated head (their candidate file) at the mount its gate validated; with `reveal` the hologram
//               cross-fades into it once.
//   approved  — the employee's APPROVED appearance exactly as the office draws it (humanBodyFor: promoted or runtime-delivered head,
//               its mount and preset, and their saved outfit) — what VIEW shows and EDIT dresses.
// Wardrobe changes recolour live (HumanAvatar.setColorway); a different garment rebuilds the body. Nothing here is written anywhere.
export type PreviewSubject = { kind: "base" } | { kind: "approved"; personId: string } | { kind: "candidate"; personId: string; url: string; candidate: StudioCandidate };
export type PreviewOutfit = Partial<Record<OutfitSlot, { assetId: string; colorway: string }>>;
export type PreviewPose = "idle" | "agree" | "listening" | "walking";
/** studio: its own stage and contact shadow (CREATE / EDIT); profile: fills the Profile's .model box, feet on its bottom edge, and
 *  leaves the floor shadow to the Profile stage (ProfileCharacter.module.css) — the VIEW framing */
type Framing = "studio" | "profile";
type Props = { subject: PreviewSubject; reveal?: boolean; headingDegrees: number; pose: PreviewPose; outfit?: PreviewOutfit; width?: number; height?: number; framing?: Framing; onError?: (e: unknown) => void; onReady?: () => void };
/** the Profile's poses → VO's clip names (the HumanBase library speaks them); a clip the library lacks falls back to the idle */
const CLIP_FOR: Record<PreviewPose, string> = { idle: CLIP_IDLE, agree: CLIP_TALK_AGREE, listening: CLIP_TALK_LISTEN, walking: CLIP_WALK };
const playPose = (b: HumanBody | null, pose: PreviewPose, fade = 0.25) => { if (!b) return; const voName = b.action(CLIP_FOR[pose]) ? CLIP_FOR[pose] : CLIP_IDLE; b.human.play(b.clipName(voName), fade); };

const BASE_HEAD = `${import.meta.env.BASE_URL}avatars/human-base-v1/identity/canonical-head-v1.glb`;
const REVEAL_SECONDS = 1.8;

function withOutfit(cfg: EmployeeAvatar, outfit?: PreviewOutfit): EmployeeAvatar {
  const c = { ...cfg } as EmployeeAvatar & Record<OutfitSlot, { assetId: string; colorway: string }>;
  for (const slot of ["top", "bottom", "shoes"] as const) if (outfit?.[slot]) c[slot] = { ...outfit[slot]! };
  return c;
}
async function buildBody(subject: PreviewSubject, outfit?: PreviewOutfit): Promise<HumanBody> {
  if (subject.kind === "base") {
    const cfg = withOutfit(newEmployeeAvatar("hb-base", "standard"), outfit);
    return createHumanBody(cfg, new Map(HUMANBASE_CATALOGUE).set("humanbase:hb-base", identityHeadAsset("hb-base", BASE_HEAD)));
  }
  if (subject.kind === "approved") { const a = humanBodyFor(subject.personId) ?? appearanceFor(subject.personId); if (!a) throw new Error(`no approved HumanBase appearance for ${subject.personId}`); return createHumanBody(withOutfit(a, outfit)); }
  const { personId, url, candidate: c } = subject;
  const rec = { [personId]: { artifactHash: c.artifactHash, pipelineVersion: c.pipelineVersion, mount: c.mount, bindingHash: c.bindingHash, validatedAt: c.builtAt, bodyPreset: c.bodyPreset } };
  const cfg = withOutfit(candidateAppearance(personId, rec, c.bodyPreset), outfit);
  return createHumanBody(cfg, new Map(HUMANBASE_CATALOGUE).set(`humanbase:${personId}`, identityHeadAsset(personId, url)));
}
/** a restrained hologram: translucent cool tint, a faint scan pattern, no bloom */
function hologram(root: THREE.Object3D, stripes: THREE.Texture): THREE.Material[] {
  const mats: THREE.Material[] = [];
  root.traverse((o) => { const m = o as THREE.Mesh; if (!m.isMesh) return;
    const h = new THREE.MeshStandardMaterial({ color: 0x9fe3f0, emissive: 0x2a9fbd, emissiveIntensity: 0.35, roughness: 0.4, metalness: 0, transparent: true, opacity: 0.42, depthWrite: false, alphaMap: stripes, side: THREE.DoubleSide });
    m.material = h; mats.push(h); });
  return mats;
}
function setOpacity(root: THREE.Object3D, a: number, done = false): void {
  root.traverse((o) => { const m = o as THREE.Mesh; if (!m.isMesh) return; for (const mat of Array.isArray(m.material) ? m.material : [m.material]) {
    const mm = mat as THREE.Material & { userData: { o?: number; t?: boolean } }; if (mm.userData.o === undefined) { mm.userData.o = mm.opacity; mm.userData.t = mm.transparent; }
    mm.transparent = done ? !!mm.userData.t : true; mm.opacity = done ? mm.userData.o! : mm.userData.o! * a; mm.needsUpdate = true; } });
}

export function HumanBasePreview({ subject, reveal = false, headingDegrees, pose, outfit, width = 360, height = 420, framing = "studio", onError, onReady }: Props) {
  const host = useRef<HTMLDivElement>(null), heading = useRef(headingDegrees), poseRef = useRef(pose), live = useRef<{ body: HumanBody | null; holo: HumanBody | null; outfitKey: string }>({ body: null, holo: null, outfitKey: "" });
  heading.current = headingDegrees;
  const subjectKey = subject.kind === "base" ? "base" : subject.kind === "approved" ? `approved|${subject.personId}` : `${subject.personId}|${subject.url}|${subject.candidate.artifactHash}`, outfitAssets = JSON.stringify(Object.fromEntries(Object.entries(outfit ?? {}).map(([k, v]) => [k, v?.assetId])));

  useEffect(() => {
    const el = host.current; if (!el) return; let disposed = false, raf = 0, revealT = reveal && subject.kind === "candidate" ? 0 : -1;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true }); renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2)); renderer.setSize(width, height); renderer.outputColorSpace = THREE.SRGBColorSpace; el.appendChild(renderer.domElement);
    const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(26, width / height, 1, 2000);
    // the body is 36 world units tall with its feet on y = 0 (HUMAN_STANDING_HEIGHT); profile: the figure fills ~85% of the box height
    if (framing === "profile") { camera.position.set(0, 19.9, 91.8); camera.lookAt(0, 19.9, 0); } else { camera.position.set(0, 24, 108); camera.lookAt(0, 19, 0); }
    scene.add(new THREE.HemisphereLight(0xffffff, 0xe9e6dd, 0.95)); const key = new THREE.DirectionalLight(0xffffff, 1.25); key.position.set(30, 60, 55); scene.add(key); const rim = new THREE.DirectionalLight(0xdfe9ff, 0.55); rim.position.set(-45, 40, -60); scene.add(rim);
    const shadowTex = (() => { const c = document.createElement("canvas"); c.width = c.height = 128; const g = c.getContext("2d")!; const r = g.createRadialGradient(64, 64, 4, 64, 64, 64); r.addColorStop(0, "rgba(40,48,40,0.32)"); r.addColorStop(1, "rgba(40,48,40,0)"); g.fillStyle = r; g.fillRect(0, 0, 128, 128); return new THREE.CanvasTexture(c); })();
    const ground = new THREE.Mesh(new THREE.CircleGeometry(15, 48), new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false })); ground.rotation.x = -Math.PI / 2; ground.visible = framing === "studio"; scene.add(ground);
    const stripes = (() => { const c = document.createElement("canvas"); c.width = 4; c.height = 64; const g = c.getContext("2d")!; for (let y = 0; y < 64; y++) { const v = 200 + 55 * Math.round(0.5 + 0.5 * Math.sin(y * 0.8)); g.fillStyle = `rgb(${v},${v},${v})`; g.fillRect(0, y, 4, 1); } const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(1, 18); return t; })();
    const play = (b: HumanBody | null) => playPose(b, poseRef.current);
    (async () => {
      try {
        if (revealT === 0 || subject.kind === "base") { const holo = await buildBody({ kind: "base" }, outfit); if (disposed) { holo.human.dispose(); return; } hologram(holo.human.root, stripes); scene.add(holo.human.root); live.current.holo = holo; play(holo); }
        if (subject.kind !== "base") { const body = await buildBody(subject, outfit); if (disposed) { body.human.dispose(); return; } if (revealT === 0) setOpacity(body.human.root, 0); scene.add(body.human.root); live.current.body = body; play(body); }
        live.current.outfitKey = outfitAssets; onReady?.();
      } catch (e) { if (!disposed) onError?.(e); }
    })();
    let last = performance.now();
    const tick = (now: number) => { const dt = Math.min(0.1, (now - last) / 1000); last = now; const yaw = (heading.current * Math.PI) / 180, { body, holo } = live.current;
      stripes.offset.y = (stripes.offset.y + dt * 0.05) % 1;
      for (const b of [holo, body]) if (b) { b.human.root.rotation.y = yaw; b.human.update(dt); }
      if (revealT >= 0 && body && holo) { revealT += dt / REVEAL_SECONDS; const t = Math.min(1, revealT), e = t * t * (3 - 2 * t);
        setOpacity(body.human.root, e, t >= 1); holo.human.root.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) (m.material as THREE.Material).opacity = 0.42 * (1 - e); });
        if (t >= 1) { scene.remove(holo.human.root); holo.human.dispose(); live.current.holo = null; revealT = -1; } }
      renderer.render(scene, camera); raf = requestAnimationFrame(tick); };
    raf = requestAnimationFrame(tick);
    return () => { disposed = true; cancelAnimationFrame(raf); for (const b of [live.current.body, live.current.holo]) b?.human.dispose(); live.current = { body: null, holo: null, outfitKey: "" };
      shadowTex.dispose(); stripes.dispose(); renderer.dispose(); renderer.domElement.remove(); };
    // a new subject or a different garment rebuilds; colours alone recolour live below
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subjectKey, outfitAssets, width, height, framing]);

  useEffect(() => { poseRef.current = pose; const { body, holo } = live.current; for (const b of [body, holo]) playPose(b, pose); }, [pose]);
  useEffect(() => { const b = live.current.body ?? live.current.holo; if (!b || !outfit) return; for (const slot of ["top", "bottom", "shoes"] as const) if (outfit[slot]) { try { b.human.setColorway(slot, outfit[slot]!.colorway); } catch { /* an unknown colourway keeps the garment's current one */ } } }, [outfit]);

  return <div ref={host} style={{ width, height }} data-testid="humanbase-preview" data-subject={subject.kind} />;
}

export default HumanBasePreview;

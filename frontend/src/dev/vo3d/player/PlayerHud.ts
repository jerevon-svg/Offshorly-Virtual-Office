// vo3d player — the smallest possible on-screen affordance: a crosshair, a prompt line, and a floor ring
// under whatever is currently targeted.
//
// Deliberately NOT product UI. Three DOM nodes and one reused mesh, created when PLAYER is entered and
// destroyed when it is left, so nothing of it exists in OFFICE or EXPLORE. When the real product HUD
// arrives it replaces this file and nothing else.
import * as THREE from "three";

export class PlayerHud {
  private readonly root: HTMLDivElement;
  private readonly crosshair: HTMLDivElement;
  private readonly prompt: HTMLDivElement;
  /** one ring, moved to the target — never rebuilt, never traversed for */
  readonly marker: THREE.Mesh;
  /** INTERACTION V2 — WHERE TO STAND for a walk-up fixture (the lift's call plate, a kiosk): a small filled disc
   *  on the stand spot, shown only while that fixture is targeted or just out of reach. A child of `marker`'s
   *  parent, moved — never rebuilt. */
  readonly standMarker: THREE.Mesh;
  private shownLabel = "";
  /** PHASE 7E — suppressed while a modal owns the screen. The prompt is drawn at the centre of the
   *  viewport, which is exactly where a modal's primary button sits, so the two collide. Only the prompt
   *  is affected: the crosshair and the floor ring are unchanged. */
  private promptHidden = false;

  constructor(parent: HTMLElement) {
    this.root = document.createElement("div");
    this.root.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:5;font:13px/1.4 system-ui,sans-serif;";
    this.crosshair = document.createElement("div");
    this.crosshair.style.cssText =
      "position:absolute;left:50%;top:50%;width:6px;height:6px;margin:-3px 0 0 -3px;border-radius:50%;" +
      "background:rgba(255,255,255,0.85);box-shadow:0 0 0 1.5px rgba(0,0,0,0.35);";
    this.prompt = document.createElement("div");
    this.prompt.style.cssText =
      "position:absolute;left:50%;top:calc(50% + 26px);transform:translateX(-50%);padding:5px 11px;border-radius:14px;" +
      "background:rgba(20,18,16,0.62);color:#fff;white-space:nowrap;opacity:0;transition:opacity 120ms;";
    this.root.append(this.crosshair, this.prompt);
    parent.appendChild(this.root);

    const geo = new THREE.RingGeometry(9, 12.5, 40);
    geo.rotateX(-Math.PI / 2);
    this.marker = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0x8fd8ff, transparent: true, opacity: 0.55, depthWrite: false, toneMapped: false }));
    this.marker.name = "player-target-marker";
    this.marker.visible = false;
    this.marker.renderOrder = 5;
    const disc = new THREE.CircleGeometry(7, 32);
    disc.rotateX(-Math.PI / 2);
    this.standMarker = new THREE.Mesh(disc, new THREE.MeshBasicMaterial({ color: 0x8fd8ff, transparent: true, opacity: 0.32, depthWrite: false, toneMapped: false }));
    this.standMarker.name = "player-stand-marker";
    this.standMarker.visible = false;
    this.standMarker.renderOrder = 5;
    // riding WITH the ring: one parent, so entering and leaving the mode attaches and detaches both together
    this.marker.add(this.standMarker);
  }
  /** the stand disc is a child of the ring; place it in WORLD terms */
  private placeStand(at: { x: number; z: number } | null): void {
    this.standMarker.visible = at !== null;
    if (!at) return;
    if (this.marker.visible) this.standMarker.position.set(at.x - this.marker.position.x, 0, at.z - this.marker.position.z);
    else this.standMarker.position.set(at.x - this.marker.position.x, 0.6 - this.marker.position.y, at.z - this.marker.position.z);
  }

  /** `label` null = nothing targeted. Writes only when the text actually changed. */
  setTarget(label: string | null, at: { x: number; z: number } | null, more = false, stand: { x: number; z: number } | null = null): void {
    const text = label ? `[E] ${label}${more ? "   ·   Tab: next" : ""}` : "";
    if (text !== this.shownText || (label ?? "") !== this.shownLabel) {
      this.shownLabel = label ?? "";
      this.shownText = text;
      this.prompt.textContent = text;
      this.applyPromptOpacity(label ? "1" : "0");
    }
    if (at) this.marker.position.set(at.x, 0.6, at.z);
    // the ring is a PARENT (the stand disc rides it): hidden = drawn at zero opacity, so a hint's disc still shows
    (this.marker.material as THREE.MeshBasicMaterial).opacity = at ? 0.55 : 0;
    this.marker.visible = at !== null || stand !== null;
    this.placeStand(stand);
  }
  private shownText = "";
  /** the crosshair is only honest while the pointer is captured */
  setLocked(locked: boolean): void {
    this.crosshair.style.opacity = locked ? "1" : "0.25";
  }
  setHint(text: string, stand: { x: number; z: number } | null = null): void {
    if (this.shownLabel) return;
    if (text !== this.shownText) { this.shownText = text; this.prompt.textContent = text; }
    this.applyPromptOpacity(text ? "0.8" : "0");
    // the stand spot of the fixture being hinted at: the ring (its parent) is parked on it, drawn invisibly
    if (stand) { this.marker.position.set(stand.x, 0.6, stand.z); (this.marker.material as THREE.MeshBasicMaterial).opacity = 0; this.marker.visible = true; this.placeStand(stand); }
    else if (!this.shownLabel) { this.marker.visible = false; this.placeStand(null); }
  }
  /** PHASE 7E — hide or restore the prompt line. Idempotent, and it remembers what the prompt WOULD be
   *  showing, so un-hiding restores the live target rather than a stale or blank line. */
  setPromptHidden(hidden: boolean): void {
    if (hidden === this.promptHidden) return;
    this.promptHidden = hidden;
    this.applyPromptOpacity(this.naturalOpacity);
  }
  /** The opacity the prompt would have if nothing were suppressing it. */
  private naturalOpacity = "0";
  private applyPromptOpacity(next: string): void {
    this.naturalOpacity = next;
    this.prompt.style.opacity = this.promptHidden ? "0" : next;
  }
  dispose(): void {
    this.root.remove();
    this.marker.visible = false;
    this.marker.geometry.dispose();
    (this.marker.material as THREE.Material).dispose();
    this.standMarker.geometry.dispose();
    (this.standMarker.material as THREE.Material).dispose();
  }
}

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
  }

  /** `label` null = nothing targeted. Writes only when the text actually changed. */
  setTarget(label: string | null, at: { x: number; z: number } | null): void {
    if (label !== this.shownLabel) {
      this.shownLabel = label ?? "";
      this.prompt.textContent = label ? `[E] ${label}` : "";
      this.applyPromptOpacity(label ? "1" : "0");
    }
    if (at) this.marker.position.set(at.x, 0.6, at.z);
    this.marker.visible = at !== null;
  }
  /** the crosshair is only honest while the pointer is captured */
  setLocked(locked: boolean): void {
    this.crosshair.style.opacity = locked ? "1" : "0.25";
  }
  setHint(text: string): void {
    if (this.shownLabel) return;
    this.prompt.textContent = text;
    this.applyPromptOpacity(text ? "0.8" : "0");
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
  }
}

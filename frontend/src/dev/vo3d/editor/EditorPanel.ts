// vo3d editor — the designer-facing panel. DOM only: it renders state and reports intent, it owns none.
//
// Built the way player/PlayerHud is built — created when EDIT is entered, destroyed when it is left, so
// nothing of it exists in OFFICE, EXPLORE or PLAYER. Styling follows the VO surface language already used
// across the 3D overlays: a dark translucent card, hairline borders, one amber accent, compact rows.
//
// SLICE 2 gives it FOUR MODES and shows exactly one at a time — Object, Assets, Surface, Lighting. That is
// a deliberate designer-facing choice rather than a developer one: a panel that shows a transform, a
// catalogue, a material and a light channel at once is a debug inspector, and this is meant to be a tool
// you art-direct a room with. The bottom third — undo/redo, confirm/cancel/reset — is shared by all four,
// because those mean the same thing in every mode.
import { ASSET_CATEGORIES, itemsIn, type AssetCategory } from "./library";
import { SURFACE_PRESETS, type SurfaceKind, type SurfacePresetId, type SurfaceSpec } from "./surfaces";
import { LED_COLORS, type EmissiveSpec } from "./emissive";
import { PALETTE } from "../render/Materials";

export type PanelMode = "object" | "assets" | "surface" | "lighting";
export const PANEL_MODES: { id: PanelMode; label: string }[] = [
  { id: "object", label: "Object" }, { id: "assets", label: "Assets" },
  { id: "surface", label: "Surface" }, { id: "lighting", label: "Lighting" },
];

export type PanelActions = {
  setMode: (m: PanelMode) => void;
  setAxis: (axis: "x" | "z", value: number) => void;
  setYaw: (deg: number) => void;
  nudgeYaw: (deg: number) => void;
  setSnap: (on: boolean) => void;
  duplicate: () => void;
  remove: () => void;
  pickAsset: (key: string | null) => void;
  pickSurface: (id: string) => void;
  setSurface: (spec: SurfaceSpec) => void;
  pickLed: (id: string) => void;
  setLed: (spec: EmissiveSpec) => void;
  undo: () => void;
  redo: () => void;
  confirm: () => void;
  cancel: () => void;
  reset: () => void;
  close: () => void;
};
export type PanelState = {
  mode: PanelMode;
  name: string | null;
  room: string;
  x: number;
  z: number;
  yaw: number;
  snap: boolean;
  snapStep: number;
  snapDegrees: number;
  status: string;
  valid: boolean;
  pending: boolean;
  canUndo: boolean;
  canRedo: boolean;
  hint: string;
  /** null = deletable; otherwise why not */
  deleteBlocked: string | null;
  /** the armed library item, if any */
  assetKey: string | null;
  surfaces: { id: string; label: string; kind: SurfaceKind }[];
  surfaceId: string | null;
  surfaceSpec: SurfaceSpec | null;
  leds: { id: string; label: string }[];
  ledId: string | null;
  ledSpec: EmissiveSpec | null;
};

const CARD =
  // bottom-LEFT and above lil-gui's stacking context: the dev GUI owns the right edge and would
  // otherwise sit on top of this card, and the harness status strip owns the last ~26px of the page.
  "position:fixed;left:16px;bottom:42px;z-index:1002;width:262px;box-sizing:border-box;padding:12px 13px 11px;" +
  "border-radius:14px;background:rgba(18,17,16,0.82);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);" +
  "border:1px solid rgba(255,255,255,0.10);box-shadow:0 12px 34px rgba(0,0,0,0.42);color:#f4f1ec;" +
  "font:12px/1.45 system-ui,-apple-system,sans-serif;user-select:none;";
const FIELD =
  "width:100%;box-sizing:border-box;padding:5px 7px;border-radius:8px;border:1px solid rgba(255,255,255,0.12);" +
  "background:rgba(255,255,255,0.06);color:#f4f1ec;font:12px/1.2 ui-monospace,SFMono-Regular,monospace;";
const BTN =
  "flex:1;padding:6px 0;border-radius:9px;border:1px solid rgba(255,255,255,0.12);background:rgba(255,255,255,0.07);" +
  "color:#f4f1ec;font:600 11.5px/1 system-ui,sans-serif;cursor:pointer;";
const LABEL = "display:block;margin:0 0 3px;font-size:10px;letter-spacing:0.06em;text-transform:uppercase;opacity:0.5;";
const AMBER = "rgba(242,177,52,";
const LIST = "max-height:126px;overflow-y:auto;margin-bottom:8px;display:flex;flex-direction:column;gap:3px;";
const ROW = "display:flex;gap:6px;margin-bottom:8px;";

function el<K extends keyof HTMLElementTagNameMap>(tag: K, css: string, text?: string): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag);
  n.style.cssText = css;
  if (text !== undefined) n.textContent = text;
  return n;
}
/** a compact labelled slider — the whole numeric vocabulary of the Surface and Lighting tabs */
function slider(label: string, min: number, max: number, step: number, onInput: (v: number) => void): { root: HTMLDivElement; input: HTMLInputElement; read: HTMLSpanElement } {
  const root = el("div", "margin-bottom:7px;");
  const head = el("div", "display:flex;justify-content:space-between;align-items:baseline;");
  head.append(el("span", LABEL + "margin:0;", label));
  const read = el("span", "font:11px/1 ui-monospace,monospace;opacity:0.65;", "—");
  head.append(read);
  const input = el("input", "width:100%;margin:3px 0 0;accent-color:#f2b134;") as HTMLInputElement;
  input.type = "range";
  input.min = String(min); input.max = String(max); input.step = String(step);
  input.oninput = () => onInput(Number(input.value));
  root.append(head, input);
  return { root, input, read };
}
const styleToggle = (b: HTMLElement, on: boolean): void => {
  b.style.background = on ? `${AMBER}0.22)` : "rgba(255,255,255,0.07)";
  b.style.borderColor = on ? `${AMBER}0.5)` : "rgba(255,255,255,0.12)";
};

export class EditorPanel {
  private readonly root: HTMLDivElement;
  private readonly title: HTMLDivElement;
  private readonly sub: HTMLDivElement;
  private readonly chip: HTMLDivElement;
  private readonly hint: HTMLDivElement;
  private readonly modeBtns = new Map<PanelMode, HTMLButtonElement>();
  private readonly panes: Record<PanelMode, HTMLDivElement>;
  private readonly fields: Record<"x" | "z" | "yaw", HTMLInputElement>;
  private readonly snapBtn: HTMLButtonElement;
  private readonly dupBtn: HTMLButtonElement;
  private readonly delBtn: HTMLButtonElement;
  private readonly undoBtn: HTMLButtonElement;
  private readonly redoBtn: HTMLButtonElement;
  private readonly confirmBtn: HTMLButtonElement;
  // assets
  private readonly catRow: HTMLDivElement;
  private readonly assetList: HTMLDivElement;
  private category: AssetCategory = "Desks";
  // surface
  private readonly surfaceList: HTMLDivElement;
  private readonly presetRow: HTMLDivElement;
  private readonly colorInput: HTMLInputElement;
  private readonly sBright: ReturnType<typeof slider>;
  private readonly sRough: ReturnType<typeof slider>;
  private readonly sDetail: ReturnType<typeof slider>;
  // lighting
  private readonly ledList: HTMLDivElement;
  private readonly ledSwatches: HTMLDivElement;
  private readonly lInten: ReturnType<typeof slider>;
  private readonly lGlow: ReturnType<typeof slider>;

  private editing: HTMLInputElement | null = null;
  private dragging = false;
  private snapOn = false;
  private surfaceSpec: SurfaceSpec | null = null;
  private ledSpec: EmissiveSpec | null = null;
  private readonly a: PanelActions;

  constructor(parent: HTMLElement, a: PanelActions) {
    this.a = a;
    this.root = el("div", CARD);

    const head = el("div", "display:flex;align-items:center;gap:8px;margin-bottom:8px;");
    const titleWrap = el("div", "flex:1;min-width:0;");
    this.title = el("div", "font:600 12.5px/1.2 system-ui,sans-serif;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;", "Nothing selected");
    this.sub = el("div", "font-size:10px;opacity:0.45;margin-top:1px;", "click a piece to select");
    titleWrap.append(this.title, this.sub);
    const close = el("button", BTN + "flex:0 0 auto;width:24px;padding:4px 0;opacity:0.7;", "✕");
    close.onclick = a.close;
    head.append(titleWrap, close);

    const modeRow = el("div", "display:flex;gap:4px;margin-bottom:9px;");
    for (const m of PANEL_MODES) {
      const b = el("button", BTN + "padding:5px 0;font-size:11px;", m.label);
      b.onclick = () => a.setMode(m.id);
      this.modeBtns.set(m.id, b);
      modeRow.append(b);
    }

    this.chip = el("div", "margin-bottom:9px;padding:4px 8px;border-radius:7px;font-size:10.5px;letter-spacing:0.02em;", "—");

    // ---- OBJECT ------------------------------------------------------------------------------------
    const object = el("div", "");
    const row = el("div", ROW);
    const mk = (key: "x" | "z" | "yaw", label: string, step: number): HTMLInputElement => {
      const cell = el("div", "flex:1;min-width:0;");
      cell.append(el("span", LABEL, label));
      const input = el("input", FIELD) as HTMLInputElement;
      input.type = "number";
      input.step = String(step);
      input.onfocus = () => (this.editing = input);
      input.onblur = () => (this.editing = null);
      const push = (): void => {
        const v = Number(input.value);
        if (!Number.isFinite(v)) return;
        if (key === "yaw") a.setYaw(v);
        else a.setAxis(key, v);
      };
      input.oninput = push;
      input.onkeydown = (ev) => { if (ev.key === "Enter") { push(); input.blur(); } ev.stopPropagation(); };
      cell.append(input);
      row.append(cell);
      return input;
    };
    this.fields = { x: mk("x", "X", 1), z: mk("z", "Z", 1), yaw: mk("yaw", "Rot °", 15) };

    const turnRow = el("div", ROW);
    for (const d of [-90, -15, 15, 90]) {
      const b = el("button", BTN, `${d > 0 ? "+" : "−"}${Math.abs(d)}°`);
      b.onclick = () => a.nudgeYaw(d);
      turnRow.append(b);
    }
    this.snapBtn = el("button", BTN + "margin-bottom:8px;width:100%;", "Grid snap");
    this.snapBtn.onclick = () => a.setSnap(!this.snapOn);

    const objActs = el("div", ROW);
    this.dupBtn = el("button", BTN, "⧉ Duplicate");
    this.delBtn = el("button", BTN, "🗑 Delete");
    this.dupBtn.onclick = a.duplicate;
    this.delBtn.onclick = a.remove;
    objActs.append(this.dupBtn, this.delBtn);
    object.append(row, turnRow, this.snapBtn, objActs);

    // ---- ASSETS ------------------------------------------------------------------------------------
    const assets = el("div", "");
    this.catRow = el("div", "display:flex;flex-wrap:wrap;gap:4px;margin-bottom:8px;");
    for (const c of ASSET_CATEGORIES) {
      const b = el("button", BTN + "flex:0 0 auto;padding:4px 7px;font-size:10.5px;", c);
      b.onclick = () => { this.category = c; this.renderAssets(); };
      this.catRow.append(b);
    }
    this.assetList = el("div", LIST);
    assets.append(this.catRow, this.assetList);

    // ---- SURFACE -----------------------------------------------------------------------------------
    const surface = el("div", "");
    this.surfaceList = el("div", LIST + "max-height:84px;");
    this.presetRow = el("div", "display:flex;flex-wrap:wrap;gap:4px;margin-bottom:8px;");
    const colorCell = el("div", "display:flex;align-items:center;gap:7px;margin-bottom:8px;");
    colorCell.append(el("span", LABEL + "margin:0;flex:1;", "Colour"));
    this.colorInput = el("input", "width:46px;height:24px;padding:0;border:1px solid rgba(255,255,255,0.14);border-radius:7px;background:none;cursor:pointer;") as HTMLInputElement;
    this.colorInput.type = "color";
    this.colorInput.oninput = () => this.pushSurface({ color: parseInt(this.colorInput.value.slice(1), 16) });
    colorCell.append(this.colorInput);
    this.sBright = slider("Brightness", 0.5, 1.5, 0.01, (v) => this.pushSurface({ brightness: v }));
    this.sRough = slider("Roughness", 0.04, 1, 0.01, (v) => this.pushSurface({ roughness: v }));
    this.sDetail = slider("Surface detail", 0, 1, 0.05, (v) => this.pushSurface({ detail: v }));
    surface.append(this.surfaceList, this.presetRow, colorCell, this.sBright.root, this.sRough.root, this.sDetail.root);

    // ---- LIGHTING ----------------------------------------------------------------------------------
    const lighting = el("div", "");
    this.ledList = el("div", LIST + "max-height:84px;");
    this.ledSwatches = el("div", "display:flex;flex-wrap:wrap;gap:5px;margin-bottom:9px;");
    for (const key of LED_COLORS) {
      const hex = PALETTE[key];
      const b = el("button", "width:20px;height:20px;padding:0;border-radius:6px;cursor:pointer;border:1px solid rgba(255,255,255,0.18);");
      b.style.background = `#${hex.toString(16).padStart(6, "0")}`;
      b.title = key;
      b.onclick = () => this.pushLed({ color: hex });
      this.ledSwatches.append(b);
    }
    this.lInten = slider("Emissive intensity", 0, 3, 0.05, (v) => this.pushLed({ intensity: v }));
    this.lGlow = slider("Glow strength", 0, 1, 0.01, (v) => this.pushLed({ glow: v }));
    lighting.append(this.ledList, this.ledSwatches, this.lInten.root, this.lGlow.root);

    this.panes = { object, assets, surface, lighting };

    // ---- shared footer -----------------------------------------------------------------------------
    const histRow = el("div", ROW);
    this.undoBtn = el("button", BTN, "↶ Undo");
    this.redoBtn = el("button", BTN, "↷ Redo");
    this.undoBtn.onclick = a.undo;
    this.redoBtn.onclick = a.redo;
    histRow.append(this.undoBtn, this.redoBtn);

    const actRow = el("div", "display:flex;gap:6px;");
    this.confirmBtn = el("button", BTN + `background:${AMBER}0.85);border-color:${AMBER}0.9);color:#1a1509;`, "✔ Confirm");
    const cancelBtn = el("button", BTN, "Cancel");
    const resetBtn = el("button", BTN + "flex:0 0 auto;padding:6px 8px;opacity:0.75;", "Reset");
    this.confirmBtn.onclick = a.confirm;
    cancelBtn.onclick = a.cancel;
    resetBtn.onclick = a.reset;
    actRow.append(this.confirmBtn, cancelBtn, resetBtn);

    this.hint = el("div", "margin-top:8px;font-size:10px;opacity:0.42;line-height:1.35;",
      "drag piece · drag ring to rotate · ⏎ confirm · esc cancel · ⌘Z undo");

    this.root.append(head, modeRow, this.chip, object, assets, surface, lighting, histRow, actRow, this.hint);
    this.renderAssets();
    parent.appendChild(this.root);
  }

  /** a slider drag must not have its own value written back under the finger mid-gesture */
  private guardDrag(input: HTMLInputElement): void {
    input.onpointerdown = () => (this.dragging = true);
    input.onpointerup = () => (this.dragging = false);
  }
  private pushSurface(patch: Partial<SurfaceSpec>): void {
    if (!this.surfaceSpec) return;
    this.surfaceSpec = { ...this.surfaceSpec, ...patch };
    this.a.setSurface(this.surfaceSpec);
  }
  private pushLed(patch: Partial<EmissiveSpec>): void {
    if (!this.ledSpec) return;
    this.ledSpec = { ...this.ledSpec, ...patch };
    this.a.setLed(this.ledSpec);
  }
  private renderAssets(): void {
    for (const b of Array.from(this.catRow.children) as HTMLElement[]) styleToggle(b, b.textContent === this.category);
    this.assetList.replaceChildren();
    for (const item of itemsIn(this.category)) {
      const key = `${item.kind}:${item.label}`;
      const b = el("button", BTN + "flex:0 0 auto;text-align:left;padding:5px 8px;font-weight:500;", item.label);
      b.dataset.assetKey = key;
      b.onclick = () => this.a.pickAsset(this.armed === key ? null : key);
      this.assetList.append(b);
    }
    this.paintArmed();
  }
  private armed: string | null = null;
  private paintArmed(): void {
    for (const b of Array.from(this.assetList.children) as HTMLElement[]) styleToggle(b, b.dataset.assetKey === this.armed);
  }

  /** idempotent render; a focused numeric field and a slider under the finger are never overwritten */
  render(s: PanelState): void {
    this.title.textContent = s.name ?? (s.mode === "surface" ? "Surface" : s.mode === "lighting" ? "Lighting" : s.mode === "assets" ? "Asset library" : "Nothing selected");
    this.sub.textContent = s.name ? s.room : s.mode === "assets" ? "pick an asset, then click the floor" : "click a piece to select";
    for (const [id, b] of this.modeBtns) styleToggle(b, id === s.mode);
    for (const [id, pane] of Object.entries(this.panes) as [PanelMode, HTMLDivElement][]) pane.hidden = id !== s.mode;

    const neutral = !s.name && s.mode === "object";
    const tone = neutral ? "rgba(255,255,255,0.07)" : s.valid ? "rgba(96,190,120,0.16)" : "rgba(217,70,59,0.22)";
    const ink = neutral ? "rgba(244,241,236,0.5)" : s.valid ? "#9fe0b1" : "#ffb3ab";
    this.chip.style.background = tone;
    this.chip.style.color = ink;
    this.chip.textContent = s.status;

    // ---- object ------------------------------------------------------------------------------------
    this.panes.object.style.opacity = s.name ? "1" : "0.38";
    this.panes.object.style.pointerEvents = s.name ? "auto" : "none";
    const write = (i: HTMLInputElement, v: number): void => { if (this.editing !== i) i.value = String(Math.round(v * 100) / 100); };
    write(this.fields.x, s.x); write(this.fields.z, s.z); write(this.fields.yaw, s.yaw);
    this.snapOn = s.snap;
    this.snapBtn.textContent = s.snap ? `Grid snap ON · ${s.snapStep}u / ${s.snapDegrees}°` : "Grid snap OFF · free";
    styleToggle(this.snapBtn, s.snap);
    const canDelete = Boolean(s.name) && s.deleteBlocked === null;
    this.delBtn.disabled = !canDelete;
    this.delBtn.style.opacity = canDelete ? "1" : "0.34";
    this.delBtn.title = s.deleteBlocked ?? "delete this piece";
    this.dupBtn.disabled = !s.name;
    this.dupBtn.style.opacity = s.name ? "1" : "0.34";

    // ---- assets ------------------------------------------------------------------------------------
    if (this.armed !== s.assetKey) { this.armed = s.assetKey; this.paintArmed(); }

    // ---- surface -----------------------------------------------------------------------------------
    this.renderList(this.surfaceList, s.surfaces.map((x) => ({ id: x.id, label: `${x.label}` })), s.surfaceId, this.a.pickSurface);
    const spec = s.surfaceSpec;
    this.surfaceSpec = spec;
    this.presetRow.replaceChildren();
    if (spec) {
      const kind = s.surfaces.find((x) => x.id === s.surfaceId)?.kind ?? "floor";
      for (const [id, p] of Object.entries(SURFACE_PRESETS) as [SurfacePresetId, { label: string; kinds: readonly SurfaceKind[] }][]) {
        if (!p.kinds.includes(kind)) continue;
        const b = el("button", BTN + "flex:0 0 auto;padding:4px 7px;font-size:10.5px;", p.label);
        styleToggle(b, id === spec.preset);
        b.onclick = () => this.pushSurface({ preset: id });
        this.presetRow.append(b);
      }
      if (document.activeElement !== this.colorInput) this.colorInput.value = `#${spec.color.toString(16).padStart(6, "0")}`;
      this.setSlider(this.sBright, spec.brightness, `${Math.round(spec.brightness * 100)}%`);
      this.setSlider(this.sRough, spec.roughness, spec.roughness.toFixed(2));
      this.setSlider(this.sDetail, spec.detail, `${Math.round(spec.detail * 100)}%`);
    }
    this.panes.surface.style.opacity = spec ? "1" : "0.55";

    // ---- lighting ----------------------------------------------------------------------------------
    this.renderList(this.ledList, s.leds, s.ledId, this.a.pickLed);
    const led = s.ledSpec;
    this.ledSpec = led;
    if (led) {
      for (const b of Array.from(this.ledSwatches.children) as HTMLElement[])
        b.style.outline = b.style.backgroundColor && sameHex(b.style.backgroundColor, led.color) ? "2px solid rgba(242,177,52,0.9)" : "none";
      this.setSlider(this.lInten, led.intensity, led.intensity.toFixed(2));
      this.setSlider(this.lGlow, led.glow, led.glow.toFixed(2));
    }
    this.panes.lighting.style.opacity = led ? "1" : "0.55";

    // ---- footer ------------------------------------------------------------------------------------
    for (const [b, on] of [[this.undoBtn, s.canUndo], [this.redoBtn, s.canRedo]] as const) {
      b.disabled = !on;
      b.style.opacity = on ? "1" : "0.34";
      b.style.cursor = on ? "pointer" : "default";
    }
    const canConfirm = s.valid && s.pending;
    this.confirmBtn.disabled = !canConfirm;
    this.confirmBtn.style.opacity = canConfirm ? "1" : "0.4";
    if (s.hint) this.hint.textContent = s.hint;
  }
  private setSlider(sl: ReturnType<typeof slider>, v: number, read: string): void {
    if (!this.dragging) sl.input.value = String(v);
    sl.read.textContent = read;
    this.guardDrag(sl.input);
  }
  private renderList(host: HTMLDivElement, items: { id: string; label: string }[], selected: string | null, pick: (id: string) => void): void {
    if (host.dataset.sig !== items.map((i) => i.id).join("|")) {
      host.dataset.sig = items.map((i) => i.id).join("|");
      host.replaceChildren();
      for (const it of items) {
        const b = el("button", BTN + "flex:0 0 auto;text-align:left;padding:5px 8px;font-weight:500;", it.label);
        b.dataset.rowId = it.id;
        b.onclick = () => pick(it.id);
        host.append(b);
      }
    }
    for (const b of Array.from(host.children) as HTMLElement[]) {
      const on = b.dataset.rowId === selected;
      styleToggle(b, on);
      // a list of nineteen surfaces is longer than the card: keep the selected row where it can be seen
      if (on && host.dataset.shown !== selected) { host.dataset.shown = selected ?? ""; b.scrollIntoView({ block: "nearest" }); }
    }
    if (!selected) host.dataset.shown = "";
  }
  dispose(): void { this.root.remove(); }
}

/** a swatch's rendered `rgb(...)` against a palette hex — how the LED tab shows which colour is current */
function sameHex(rgb: string, hex: number): boolean {
  const m = /rgb\((\d+),\s*(\d+),\s*(\d+)\)/.exec(rgb);
  if (!m) return false;
  return ((Number(m[1]) << 16) | (Number(m[2]) << 8) | Number(m[3])) === hex;
}

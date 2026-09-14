// vo3d editor — the designer-facing panel. DOM only: it renders state and reports intent, it owns none.
//
// Built the way player/PlayerHud is built — created when EDIT is entered, destroyed when it is left, so
// nothing of it exists in OFFICE, EXPLORE or PLAYER. Styling follows the VO surface language already used
// across the 3D overlays: a dark translucent card, hairline borders, one amber accent, compact rows.
export type PanelActions = {
  setAxis: (axis: "x" | "z", value: number) => void;
  setYaw: (deg: number) => void;
  nudgeYaw: (deg: number) => void;
  setSnap: (on: boolean) => void;
  undo: () => void;
  redo: () => void;
  confirm: () => void;
  cancel: () => void;
  reset: () => void;
  close: () => void;
};
export type PanelState = {
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
};

const CARD =
  // bottom-LEFT and above lil-gui's stacking context: the dev GUI owns the right edge and would
  // otherwise sit on top of this card, and the harness status strip owns the last ~26px of the page.
  "position:fixed;left:16px;bottom:42px;z-index:1002;width:246px;box-sizing:border-box;padding:12px 13px 11px;" +
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

function el<K extends keyof HTMLElementTagNameMap>(tag: K, css: string, text?: string): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag);
  n.style.cssText = css;
  if (text !== undefined) n.textContent = text;
  return n;
}

export class EditorPanel {
  private readonly root: HTMLDivElement;
  private readonly title: HTMLDivElement;
  private readonly sub: HTMLDivElement;
  private readonly chip: HTMLDivElement;
  private readonly hint: HTMLDivElement;
  private readonly fields: Record<"x" | "z" | "yaw", HTMLInputElement>;
  private readonly snapBtn: HTMLButtonElement;
  private readonly undoBtn: HTMLButtonElement;
  private readonly redoBtn: HTMLButtonElement;
  private readonly confirmBtn: HTMLButtonElement;
  private readonly body: HTMLDivElement;
  private editing: HTMLInputElement | null = null;

  constructor(parent: HTMLElement, a: PanelActions) {
    this.root = el("div", CARD);

    const head = el("div", "display:flex;align-items:center;gap:8px;margin-bottom:9px;");
    const titleWrap = el("div", "flex:1;min-width:0;");
    this.title = el("div", "font:600 12.5px/1.2 system-ui,sans-serif;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;", "Nothing selected");
    this.sub = el("div", "font-size:10px;opacity:0.45;margin-top:1px;", "click a piece to select");
    titleWrap.append(this.title, this.sub);
    const close = el("button", BTN + "flex:0 0 auto;width:24px;padding:4px 0;opacity:0.7;", "✕");
    close.onclick = a.close;
    head.append(titleWrap, close);

    this.chip = el("div", "margin-bottom:9px;padding:4px 8px;border-radius:7px;font-size:10.5px;letter-spacing:0.02em;", "—");

    this.body = el("div", "");
    const row = el("div", "display:flex;gap:6px;margin-bottom:8px;");
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

    const turnRow = el("div", "display:flex;gap:6px;margin-bottom:8px;");
    for (const d of [-90, -15, 15, 90]) {
      const b = el("button", BTN, `${d > 0 ? "+" : "−"}${Math.abs(d)}°`);
      b.onclick = () => a.nudgeYaw(d);
      turnRow.append(b);
    }

    this.snapBtn = el("button", BTN + "margin-bottom:8px;width:100%;", "Grid snap");
    this.snapBtn.onclick = () => a.setSnap(!this.snapOn);

    const histRow = el("div", "display:flex;gap:6px;margin-bottom:8px;");
    this.undoBtn = el("button", BTN, "↶ Undo");
    this.redoBtn = el("button", BTN, "↷ Redo");
    this.undoBtn.onclick = a.undo;
    this.redoBtn.onclick = a.redo;
    histRow.append(this.undoBtn, this.redoBtn);

    const actRow = el("div", "display:flex;gap:6px;");
    this.confirmBtn = el("button", BTN + "background:rgba(242,177,52,0.85);border-color:rgba(242,177,52,0.9);color:#1a1509;", "✔ Confirm");
    const cancelBtn = el("button", BTN, "Cancel");
    const resetBtn = el("button", BTN + "flex:0 0 auto;padding:6px 8px;opacity:0.75;", "Reset");
    this.confirmBtn.onclick = a.confirm;
    cancelBtn.onclick = a.cancel;
    resetBtn.onclick = a.reset;
    actRow.append(this.confirmBtn, cancelBtn, resetBtn);

    this.hint = el("div", "margin-top:8px;font-size:10px;opacity:0.42;line-height:1.35;",
      "drag piece · drag ring to rotate · ⏎ confirm · esc cancel · ⌘Z undo");

    this.body.append(row, turnRow, this.snapBtn, histRow, actRow);
    this.root.append(head, this.chip, this.body, this.hint);
    parent.appendChild(this.root);
  }
  private snapOn = false;

  /** idempotent render; a focused numeric field is never overwritten under the designer's cursor */
  render(s: PanelState): void {
    this.title.textContent = s.name ?? "Nothing selected";
    this.sub.textContent = s.name ? s.room : "click a piece to select";
    this.body.style.opacity = s.name ? "1" : "0.38";
    this.body.style.pointerEvents = s.name ? "auto" : "none";

    const tone = !s.name ? "rgba(255,255,255,0.07)" : s.valid ? "rgba(96,190,120,0.16)" : "rgba(217,70,59,0.22)";
    const ink = !s.name ? "rgba(244,241,236,0.5)" : s.valid ? "#9fe0b1" : "#ffb3ab";
    this.chip.style.background = tone;
    this.chip.style.color = ink;
    this.chip.textContent = s.status;

    const write = (i: HTMLInputElement, v: number): void => { if (this.editing !== i) i.value = String(Math.round(v * 100) / 100); };
    write(this.fields.x, s.x); write(this.fields.z, s.z); write(this.fields.yaw, s.yaw);

    this.snapOn = s.snap;
    this.snapBtn.textContent = s.snap ? `Grid snap ON · ${s.snapStep}u / ${s.snapDegrees}°` : "Grid snap OFF · free";
    this.snapBtn.style.background = s.snap ? "rgba(242,177,52,0.22)" : "rgba(255,255,255,0.07)";
    this.snapBtn.style.borderColor = s.snap ? "rgba(242,177,52,0.5)" : "rgba(255,255,255,0.12)";

    for (const [b, on] of [[this.undoBtn, s.canUndo], [this.redoBtn, s.canRedo]] as const) {
      b.disabled = !on;
      b.style.opacity = on ? "1" : "0.34";
      b.style.cursor = on ? "pointer" : "default";
    }
    const canConfirm = Boolean(s.name) && s.valid && s.pending;
    this.confirmBtn.disabled = !canConfirm;
    this.confirmBtn.style.opacity = canConfirm ? "1" : "0.4";
    if (s.hint) this.hint.textContent = s.hint;
  }
  dispose(): void { this.root.remove(); }
}

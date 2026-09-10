import { render, screen, fireEvent } from "@testing-library/react";
// @ts-expect-error node:fs is untyped under tsconfig.app.json (types: ["vite/client"] only) and
// pulling in @types/node would change global typing for the whole app — same exemption
// HudDock.layering.test.ts takes. vitest runs in Node with cwd = frontend/.
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { ProfileCharacter } from "./ProfileCharacter";
import { CHARACTER_ANIM_STATES, resolveCharacterAnimState } from "../../render3d/characterAnimationState";

// The real CharacterCanvas needs WebGL; stub it and record the props it receives, which is
// exactly the contract this component is responsible for.
const seen: Array<Record<string, unknown>> = [];
vi.mock("../../render3d/CharacterCanvas", () => ({
  CharacterCanvas: (props: Record<string, unknown>) => {
    seen.push(props);
    return <div data-testid="character-canvas" />;
  },
}));

const SELF = "jerevon@offshorly.com";

describe("ProfileCharacter", () => {
  it("renders the live 3D model for an eligible person", () => {
    seen.length = 0;
    render(<ProfileCharacter email={SELF} fallbackSrc="/p.png" name="Bon" />);
    expect(screen.getByTestId("character-canvas")).toBeInTheDocument();
    expect(String(seen[0].glbUrl)).toContain(".glb");
  });

  it("falls back to the 2D portrait when the person has no live-3D model", () => {
    render(<ProfileCharacter email="nobody@example.com" fallbackSrc="/p.png" name="Nobody" />);
    expect(screen.queryByTestId("character-canvas")).toBeNull();
    expect(screen.getByAltText("Nobody's character")).toBeInTheDocument();
  });

  it("only offers poses that exist as real clips in the rig", () => {
    render(<ProfileCharacter email={SELF} fallbackSrc="/p.png" name="Bon" />);
    // No "Wave" — the rig has no wave clip.
    expect(screen.queryByRole("button", { name: "Wave" })).toBeNull();
    for (const label of ["Idle", "Agree", "Listen", "Walk"]) {
      expect(screen.getByRole("button", { name: label })).toBeInTheDocument();
    }
  });

  it("maps each pose onto an existing animation state via the shared resolver", () => {
    seen.length = 0;
    render(<ProfileCharacter email={SELF} fallbackSrc="/p.png" name="Bon" />);

    const stateOf = () => {
      const p = seen[seen.length - 1];
      return resolveCharacterAnimState({
        isWalking: Boolean(p.isWalking),
        isSitting: Boolean(p.isSitting),
        isGlobalChatActive: Boolean(p.isGlobalChatActive),
        isSpatialConversation: Boolean(p.isSpatialConversation),
        isTyping: Boolean(p.isTyping),
      });
    };

    expect(stateOf()).toBe("idle-9");
    fireEvent.click(screen.getByRole("button", { name: "Agree" }));
    expect(stateOf()).toBe("agree-gesture");
    fireEvent.click(screen.getByRole("button", { name: "Listen" }));
    expect(stateOf()).toBe("listening-gesture");
    fireEvent.click(screen.getByRole("button", { name: "Walk" }));
    expect(stateOf()).toBe("walking");

    // Every state used is one the rig actually declares.
    for (const s of ["idle-9", "agree-gesture", "listening-gesture", "walking"] as const) {
      expect(CHARACTER_ANIM_STATES).toContain(s);
    }
  });

  it("drag rotates the model and turns auto-rotate off", () => {
    seen.length = 0;
    const { container } = render(<ProfileCharacter email={SELF} fallbackSrc="/p.png" name="Bon" />);
    const stage = container.querySelector('[data-live="true"]') as HTMLElement;
    const toggle = screen.getByLabelText("Auto-rotate") as HTMLInputElement;
    expect(toggle.checked).toBe(true);

    const before = Number(seen[seen.length - 1].headingDegrees);
    fireEvent.pointerDown(stage, { clientX: 100, pointerId: 1 });
    fireEvent.pointerMove(stage, { clientX: 200, pointerId: 1 });
    fireEvent.pointerUp(stage, { pointerId: 1 });

    expect(toggle.checked).toBe(false);
    expect(Number(seen[seen.length - 1].headingDegrees)).not.toBe(before);
  });

  // REGRESSION — the model was invisible because this wrapper had no height.
  // CharacterCanvas paints an absolutely-positioned <canvas> at height:100%; an absolute child
  // contributes no height, so a wrapper without its own explicit size collapses to 0 and the
  // model renders at zero pixels. The wrapper must keep a real height.
  describe("the model wrapper is sized (CharacterCanvas is position:absolute + height:100%)", () => {
    const css = readFileSync("src/components/OfficeMap/ProfileCharacter.module.css", "utf8");
    const block = /\.model\s*\{([^}]*)\}/.exec(css)?.[1] ?? "";

    it("declares an explicit non-zero height and width", () => {
      const height = /height:\s*(\d+)px/.exec(block);
      const width = /width:\s*(\d+)px/.exec(block);
      expect(height, ".model must set an explicit height").not.toBeNull();
      expect(width, ".model must set an explicit width").not.toBeNull();
      expect(Number(height?.[1])).toBeGreaterThan(200);
      expect(Number(width?.[1])).toBeGreaterThan(150);
    });

    it("stays a positioned containing block for the absolute canvas", () => {
      expect(block).toMatch(/position:\s*relative/);
    });

    // The podium (two ellipses + a cylinder wall + pulsing rings) was removed, not overridden:
    // stacking a new stage on top of dead rules is how the old one ended up with a ring at one
    // height and feet at another.
    it("keeps no trace of the abandoned podium/ring construction", () => {
      for (const dead of ["podiumTop", "podiumSide", "podiumBase", "podiumShadow", "podiumRing", "glowRing", "ringPulse"]) {
        expect(css, `${dead} should be gone from the stylesheet`).not.toMatch(new RegExp(`[.@]?${dead}\\b`));
      }
      const tsx = readFileSync("src/components/OfficeMap/ProfileCharacter.tsx", "utf8");
      expect(tsx).not.toMatch(/podium|glowRing/);
    });

    // What replaced it. Both layers must stay centred on the same line or the character floats
    // again: ambient spans [-20, 102] and contact spans [27, 55], both centred on 41.
    it("grounds the live model with two shadow layers centred on the same foot line", () => {
      const centre = (rule: string) => {
        const b = new RegExp(`\\.stage\\[data-live="true"\\] \\.model::${rule}\\s*\\{([^}]*)\\}`).exec(css)?.[1] ?? "";
        const bottom = Number(/bottom:\s*(-?\d+)px/.exec(b)?.[1]);
        const height = Number(/height:\s*(\d+)px/.exec(b)?.[1]);
        expect(Number.isFinite(bottom) && Number.isFinite(height), `::${rule} needs bottom + height`).toBe(true);
        return bottom + height / 2;
      };
      expect(centre("after")).toBe(centre("before"));
    });

    it("confirms the canvas really is absolute at height:100%", () => {
      const canvas = readFileSync("src/render3d/CharacterCanvas.tsx", "utf8");
      expect(canvas).toMatch(/position:\s*"absolute"/);
      expect(canvas).toMatch(/height:\s*"100%"/);
    });
  });
});

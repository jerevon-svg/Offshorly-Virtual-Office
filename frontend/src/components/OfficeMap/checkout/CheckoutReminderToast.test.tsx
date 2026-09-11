// @ts-expect-error node:fs is untyped under tsconfig.app.json (types: ["vite/client"] only) — the
// same exemption HudDock.layering.test.ts takes for reading a stylesheet as text.
import { readFileSync } from "node:fs";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CheckoutReminderToast, WORKING_HOURS_ANCHOR, placeReminder, tailTipX } from "./CheckoutReminderToast";

// The 8h reminder card: copy for the initial and follow-up states, and that every control reaches
// the checkout flow's own handlers (Later / X = snooze, Start checkout = the existing flow).

describe("CheckoutReminderToast", () => {
  it("renders nothing while hidden", () => {
    render(<CheckoutReminderToast visible={false} onLater={() => {}} onStartCheckout={() => {}} />);
    expect(screen.queryByTestId("checkout-reminder")).not.toBeInTheDocument();
  });

  it("shows the initial 8-hour copy as a non-blocking status card", () => {
    render(<CheckoutReminderToast visible onLater={() => {}} onStartCheckout={() => {}} />);
    const card = screen.getByTestId("checkout-reminder");
    expect(card).toHaveAttribute("role", "status");
    expect(card).not.toHaveAttribute("aria-modal");
    expect(screen.getByText("8 hours reached")).toBeInTheDocument();
    expect(screen.getByText("Ready to wrap up for today?")).toBeInTheDocument();
  });

  it("shows the gentle follow-up copy quoting the live worked time", () => {
    render(
      <CheckoutReminderToast visible followUp workedLabel="8h 30m" onLater={() => {}} onStartCheckout={() => {}} />,
    );
    expect(screen.getByText("Still here?")).toBeInTheDocument();
    expect(screen.getByText("It’s been 8h 30m. Ready to check out?")).toBeInTheDocument();
  });

  it("wires Later, the X and Start checkout to the flow's handlers", () => {
    const onLater = vi.fn();
    const onStartCheckout = vi.fn();
    render(<CheckoutReminderToast visible onLater={onLater} onStartCheckout={onStartCheckout} />);

    fireEvent.click(screen.getByRole("button", { name: "Later" }));
    fireEvent.click(screen.getByRole("button", { name: /dismiss reminder/i }));
    expect(onLater).toHaveBeenCalledTimes(2);
    expect(onStartCheckout).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Start checkout" }));
    expect(onStartCheckout).toHaveBeenCalledTimes(1);
  });
});

describe("CheckoutReminderToast — anchored to the dock's Working Hours group", () => {
  const CARD = { width: 400 };

  it.each([
    // [viewport, anchor] — centred, near the right edge, near the left edge, short viewport.
    [{ width: 1280, height: 800 }, { left: 900, width: 80, top: 720 }],
    [{ width: 1280, height: 800 }, { left: 1180, width: 80, top: 720 }],
    [{ width: 1280, height: 800 }, { left: 0, width: 40, top: 720 }],
    [{ width: 820, height: 340 }, { left: 210, width: 90, top: 250 }],
    [{ width: 600, height: 600 }, { left: 40, width: 60, top: 540 }],
  ])("sits above the anchor and aims the tail at its centre (viewport %o, anchor %o)", (viewport, anchor) => {
    const p = placeReminder(anchor, CARD, viewport);
    const anchorCenter = anchor.left + anchor.width / 2;
    // Above the anchor: the card's bottom edge clears the anchor's top by the gap.
    expect(viewport.height - p.bottom).toBeLessThan(anchor.top);
    // The card itself stays inside the viewport…
    expect(p.left).toBeGreaterThanOrEqual(16);
    expect(p.left + CARD.width).toBeLessThanOrEqual(viewport.width - 16);
    // …and the tail's TIP shares the anchor's centre X (within the corner-safe band).
    const idealTail = anchorCenter - p.left;
    const clampedTail = Math.min(CARD.width - 28, Math.max(28, idealTail));
    expect(Math.abs(tailTipX(p) - anchorCenter)).toBeLessThanOrEqual(Math.abs(clampedTail - idealTail) + 0.5);
  });

  it("clamps the card at the viewport edge without moving the tail's target", () => {
    const right = placeReminder({ left: 1180, width: 80, top: 720 }, CARD, { width: 1280, height: 800 });
    expect(right.left).toBe(1280 - 16 - 400); // clamped
    expect(tailTipX(right)).toBe(1220); // still the anchor's centre
    const left = placeReminder({ left: 30, width: 60, top: 720 }, CARD, { width: 1280, height: 800 });
    expect(left.left).toBe(16);
    expect(tailTipX(left)).toBe(60);
  });

  describe("live DOM", () => {
    let anchor: HTMLDivElement | null = null;
    let rect = { left: 800, width: 80, top: 700 };
    const mountAnchor = () => {
      anchor = document.createElement("div");
      anchor.setAttribute("data-dock-item", "time");
      anchor.getBoundingClientRect = () =>
        ({ ...rect, height: 40, right: rect.left + rect.width, bottom: rect.top + 40, x: rect.left, y: rect.top, toJSON() {} }) as DOMRect;
      document.body.appendChild(anchor);
    };

    beforeEach(() => {
      vi.useFakeTimers();
      vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => window.setTimeout(() => cb(16), 16));
      vi.stubGlobal("cancelAnimationFrame", (id: number) => window.clearTimeout(id));
      Object.defineProperty(HTMLDivElement.prototype, "offsetWidth", { configurable: true, get: () => 400 });
      Object.defineProperty(window, "innerWidth", { configurable: true, value: 1280 });
      Object.defineProperty(window, "innerHeight", { configurable: true, value: 800 });
      rect = { left: 800, width: 80, top: 700 };
    });

    afterEach(() => {
      anchor?.remove();
      anchor = null;
      delete (HTMLDivElement.prototype as { offsetWidth?: unknown }).offsetWidth;
      vi.unstubAllGlobals();
      vi.useRealTimers();
    });

    const frames = (n = 2) => act(() => void vi.advanceTimersByTime(16 * n + 1));
    const tipOf = (card: HTMLElement) =>
      parseFloat(card.style.getPropertyValue("--reminder-left")) +
      parseFloat(card.style.getPropertyValue("--reminder-tail-x")) +
      8; // tail var is the 16px tail's left edge; its tip is its centre

    it("renders into <body> so fixed coordinates are viewport coordinates", () => {
      render(
        <div style={{ transform: "translate(50px, 50px)" }}>
          <CheckoutReminderToast visible onLater={() => {}} onStartCheckout={() => {}} />
        </div>,
      );
      const card = screen.getByTestId("checkout-reminder");
      expect(card.parentElement).toBe(document.body);
    });

    it("anchors to the Working Hours centre, and REGRESSION: still does when the dock mounts after the card", () => {
      render(<CheckoutReminderToast visible onLater={() => {}} onStartCheckout={() => {}} />);
      const card = screen.getByTestId("checkout-reminder");
      frames();
      expect(card).toHaveAttribute("data-anchored", "false"); // no dock yet: stylesheet fallback

      mountAnchor(); // the dock arrives later (check-in / onboarding / self-placement resolved)
      expect(document.querySelector(WORKING_HOURS_ANCHOR)).toBe(anchor);
      frames();
      expect(card).toHaveAttribute("data-anchored", "true");
      expect(card.style.getPropertyValue("--reminder-left")).toBe("640px");
      expect(card.style.getPropertyValue("--reminder-bottom")).toBe("114px");
      expect(tipOf(card)).toBe(840); // = 800 + 80 / 2
    });

    it("follows the anchor when the HUD moves without any resize event, and keeps aim when clamped", () => {
      mountAnchor();
      render(<CheckoutReminderToast visible onLater={() => {}} onStartCheckout={() => {}} />);
      const card = screen.getByTestId("checkout-reminder");
      frames();
      expect(tipOf(card)).toBe(840);

      rect = { left: 1000, width: 80, top: 700 }; // dock re-laid out / slid in
      frames();
      expect(card.style.getPropertyValue("--reminder-left")).toBe("840px");
      expect(tipOf(card)).toBe(1040);

      rect = { left: 1180, width: 80, top: 700 }; // near the right edge: card clamps, tail does not
      frames();
      expect(card.style.getPropertyValue("--reminder-left")).toBe("864px");
      expect(tipOf(card)).toBe(1220);

      Object.defineProperty(window, "innerWidth", { configurable: true, value: 900 }); // viewport shrinks
      frames();
      expect(card.style.getPropertyValue("--reminder-left")).toBe("484px");
      expect(tipOf(card)).toBe(Math.min(1220, 484 + 400 - 28)); // anchor now past the card: corner-safe clamp
    });

    it("stops measuring once hidden", () => {
      mountAnchor();
      const { rerender } = render(<CheckoutReminderToast visible onLater={() => {}} onStartCheckout={() => {}} />);
      frames();
      rerender(<CheckoutReminderToast visible={false} onLater={() => {}} onStartCheckout={() => {}} />);
      expect(screen.queryByTestId("checkout-reminder")).not.toBeInTheDocument();
      expect(() => frames(5)).not.toThrow();
    });
  });
});

describe("CheckoutReminderToast — content-hugging width", () => {
  const css = readFileSync("src/components/OfficeMap/checkout/checkout.module.css", "utf8");
  const decl = (cls: string, prop: string) => {
    const block = new RegExp(`\\.${cls}\\s*\\{([^}]*)\\}`).exec(css)?.[1] ?? "";
    return new RegExp(`(?:^|;|\\n)\\s*${prop}:\\s*([^;]+)`).exec(block)?.[1].trim();
  };

  it("hugs its content up to the family's cap instead of a fixed 400px", () => {
    expect(decl("reminderCard", "width")).toBe("max-content");
    expect(decl("reminderCard", "max-width")).toBe("min(400px, calc(100vw - 32px))");
    expect(decl("reminderCard", "min-width")).toBeUndefined();
  });

  it("keeps the internal padding and only clears the ✕ on the title line, not a whole column", () => {
    expect(decl("reminderCard", "padding")).toBe("18px");
    expect(decl("reminderTitle", "padding-right")).toBe("30px");
    expect(decl("reminderClose", "top")).toBe("10px");
    expect(decl("reminderClose", "right")).toBe("10px");
  });
});

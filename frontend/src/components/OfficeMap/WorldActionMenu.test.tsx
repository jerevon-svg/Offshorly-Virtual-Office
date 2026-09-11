// @ts-expect-error node:fs is untyped under tsconfig.app.json (types: ["vite/client"] only) —
// same exemption HudDock.layering.test.ts takes. vitest runs with cwd = frontend/.
import { readFileSync } from "node:fs";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ReceptionActionMenu } from "./ReceptionActionMenu";
import { SeatActionMenu } from "./SeatActionMenu";
import { ANCHOR_OFFSET_PX, WorldActionMenu, placeMenu } from "./WorldActionMenu";

// THE shared world interaction menu: one card, one row treatment, one dismissal contract for
// every click-to-interact surface. The employee wrapper is covered in CharacterActionMenu.test.tsx;
// the Reception and Seat wrappers are covered here, since each is a handful of lines that only
// decides which rows exist.

const anchor = { clientX: 100, clientY: 100 };

describe("WorldActionMenu shell", () => {
  it("renders the rows as menu items and fires each row's own handler", () => {
    const a = vi.fn();
    const b = vi.fn();
    render(
      <WorldActionMenu
        anchor={anchor}
        onClose={vi.fn()}
        ariaLabel="Test"
        items={[
          { key: "a", label: "Alpha", onSelect: a },
          { key: "b", label: "Beta", onSelect: b },
        ]}
      />,
    );
    expect(screen.getByRole("menu", { name: "Test" })).toBeInTheDocument();
    screen.getByRole("menuitem", { name: "Alpha" }).click();
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).not.toHaveBeenCalled();
    screen.getByRole("menuitem", { name: "Beta" }).click();
    expect(b).toHaveBeenCalledTimes(1);
  });

  it("closes on Escape and on an outside press, never on a press inside the card", () => {
    const onClose = vi.fn();
    render(<WorldActionMenu anchor={anchor} onClose={onClose} ariaLabel="Test" items={[{ key: "a", label: "Alpha", onSelect: () => {} }]} />);
    fireEvent.pointerDown(screen.getByTestId("world-menu"));
    fireEvent.pointerDown(screen.getByRole("menuitem", { name: "Alpha" }));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.pointerDown(document.body);
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  // QUICK SWITCH. The backdrop is no click shield: a press on another character must reach that
  // character (whose own click path replaces the menu), so the menu must NOT close itself first —
  // that close was the intermediate zoom-out and the second click.
  it("does not dismiss on a press on another character, and its backdrop swallows nothing", () => {
    const onClose = vi.fn();
    const other = document.createElement("div");
    other.setAttribute("data-character-id", "alex");
    const inner = document.createElement("canvas");
    other.appendChild(inner);
    document.body.appendChild(other);
    render(<WorldActionMenu anchor={anchor} onClose={onClose} ariaLabel="Test" items={[]} />);
    fireEvent.pointerDown(inner); // deep inside the character's layer
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.pointerDown(document.body); // ordinary outside press still closes
    expect(onClose).toHaveBeenCalledTimes(1);
    other.remove();
    const css = readFileSync("src/components/OfficeMap/WorldActionMenu.module.css", "utf8");
    expect(/\.backdrop \{([\s\S]*?)\n\}/.exec(css)?.[1]).toMatch(/pointer-events: none;/);
  });

  it("shows a header only when there is context to show", () => {
    const { rerender } = render(<WorldActionMenu anchor={anchor} onClose={vi.fn()} ariaLabel="Test" items={[]} />);
    expect(screen.queryByTestId("world-menu-meta")).not.toBeInTheDocument();
    expect(screen.getByTestId("world-menu").children).toHaveLength(0);

    rerender(<WorldActionMenu anchor={anchor} onClose={vi.fn()} ariaLabel="Test" title="Alex" meta={{ color: "#22C55E", label: "Available" }} items={[]} />);
    expect(screen.getByText("Alex")).toBeInTheDocument();
    expect(screen.getByTestId("world-menu-meta")).toHaveTextContent("Available");
  });

  it("badges a row with the dock's rule: real counts only, 9+ above nine", () => {
    render(
      <WorldActionMenu
        anchor={anchor}
        onClose={vi.fn()}
        ariaLabel="Test"
        items={[
          { key: "none", label: "None", onSelect: () => {} },
          { key: "zero", label: "Zero", onSelect: () => {}, badge: 0 },
          { key: "one", label: "One", onSelect: () => {}, badge: 1 },
          { key: "many", label: "Many", onSelect: () => {}, badge: 42 },
        ]}
      />,
    );
    expect(screen.queryByTestId("world-menu-badge-none")).not.toBeInTheDocument();
    expect(screen.queryByTestId("world-menu-badge-zero")).not.toBeInTheDocument();
    expect(screen.getByTestId("world-menu-badge-one")).toHaveTextContent("1");
    expect(screen.getByTestId("world-menu-badge-many")).toHaveTextContent("9+");
  });

  // REGRESSION (227b998): the backdrop went pointer-events:none for one-click character
  // switching, and the card inherited it — rows never hovered and presses walked the character
  // behind the menu. The transparent backdrop stays; the visible card must capture interaction.
  describe("the card is interactive while the backdrop stays transparent", () => {
    const rule = (cls: string) => {
      const css = readFileSync("src/components/OfficeMap/WorldActionMenu.module.css", "utf8");
      return new RegExp(`\\.${cls} \\{([\\s\\S]*?)\\n\\}`).exec(css)?.[1] ?? "";
    };

    it("re-enables pointer events on the card itself, not on the backdrop", () => {
      expect(rule("backdrop")).toMatch(/pointer-events: none;/);
      expect(rule("menu")).toMatch(/pointer-events: auto;/);
      // Rows keep their hover/focus/active states and a pointer cursor.
      expect(rule("item")).toMatch(/cursor: pointer;/);
      expect(rule("item:hover")).not.toBe("");
      expect(rule("item:focus-visible")).not.toBe("");
    });

    it("a press on a row fires the row's action and never reaches the world's movement handler", () => {
      const worldPointerUp = vi.fn();
      const worldClick = vi.fn();
      const chat = vi.fn();
      render(
        // Stands in for a stage/room layer around the menu: OfficeStage walks the character from
        // a click-vs-drag pointer-up, so both pointer-up and click must stop at the card.
        <div onPointerUp={worldPointerUp} onClick={worldClick} data-testid="world">
          <WorldActionMenu
            anchor={anchor}
            onClose={vi.fn()}
            ariaLabel="Actions for Alex"
            title="Alex"
            items={[{ key: "chat", label: "Chat", onSelect: chat }]}
          />
        </div>,
      );
      const row = screen.getByRole("menuitem", { name: "Chat" });
      fireEvent.pointerDown(row);
      fireEvent.pointerUp(row);
      fireEvent.click(row);
      expect(chat).toHaveBeenCalledTimes(1);
      expect(worldPointerUp).not.toHaveBeenCalled();
      expect(worldClick).not.toHaveBeenCalled();

      // The header / card body are equally solid: no walk from a press on the title.
      fireEvent.pointerUp(screen.getByText("Alex"));
      fireEvent.click(screen.getByText("Alex"));
      expect(worldPointerUp).not.toHaveBeenCalled();
      expect(worldClick).not.toHaveBeenCalled();
    });

    it("a press on ANOTHER character still reaches that character in one click, without closing first", () => {
      const onClose = vi.fn();
      const otherCharacterClick = vi.fn();
      const other = document.createElement("div");
      other.setAttribute("data-character-id", "micah");
      other.addEventListener("pointerup", otherCharacterClick);
      document.body.appendChild(other);
      render(<WorldActionMenu anchor={anchor} onClose={onClose} ariaLabel="Actions for Alex" items={[]} />);
      fireEvent.pointerDown(other);
      fireEvent.pointerUp(other);
      expect(otherCharacterClick).toHaveBeenCalledTimes(1); // the backdrop shielded nothing
      expect(onClose).not.toHaveBeenCalled(); // and this menu is replaced, not closed-then-reopened
      other.remove();
    });
  });

  it("keeps the office's 20/21 menu layers and paints the cream card, not a dark one", () => {
    const css = readFileSync("src/components/OfficeMap/WorldActionMenu.module.css", "utf8");
    const rule = (cls: string) => new RegExp(`\\.${cls} \\{([\\s\\S]*?)\\n\\}`).exec(css)?.[1] ?? "";
    expect(rule("backdrop")).toMatch(/z-index: 20;/);
    expect(rule("menu")).toMatch(/z-index: 21;/);
    expect(rule("menu")).toMatch(/background: #fdfcfa;/);
    expect(css).not.toMatch(/rgba\(26,\s*26,\s*26/);
    // Rows respond in the family's green, not a white-on-dark wash.
    expect(rule("item:hover")).toMatch(/rgba\(75, 185, 106/);
  });

  it("uses the dock's HUD badge tokens for its row badge, token for token", () => {
    const menu = readFileSync("src/components/OfficeMap/WorldActionMenu.module.css", "utf8");
    const dock = readFileSync("src/components/OfficeMap/HudDock.module.css", "utf8");
    const badge = /\.badge \{([\s\S]*?)\n\}/.exec(menu)?.[1] ?? "";
    const tile = /\.tileBadge \{([\s\S]*?)\n\}/.exec(dock)?.[1] ?? "";
    for (const token of [
      "min-width: 17px;",
      "height: 17px;",
      "padding: 0 4px;",
      "border-radius: 999px;",
      "background: #e2453c;",
      "color: #fff;",
      "font-size: 11px;",
      "font-weight: 700;",
      "line-height: 17px;",
      "font-variant-numeric: tabular-nums;",
    ]) {
      expect(badge, token).toContain(token);
      expect(tile, token).toContain(token);
    }
  });
});

describe("WorldActionMenu placement off the anchor point", () => {
  const viewport = { width: 1024, height: 768 };
  const size = { width: 200, height: 180 };

  // The anchor is the character's on-screen CENTRE, so the card sits just beside / slightly over
  // their edge identically for every avatar width — never computed from the sprite's own box.
  it("hangs the card +8px right of the point, top at the point, with the notch facing left", () => {
    const pos = placeMenu({ clientX: 430, clientY: 345, notch: true }, size, viewport);
    expect(pos).toEqual({ left: 430 + ANCHOR_OFFSET_PX, top: 345, side: "right" });
  });

  it("flips to the left of the point when the right side has no room, notch facing right", () => {
    const pos = placeMenu({ clientX: 930, clientY: 345, notch: true }, size, viewport);
    expect(pos.left).toBe(930 - ANCHOR_OFFSET_PX - size.width); // 722
    expect(pos.side).toBe("left");
  });

  it("clamps to the viewport as the final fallback", () => {
    const pos = placeMenu({ clientX: 30, clientY: 745, notch: true }, size, viewport);
    expect(pos.left).toBe(38);
    expect(pos.top).toBe(viewport.height - 160); // never off the bottom edge
  });

  it("uses the same rule with no notch for desks and seats", () => {
    expect(placeMenu({ clientX: 100, clientY: 100 }, size, viewport)).toEqual({ left: 108, top: 100, side: null });
    expect(placeMenu({ clientX: 1000, clientY: 700 }, size, viewport)).toEqual({ left: 792, top: 608, side: null });
  });

  it("applies the placement and side to the rendered card", () => {
    render(
      <WorldActionMenu anchor={{ clientX: 430, clientY: 345, notch: true }} onClose={vi.fn()} ariaLabel="Test" items={[{ key: "a", label: "Alpha", onSelect: () => {} }]} />,
    );
    const card = screen.getByTestId("world-menu");
    expect(card.style.left).toBe(`${430 + ANCHOR_OFFSET_PX}px`);
    expect(card.style.top).toBe("345px");
    expect(card.getAttribute("data-side")).toBe("right");
  });

  it("follows a changing anchor: repositions, and re-sides the notch when the flip changes", () => {
    const { rerender } = render(<WorldActionMenu anchor={{ clientX: 430, clientY: 345, notch: true }} onClose={vi.fn()} ariaLabel="Test" items={[]} />);
    const card = screen.getByTestId("world-menu");
    expect(card.style.left).toBe("438px");
    // The character drifted right under a zoom: same menu instance, new point.
    rerender(<WorldActionMenu anchor={{ clientX: 930, clientY: 400, notch: true }} onClose={vi.fn()} ariaLabel="Test" items={[]} />);
    expect(card.style.left).toBe(`${930 - ANCHOR_OFFSET_PX - 200}px`);
    expect(card.style.top).toBe("400px");
    expect(card.getAttribute("data-side")).toBe("left");
  });

  it("points its notch at the character from whichever edge faces them after the flip", () => {
    const { rerender } = render(<WorldActionMenu anchor={{ clientX: 930, clientY: 345, notch: true }} onClose={vi.fn()} ariaLabel="Test" items={[]} />);
    expect(screen.getByTestId("world-menu").getAttribute("data-side")).toBe("left");
    rerender(<WorldActionMenu anchor={{ clientX: 100, clientY: 100 }} onClose={vi.fn()} ariaLabel="Test" items={[]} />);
    expect(screen.getByTestId("world-menu").hasAttribute("data-side")).toBe(false); // no notch for a desk/seat
    // The notch itself: cream, hairline-bordered, on the LEFT edge for a right-side card and the
    // RIGHT edge for a left-side card. Source-asserted (jsdom loads no CSS-module rules).
    const css = readFileSync("src/components/OfficeMap/WorldActionMenu.module.css", "utf8");
    const rule = (sel: string) => new RegExp(`${sel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} \\{([\\s\\S]*?)\\n\\}`).exec(css)?.[1] ?? "";
    const base = rule('.menu[data-side]::before');
    expect(base).toMatch(/background: #fdfcfa;/);
    expect(base).toMatch(/border: 1px solid rgba\(24, 20, 34, 0\.08\);/);
    expect(base).toMatch(/rotate\(45deg\)/);
    expect(rule('.menu[data-side="right"]::before')).toMatch(/left: -6px;/);
    expect(rule('.menu[data-side="left"]::before')).toMatch(/right: -6px;/);
  });
});

describe("ReceptionActionMenu on the shared shell", () => {
  it("offers Check In and Check Out under their existing gates, each firing its own handler", () => {
    const onCheckIn = vi.fn();
    const onCheckOut = vi.fn();
    const { rerender } = render(
      <ReceptionActionMenu anchor={anchor} onClose={vi.fn()} showCheckIn onCheckIn={onCheckIn} onCheckOut={onCheckOut} />,
    );
    expect(screen.getByRole("menu", { name: "Reception" })).toBeInTheDocument();
    expect(screen.getByText("Reception")).toBeInTheDocument();
    screen.getByRole("menuitem", { name: "Check In" }).click();
    expect(onCheckIn).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menuitem", { name: "Check Out" })).not.toBeInTheDocument();

    rerender(<ReceptionActionMenu anchor={anchor} onClose={vi.fn()} showCheckOut onCheckIn={onCheckIn} onCheckOut={onCheckOut} />);
    expect(screen.queryByRole("menuitem", { name: "Check In" })).not.toBeInTheDocument();
    screen.getByRole("menuitem", { name: "Check Out" }).click();
    expect(onCheckOut).toHaveBeenCalledTimes(1);
  });

  it("carries no employee context — no presence meta on a desk", () => {
    render(<ReceptionActionMenu anchor={anchor} onClose={vi.fn()} showCheckIn onCheckIn={vi.fn()} onCheckOut={vi.fn()} />);
    expect(screen.queryByTestId("world-menu-meta")).not.toBeInTheDocument();
  });
});

describe("SeatActionMenu on the shared shell", () => {
  it("offers the single Sit here row wired to onConfirm, and closes through the shell", () => {
    const onConfirm = vi.fn();
    const onClose = vi.fn();
    render(<SeatActionMenu anchor={anchor} onConfirm={onConfirm} onClose={onClose} />);
    expect(screen.getByText("Empty seat")).toBeInTheDocument();
    expect(screen.getAllByRole("menuitem")).toHaveLength(1);
    screen.getByRole("menuitem", { name: "Sit here" }).click();
    expect(onConfirm).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

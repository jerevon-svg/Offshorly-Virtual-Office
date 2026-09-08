// @ts-expect-error node:fs is untyped under tsconfig.app.json (types: ["vite/client"] only) and
// pulling in @types/node here would change global setTimeout typing for the whole app — same
// exemption services/attendance/mockRigConfig.test.ts takes. vitest runs in Node with
// cwd = frontend/, so the reads below are plain relative paths.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// LAYERING REGRESSION GUARD for Global Notifications V1.
//
// jsdom applies no CSS, so a rendering test cannot prove where the notification panel paints.
// What CAN be proven — and is exactly what broke twice before in this codebase (see
// RoomSidebar.module.css's and PlayerHud.module.css's z-index notes) — is the RELATIONSHIP
// between the office's stacking layers. These tests read the real stylesheets and assert the
// invariants, so raising one z-index without thinking about the others fails here rather than in
// somebody's browser.

const DIR = "src/components/OfficeMap";

function css(file: string): string {
  return readFileSync(`${DIR}/${file}`, "utf8");
}

/** All z-index values declared for one class in a stylesheet. */
function zIndexOf(source: string, className: string): number[] {
  const found: number[] = [];
  const blocks = source.matchAll(new RegExp(`\\.${className}\\b[^{]*\\{([^}]*)\\}`, "g"));
  for (const block of blocks) {
    for (const hit of block[1].matchAll(/z-index:\s*(-?\d+)/g)) found.push(Number(hit[1]));
  }
  return found;
}

function onlyZIndex(source: string, className: string): number {
  const values = zIndexOf(source, className);
  expect(values.length).toBeGreaterThan(0);
  return Math.max(...values);
}

const notificationCss = css("NotificationCenter.module.css");
const officeCss = css("OfficeMap.module.css");
const hudCss = css("PlayerHud.module.css");

const PILL_COLUMN_LAYER = 25;
const MODAL_BACKDROP_LAYER = 60;

describe("the notification control joins the existing pill layer", () => {
  it("sits at exactly the right-hand pill column's z-index", () => {
    expect(onlyZIndex(notificationCss, "anchor")).toBe(PILL_COLUMN_LAYER);
    // ...which is the layer its neighbours are on. If these ever move, this control moves too.
    for (const pill of ["hubButton", "profileButton", "questsButton", "missionsButton", "rewardsButton", "boardsButton"]) {
      expect(onlyZIndex(officeCss, pill)).toBe(PILL_COLUMN_LAYER);
    }
  });

  it("declares no z-index of its own on the panel, so it cannot escape the bell's layer", () => {
    // The panel is a child of .anchor, which forms the stacking context. Giving the panel its own
    // z-index would be the one edit that could float it above a modal.
    expect(zIndexOf(notificationCss, "panel")).toEqual([]);
    expect(zIndexOf(notificationCss, "bell")).toEqual([]);
    expect(zIndexOf(notificationCss, "badge")).toEqual([]);
    expect(zIndexOf(notificationCss, "list")).toEqual([]);
  });

  it("uses no arbitrary huge value anywhere", () => {
    const all = [...notificationCss.matchAll(/z-index:\s*(-?\d+)/g)].map((m) => Number(m[1]));
    expect(all).toEqual([PILL_COLUMN_LAYER]);
  });
});

describe("it stays below everything it must stay below", () => {
  const modals = [
    ["CompanyHub.module.css", "backdrop"],
    ["EmployeeProfile.module.css", "backdrop"],
    ["MissionsPanel.module.css", "backdrop"],
    ["OnboardingQuestline.module.css", "backdrop"],
    ["RewardsPanel.module.css", "backdrop"],
  ] as const;

  it.each(modals)("is under the %s modal backdrop", (file, cls) => {
    expect(onlyZIndex(css(file), cls)).toBe(MODAL_BACKDROP_LAYER);
    expect(onlyZIndex(notificationCss, "anchor")).toBeLessThan(MODAL_BACKDROP_LAYER);
  });

  it("is under the Team Map panel, whose backdrop the Player HUD steps behind", () => {
    const teamMap = readFileSync("src/components/TeamMap/TeamMapPanel.module.css", "utf8");
    expect(onlyZIndex(teamMap, "backdrop")).toBe(MODAL_BACKDROP_LAYER);
    expect(onlyZIndex(notificationCss, "anchor")).toBeLessThan(MODAL_BACKDROP_LAYER);
  });

  it("is under the Player HUD in BOTH of the HUD's states, so it can never cover it", () => {
    // The HUD's two-step layering (70 normally, 50 while the Team Map is open) is intentional —
    // reward claim FX travel to the HUD and must stay lit above a modal backdrop.
    expect(onlyZIndex(hudCss, "hud")).toBe(70);
    expect(onlyZIndex(hudCss, "behindModal")).toBe(50);
    const anchor = onlyZIndex(notificationCss, "anchor");
    expect(anchor).toBeLessThan(50);
    expect(anchor).toBeLessThan(70);
  });

  it("is under the reward claim FX layer", () => {
    expect(onlyZIndex(css("rewardFx.module.css"), "layer")).toBeGreaterThan(
      onlyZIndex(notificationCss, "anchor"),
    );
  });

  it("is under the incoming-call prompt and the check-in modal", () => {
    const anchor = onlyZIndex(notificationCss, "anchor");
    expect(anchor).toBeLessThan(onlyZIndex(css("CallInvitePrompt.module.css"), "toast"));
    expect(anchor).toBeLessThan(onlyZIndex(css("CheckinModal.module.css"), "backdrop"));
  });
});

describe("the vertical feature column has one slot per control and no gap", () => {
  // The Hub/Map overlap was invisible in review because the two `top: 56px` declarations lived
  // in one shared class. Slots make a collision a duplicated NUMBER, which is checkable.
  function slotsIn(source: string): Map<string, number> {
    const out = new Map<string, number>();
    for (const block of source.matchAll(/\.([A-Za-z][\w-]*)\s*\{([^}]*)\}/g)) {
      const slot = /--vo-pill-slot:\s*(\d+)/.exec(block[2])?.[1];
      if (slot) out.set(block[1], Number(slot));
    }
    return out;
  }

  const officeSlots = slotsIn(officeCss);

  it("assigns Hub, Profile, Quests, Missions, Rewards, Boards, Map, Toucan, DEV Reset in order", () => {
    expect([...officeSlots.entries()].sort((a, b) => a[1] - b[1]).map(([cls]) => cls)).toEqual([
      "hubButton",
      "profileButton",
      "questsButton",
      "missionsButton",
      "rewardsButton",
      "boardsButton",
      "mapButton",
      "toucanButton",
      "hubDevResetButton",
    ]);
  });

  it("leaves no empty slot where Notifications used to be", () => {
    const slots = [...officeSlots.values()].sort((a, b) => a - b);
    expect(slots).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it("keeps the notification bell out of the column entirely", () => {
    expect(notificationCss).not.toMatch(/--vo-pill-slot:\s*\d/);
    expect(zIndexOf(notificationCss, "anchor")).toEqual([PILL_COLUMN_LAYER]);
  });

  it("gives the Team Map its own class, so it can no longer share the Hub's slot", () => {
    expect(officeCss).toMatch(/\.mapButton\s*\{/);
    expect(officeSlots.get("mapButton")).not.toBe(officeSlots.get("hubButton"));
  });

  it("never assigns one slot twice", () => {
    const all = [...officeSlots.values()];
    expect(new Set(all).size).toBe(all.length);
  });

  it("hardcodes no `top` on any slotted control, so the column has one source of truth", () => {
    for (const block of officeCss.matchAll(/\.([A-Za-z][\w-]*)\s*\{([^}]*)\}/g)) {
      if (!/--vo-pill-slot/.test(block[2])) continue;
      expect(block[2]).not.toMatch(/top:\s*\d+px/);
      expect(block[2]).toMatch(/top:\s*calc\(var\(--vo-pill-top\)/);
    }
  });

  it("derives every slot from the shared variables declared once, globally", () => {
    const globals = readFileSync("src/index.css", "utf8");
    expect(globals).toMatch(/:root\s*\{[^}]*--vo-pill-top:\s*56px/);
    expect(globals).toMatch(/:root\s*\{[^}]*--vo-pill-step:\s*40px/);
    expect(globals).toMatch(/@media \(max-height: 760px\)\s*\{\s*:root\s*\{\s*--vo-pill-step:\s*36px/);
  });

  it("fits the whole column above the fold on a short viewport", () => {
    const lowestPillBottom = 56 + Math.max(...officeSlots.values()) * 36 + 34;
    expect(lowestPillBottom).toBeLessThan(600);
  });
});

describe("the bell sits in the top-right utility row, beside the chat button", () => {
  const chatCss = readFileSync("src/components/Chat/MessageNotificationBadge.module.css", "utf8");
  const checkoutCss = readFileSync("src/components/OfficeMap/checkout/checkout.module.css", "utf8");

  function decl(source: string, className: string, prop: string): string | undefined {
    const block = new RegExp(`\\.${className}\\s*\\{([^}]*)\\}`).exec(source)?.[1] ?? "";
    return new RegExp(`(?:^|;|\\n)\\s*${prop}:\\s*([^;]+)`).exec(block)?.[1].trim();
  }

  const CHAT_RIGHT = 16;
  const ICON = 36;
  const GAP = 12;

  it("shares the chat button's top edge", () => {
    expect(decl(notificationCss, "anchor", "top")).toBe("12px");
    expect(decl(chatCss, "wrapper", "top")).toBe("12px");
  });

  it("sits exactly one icon + one row gap to the left of the chat button", () => {
    expect(decl(chatCss, "wrapper", "right")).toBe(`${CHAT_RIGHT}px`);
    expect(decl(chatCss, "iconButton", "width")).toBe(`${ICON}px`);
    expect(decl(notificationCss, "anchor", "right")).toBe(`${CHAT_RIGHT + ICON + GAP}px`);
  });

  it("matches the chat button's geometry, so the two read as one pair", () => {
    for (const prop of ["width", "height", "border-radius", "font-size"]) {
      expect(decl(notificationCss, "bell", prop)).toBe(decl(chatCss, "iconButton", prop));
    }
  });

  it("does not overlap the Working pill or the status picker", () => {
    const bellRight = CHAT_RIGHT + ICON + GAP;
    const working = Number(decl(checkoutCss, "statusBadge", "right")!.replace("px", ""));
    const workingWidth = Number(decl(checkoutCss, "statusBadge", "max-width")!.replace("px", ""));
    const pickerCss = readFileSync("src/components/OfficeMap/StatusPicker.module.css", "utf8");
    const picker = Number(decl(pickerCss, "picker", "right")!.replace("px", ""));

    // Row runs right-to-left: chat, bell, Working pill, picker — each clearing the last.
    expect(working).toBeGreaterThanOrEqual(bellRight + ICON);
    expect(picker).toBeGreaterThanOrEqual(working + workingWidth);
  });
});

describe("the panel stays inside the viewport", () => {
  it("opens downward from the bell and right-aligns to it", () => {
    expect(notificationCss).toMatch(/\.panel\s*\{[^}]*top:\s*calc\(100% \+ 8px\)/);
    expect(notificationCss).toMatch(/\.panel\s*\{[^}]*right:\s*0/);
  });

  it("clamps its width against the space actually left of the bell", () => {
    // 64px bell offset + a 12px left margin = 76px reserved.
    expect(notificationCss).toMatch(/width:\s*min\(340px,\s*calc\(100vw - 76px\)\)/);
  });

  it("clamps its height below the utility row and scrolls internally", () => {
    expect(notificationCss).toMatch(/max-height:\s*calc\(100vh - 68px\)/);
    expect(notificationCss).toMatch(/\.list\s*\{[^}]*overflow-y:\s*auto/);
  });

  it("spans the viewport on a narrow screen instead of becoming a sliver", () => {
    const narrow = /@media \(max-width: 460px\) \{([\s\S]*?)\n\}/.exec(notificationCss)?.[1] ?? "";
    expect(narrow).toMatch(/position:\s*fixed/);
    expect(narrow).toMatch(/left:\s*12px/);
    expect(narrow).toMatch(/right:\s*12px/);
    // Starts BELOW the utility row (12 + 36 + 8), so it adapts rather than covering it.
    expect(narrow).toMatch(/top:\s*56px/);
    // Still no z-index — `position: fixed` here resolves inside .anchor's stacking context.
    expect(narrow).not.toMatch(/z-index/);
  });
});

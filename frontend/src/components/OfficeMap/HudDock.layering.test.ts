// @ts-expect-error node:fs is untyped under tsconfig.app.json (types: ["vite/client"] only) and
// pulling in @types/node here would change global setTimeout typing for the whole app — same
// exemption services/attendance/mockRigConfig.test.ts takes. vitest runs in Node with
// cwd = frontend/, so the reads below are plain relative paths.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// LAYERING + PLACEMENT REGRESSION GUARD for the bottom dock.
//
// Replaces NotificationCenter.layering.test.ts, which guarded the scattered chrome the dock
// consolidated (the top:12px right-hand utility row and the vertical --vo-pill-slot feature
// column). The invariants it protected are all still here, re-expressed against the dock.
//
// jsdom applies no CSS, so a rendering test cannot prove where anything paints. What CAN be
// proven — and is exactly what broke twice before in this codebase (see RoomSidebar.module.css's
// and PlayerHud.module.css's z-index notes) — is the RELATIONSHIP between the office's stacking
// layers, so raising one z-index without thinking about the others fails here rather than in
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

/** One declaration's value out of one class block. */
function decl(source: string, className: string, prop: string): string | undefined {
  const block = new RegExp(`\\.${className}\\s*\\{([^}]*)\\}`).exec(source)?.[1] ?? "";
  return new RegExp(`(?:^|;|\\n)\\s*${prop}:\\s*([^;]+)`).exec(block)?.[1].trim();
}

const dockCss = css("HudDock.module.css");
const officeCss = css("OfficeMap.module.css");
const hudCss = css("PlayerHud.module.css");
const notificationCss = css("NotificationCenter.module.css");
const chatCss = readFileSync("src/components/Chat/MessageNotificationBadge.module.css", "utf8");
const checkoutCss = css("checkout/checkout.module.css");
const pickerCss = css("StatusPicker.module.css");
const searchCss = css("CharacterSearch.module.css");
const globals = readFileSync("src/index.css", "utf8");

const DOCK_LAYER = 70;
const UNDER_MODAL_LAYER = 50;
const UNDER_OVERLAY_LAYER = 20;
const MODAL_BACKDROP_LAYER = 60;

const MODAL_FAMILY = [
  "CompanyHub.module.css",
  "EmployeeProfile.module.css",
  "MissionsPanel.module.css",
  "OnboardingQuestline.module.css",
  "RewardsPanel.module.css",
] as const;

// Full-screen dock TOOLS hide the dock outright while they are open (OfficeMap's officeToolOpen
// -> HudDock's `hidden`), so they have nothing at the bottom of the screen to clear and
// deliberately do NOT reserve --vo-dock-clearance. Every other modal still coexists with a
// visible dock and must keep reserving it.
const DOCK_TOOL_PANELS = [
  "CompanyHub.module.css",
  "EmployeeProfile.module.css",
  "MissionsPanel.module.css",
  "OnboardingQuestline.module.css",
  "RewardsPanel.module.css",
] as const;
const COEXISTING_MODALS = MODAL_FAMILY.filter(
  (file) => !DOCK_TOOL_PANELS.includes(file as (typeof DOCK_TOOL_PANELS)[number]),
);

describe("the dock has exactly three layers and no arbitrary values", () => {
  it("sits at the layer the Player HUD always held", () => {
    expect(onlyZIndex(dockCss, "dock")).toBe(DOCK_LAYER);
  });

  it("steps below the z-index 60 modal family, and further below the 30/31 overlay family", () => {
    expect(onlyZIndex(dockCss, "behindModal")).toBe(UNDER_MODAL_LAYER);
    expect(onlyZIndex(dockCss, "behindOverlay")).toBe(UNDER_OVERLAY_LAYER);
    expect(UNDER_OVERLAY_LAYER).toBeLessThan(UNDER_MODAL_LAYER);
  });

  it("declares no other z-index anywhere — no escalation hidden in a flyout", () => {
    const all = [...dockCss.matchAll(/z-index:\s*(-?\d+)/g)].map((m) => Number(m[1]));
    expect([...new Set(all)].sort((a, b) => a - b)).toEqual([
      UNDER_OVERLAY_LAYER,
      UNDER_MODAL_LAYER,
      DOCK_LAYER,
    ]);
  });
});

describe("it stays above what reward FX need, and below everything it must", () => {
  it("stays ABOVE the modal backdrops in its base state, so claim FX travel into a lit dock", () => {
    // The coins / XP readouts inside the dock are the FX destination ([data-hud-target], see
    // rewardFx.ts), and a claim is made from inside a z-index 60 modal.
    expect(onlyZIndex(dockCss, "dock")).toBeGreaterThan(MODAL_BACKDROP_LAYER);
  });

  it("is under the reward claim FX layer", () => {
    expect(onlyZIndex(css("rewardFx.module.css"), "layer")).toBeGreaterThan(onlyZIndex(dockCss, "dock"));
  });

  it.each(MODAL_FAMILY)("steps under the %s backdrop", (file) => {
    expect(onlyZIndex(css(file), "backdrop")).toBe(MODAL_BACKDROP_LAYER);
    expect(onlyZIndex(dockCss, "behindModal")).toBeLessThan(MODAL_BACKDROP_LAYER);
  });

  it("steps under the Team Map panel — the HUD's original behindModal case", () => {
    const teamMap = readFileSync("src/components/TeamMap/TeamMapPanel.module.css", "utf8");
    expect(onlyZIndex(teamMap, "backdrop")).toBe(MODAL_BACKDROP_LAYER);
    expect(onlyZIndex(dockCss, "behindModal")).toBeLessThan(MODAL_BACKDROP_LAYER);
  });

  it("steps under the check-in modal, the overtime prompt and every checkout step", () => {
    // These live at 30/31, which .behindModal's 50 would NOT clear — hence the second step.
    const overlays = [
      onlyZIndex(css("CheckinModal.module.css"), "backdrop"),
      onlyZIndex(css("StatusOvertimePrompt.module.css"), "backdrop"),
      onlyZIndex(checkoutCss, "backdrop"),
      onlyZIndex(checkoutCss, "panel"),
    ];
    for (const overlay of overlays) {
      expect(onlyZIndex(dockCss, "behindOverlay")).toBeLessThan(overlay);
    }
  });

  it("does not need to out-rank the bottom-corner toasts, because they clear its strip", () => {
    // These all sit BELOW the dock's 70 (15-28), so overlap had to be solved positionally rather
    // than by layering: each bottom-anchored element now offsets from --vo-dock-clearance.
    const bottomAnchored = [
      [officeCss, "toast"],
      [officeCss, "floatingChatSlot"],
      [checkoutCss, "toast"],
      [checkoutCss, "walkIndicator"],
      [css("DndRequestUI.module.css"), "toast"],
      [css("CallInvitePrompt.module.css"), "toast"],
      [css("AudioDebugPanel.module.css"), "panel"],
    ] as const;
    for (const [source, cls] of bottomAnchored) {
      expect(decl(source, cls, "bottom")).toMatch(/var\(--vo-dock-clearance/);
    }
  });
});

describe("modals reserve the dock's strip rather than the dock out-ranking them", () => {
  it("declares the clearance once, globally", () => {
    expect(globals).toMatch(/:root\s*\{[^}]*--vo-dock-clearance:\s*104px/);
    expect(globals).toMatch(/@media \(max-height: 760px\)\s*\{\s*:root\s*\{\s*--vo-dock-clearance:\s*96px/);
  });

  it.each([...COEXISTING_MODALS, "../TeamMap/TeamMapPanel.module.css"] as const)(
    "%s keeps its centred panel clear of the dock",
    (file) => {
      const backdrop = new RegExp(`\\.backdrop\\s*\\{([^}]*)\\}`).exec(css(file))?.[1] ?? "";
      expect(backdrop).toMatch(/padding-bottom:\s*var\(--vo-dock-clearance/);
      expect(backdrop).toMatch(/box-sizing:\s*border-box/);
    },
  );

  it.each(DOCK_TOOL_PANELS)(
    "%s does not reserve dock clearance, because the dock is hidden while it is open",
    (file) => {
      const backdrop = new RegExp(`\\.backdrop\\s*\\{([^}]*)\\}`).exec(css(file))?.[1] ?? "";
      expect(backdrop).not.toMatch(/--vo-dock-clearance/);
      expect(backdrop).toMatch(/box-sizing:\s*border-box/);
    },
  );

  // A stale duplicate .backdrop later in a stylesheet silently wins the cascade while the
  // assertions above — which read the FIRST match — still pass. Pin uniqueness so that a
  // rewritten shell leaving its old rule behind fails here instead of in the browser.
  it.each([...MODAL_FAMILY, "../TeamMap/TeamMapPanel.module.css"] as const)(
    "%s defines .backdrop exactly once",
    (file) => {
      const blocks = css(file).match(/^\.backdrop\s*\{/gm) ?? [];
      expect(blocks).toHaveLength(1);
    },
  );

  it("hides the dock for any full-screen dock tool", () => {
    expect(dockCss).toMatch(/\.hidden\s*\{[^}]*translate/);
    expect(dockCss).toMatch(/\.dock\s*\{[^}]*transition:/);
  });
});

describe("the controls inside the dock cannot escape it", () => {
  it("the notification panel, bell and badge declare no z-index of their own", () => {
    // The panel is a child of .anchor, which is inside the dock's stacking context. Giving any of
    // them a literal z-index would be the one edit that could float a flyout above a modal.
    expect(zIndexOf(notificationCss, "panel")).toEqual([]);
    expect(zIndexOf(notificationCss, "bell")).toEqual([]);
    expect(zIndexOf(notificationCss, "badge")).toEqual([]);
    expect(zIndexOf(notificationCss, "list")).toEqual([]);
  });

  it("every dock-resident root takes its z-index from --vo-chrome-z, which the dock sets to auto", () => {
    for (const [source, cls] of [
      [notificationCss, "anchor"],
      [chatCss, "wrapper"],
      [checkoutCss, "statusBadge"],
      [pickerCss, "picker"],
      [searchCss, "search"],
    ] as const) {
      expect(decl(source, cls, "z-index")).toMatch(/^var\(--vo-chrome-z,/);
    }
    expect(decl(dockCss, "dock", "--vo-chrome-z")).toBe("auto");
  });

  it("every dock-resident root takes its position from --vo-chrome-position, made in-flow by the dock", () => {
    for (const [source, cls] of [
      [hudCss, "hud"],
      [notificationCss, "anchor"],
      [chatCss, "wrapper"],
      [checkoutCss, "statusBadge"],
      [pickerCss, "picker"],
      [searchCss, "search"],
    ] as const) {
      const position = decl(source, cls, "position");
      // PlayerHud switches layout with an explicit .hudDock variant rather than a variable.
      if (cls === "hud") expect(decl(hudCss, "hudDock", "position")).toBe("static");
      else expect(position).toMatch(/^var\(--vo-chrome-position,/);
    }
    expect(decl(dockCss, "dock", "--vo-chrome-position")).toBe("relative");
  });
});

describe("flyouts open upward, into the office rather than off the bottom edge", () => {
  it("the dock flips the flyout anchor", () => {
    expect(decl(dockCss, "dock", "--vo-flyout-top")).toBe("auto");
    expect(decl(dockCss, "dock", "--vo-flyout-bottom")).toBe("calc(100% + 14px)");
  });

  it.each([
    ["notification panel", notificationCss, "panel"],
    ["chat dropdown", chatCss, "dropdown"],
    ["DND duration popover", pickerCss, "popover"],
  ] as const)("the %s reads both edges from the flyout variables", (_name, source, cls) => {
    expect(decl(source, cls, "top")).toMatch(/^var\(--vo-flyout-top,/);
    expect(decl(source, cls, "bottom")).toMatch(/^var\(--vo-flyout-bottom,\s*auto\)/);
  });

  it("the dock's own flyouts (Search, Settings) open upward too", () => {
    expect(decl(dockCss, "flyout", "bottom")).toBe("calc(100% + 14px)");
    // Trailing-edge flyouts (•••) right-align to their tile instead of hanging past the dock.
    expect(decl(dockCss, "flyoutEnd", "right")).toBe("0");
  });

  it("keeps the narrow-viewport notification panel above the dock instead of behind it", () => {
    const narrow = /@media \(max-width: 460px\) \{([\s\S]*?)\n\}/.exec(notificationCss)?.[1] ?? "";
    expect(narrow).toMatch(/position:\s*fixed/);
    expect(narrow).toMatch(/left:\s*12px/);
    expect(narrow).toMatch(/right:\s*12px/);
    expect(narrow).toMatch(/top:\s*var\(--vo-flyout-narrow-top,\s*56px\)/);
    expect(narrow).toMatch(/bottom:\s*var\(--vo-flyout-narrow-bottom,\s*auto\)/);
    // Still no z-index — `position: fixed` here resolves inside .anchor's stacking context.
    expect(narrow).not.toMatch(/z-index/);
    expect(decl(dockCss, "dock", "--vo-flyout-narrow-bottom")).toBe("104px");
  });

  it("every flyout is width-clamped and height-capped, so none can push the page around", () => {
    expect(notificationCss).toMatch(/width:\s*min\(340px,\s*calc\(100vw - 76px\)\)/);
    expect(decl(dockCss, "flyout", "max-width")).toBe("calc(100vw - 32px)");
    expect(decl(dockCss, "flyout", "max-height")).toBe("calc(100vh - 148px)");
    expect(decl(dockCss, "flyout", "overflow-y")).toBe("auto");
  });
});

describe("the dock itself never creates horizontal overflow", () => {
  it("is centred and clamped to the viewport", () => {
    expect(decl(dockCss, "dock", "position")).toBe("fixed");
    expect(decl(dockCss, "dock", "bottom")).toBe("16px");
    expect(decl(dockCss, "dock", "left")).toBe("50%");
    expect(decl(dockCss, "dock", "transform")).toBe("translateX(-50%)");
    expect(decl(dockCss, "dock", "max-width")).toBe("calc(100vw - 24px)");
    expect(decl(dockCss, "dock", "box-sizing")).toBe("border-box");
  });

  it("compacts spacing first, then drops tile captions — and never hides a feature", () => {
    // ••• is Settings, not an overflow drawer, so there is nowhere for a feature to be hidden;
    // compaction is spacing and captions only.
    expect(dockCss).toMatch(/@media \(max-width: 1200px\)[\s\S]*?\.tile\s*\{\s*width:\s*44px/);
    expect(dockCss).toMatch(/@media \(max-width: 1000px\)[\s\S]*?\.tileLabel\s*\{\s*display:\s*none/);
    expect(dockCss).toMatch(/@media \(max-width: 720px\)/);
    // The chat tile is a separate component and has to compact in step with the dock's own tiles.
    for (const width of ["1200px", "1000px", "720px"]) {
      expect(chatCss).toMatch(new RegExp(`@media \\(max-width: ${width}\\)`));
    }
  });

  it("never hides the reward FX targets, which would measure as a zero rect", () => {
    // .coins / .coinsPulse / .meter / .meterPulse carry [data-hud-target] (see PlayerHud.tsx) and
    // .progressGroup is their dock wrapper. A display:none target measures as a zero rect, which
    // would fling the claim icons at the viewport's top-left corner. Checked across the WHOLE
    // stylesheet, media queries included — .coinsLabel and .name are the only hideable bits.
    for (const cls of ["progressGroup", "coins", "coinsPulse", "meter", "meterPulse"]) {
      const rules = hudCss.matchAll(new RegExp(`\\.${cls}(?![\\w-])[^{]*\\{([^}]*)\\}`, "g"));
      for (const rule of rules) expect(rule[1]).not.toMatch(/display:\s*none/);
    }
  });
});

describe("the chrome the dock replaced is really gone", () => {
  it("removes the whole --vo-pill-slot feature column", () => {
    expect(officeCss).not.toMatch(/--vo-pill-slot:\s*\d/);
    expect(globals).not.toMatch(/--vo-pill-(top|step):\s*\d/);
  });

  it("keeps the Toucan as its own floating button, clear of the dock and on its layer", () => {
    // The reference dock holds twelve controls and the Toucan is not one of them, so it stayed a
    // standalone round button beside the dock rather than moving in or being buried in Settings.
    expect(onlyZIndex(officeCss, "toucanButton")).toBe(DOCK_LAYER);
    expect(decl(officeCss, "toucanButton", "bottom")).toBe("16px");
    expect(decl(officeCss, "toucanButton", "right")).toBe("16px");
  });

  it("leaves behind no orphaned pill class for a control that moved into the dock", () => {
    for (const pill of [
      "hubButton",
      "profileButton",
      "questsButton",
      "missionsButton",
      "rewardsButton",
      "boardsButton",
      "mapButton",
      "hubDevResetButton",
    ]) {
      expect(officeCss).not.toMatch(new RegExp(`\\.${pill}\\s*[,{]`));
    }
  });

  it("keeps every moved control's standalone geometry as the variable DEFAULT, unforked", () => {
    // Rendering any of these outside the dock must still work exactly as it did before.
    expect(decl(pickerCss, "picker", "top")).toBe("var(--vo-chrome-top, 12px)");
    expect(decl(notificationCss, "anchor", "right")).toBe("var(--vo-chrome-right, 64px)");
    expect(decl(chatCss, "wrapper", "right")).toBe("var(--vo-chrome-right, 16px)");
    expect(decl(checkoutCss, "statusBadge", "right")).toBe("var(--vo-chrome-right, 112px)");
  });
});

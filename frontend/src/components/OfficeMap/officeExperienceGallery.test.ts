import { describe, expect, it } from "vitest";
import {
  PERMANENT_GALLERY,
  SEASONAL_PRESENTATION,
  galleryFor,
  selectableGalleryEntries,
} from "./officeExperienceGallery";
import { PERMANENT_FALLBACK, type ExperienceCatalog } from "../../services/office/experienceCatalog";
import type { OfficeExperience } from "../../services/settings/officeExperience";

function catalog(overrides: Partial<ExperienceCatalog> = {}): ExperienceCatalog {
  return { ...PERMANENT_FALLBACK, status: "ok", ...overrides };
}

describe("which seasons this build can picture", () => {
  it("has both shipped seasons, each with a real capture", () => {
    // A card is a promise that the place on it exists, so an entry here means BOTH halves shipped:
    // the decoration layer under dev/vo3d/season/, and a photograph of the office it produces.
    // Halloween arrived that way in Phase 9B and White Christmas the same way after it.
    expect(Object.keys(SEASONAL_PRESENTATION).sort()).toEqual(["christmas", "halloween"]);
    expect(SEASONAL_PRESENTATION.halloween?.art).toBeTruthy();
    expect(SEASONAL_PRESENTATION.christmas?.art).toBeTruthy();
  });

  it("pictures nothing for a season this build does not know how to draw", () => {
    // THE SECOND LOCK, behind the server's own IMPLEMENTED_EXPERIENCES gate, and it has to keep being
    // tested even when every known season happens to be picturable — because the NEXT season starts
    // out unpicturable and this is what stops a card promising it early.
    const saved = SEASONAL_PRESENTATION.christmas;
    delete SEASONAL_PRESENTATION.christmas;
    try {
      const entries = galleryFor(
        catalog({ available: ["v2", "classic"], previewable: ["christmas"], creator: true }),
      );
      expect(entries.map((entry) => entry.value)).toEqual(["v2", "classic"]);
    } finally {
      SEASONAL_PRESENTATION.christmas = saved;
    }
  });

  it("shows the two permanent offices, each with a real capture", () => {
    const entries = galleryFor(catalog());
    expect(entries.map((entry) => entry.value)).toEqual(["v2", "classic"]);
    for (const entry of entries) {
      expect(entry.art).toBeTruthy();
      expect(entry.comingSoon).toBeUndefined();
      expect(entry.unpublished).toBeUndefined();
    }
  });

  it("shows a published Halloween and a Creator's unpublished Christmas, labelled apart", () => {
    const entries = galleryFor(
      catalog({ available: ["v2", "classic", "halloween"], previewable: ["christmas"], creator: true }),
    );
    expect(entries.map((entry) => entry.value)).toEqual(["v2", "classic", "halloween", "christmas"]);
    // The private preview is SELECTABLE — that is the point of it — but it is marked, so a Creator is
    // never in any doubt about whether their colleagues can see what they are looking at.
    expect(entries.find((e) => e.value === "halloween")?.unpublished).toBeUndefined();
    expect(entries.find((e) => e.value === "christmas")?.unpublished).toBe(true);
  });
});

// ══ WHAT HAPPENS ONCE A SEASON IS REAL ══
//
// Asserted against an injected presentation entry rather than a shipped one, so the behaviour is
// proven now and no fake office reaches anybody. Adding a real season is exactly this: one object in
// SEASONAL_PRESENTATION, plus its identifier joining the backend's IMPLEMENTED_EXPERIENCES.
describe("once a season has a presentation", () => {
  const withHalloween = <T>(run: () => T): T => {
    SEASONAL_PRESENTATION.halloween = {
      label: "Halloween Office",
      hint: "The office, decorated",
      art: "halloween.webp",
    };
    try {
      return run();
    } finally {
      delete SEASONAL_PRESENTATION.halloween;
    }
  };

  it("appears as an ordinary card when the server lists it as available", () => {
    withHalloween(() => {
      const entries = galleryFor(catalog({ available: ["v2", "classic", "halloween"] }));
      expect(entries.map((entry) => entry.value)).toEqual(["v2", "classic", "halloween"]);
      expect(entries[2].unpublished).toBeUndefined();
    });
  });

  it("appears BADGED when it is only in a Creator's preview set", () => {
    withHalloween(() => {
      const entries = galleryFor(catalog({ previewable: ["halloween"], creator: true }));
      expect(entries[2].value).toBe("halloween");
      // Selectable — previewing it on the live site is the point — but never silently private.
      expect(entries[2].unpublished).toBe(true);
      expect(entries[2].comingSoon).toBeUndefined();
    });
  });

  it("is listed once when it is both available and previewable", () => {
    withHalloween(() => {
      const entries = galleryFor(
        catalog({ available: ["v2", "classic", "halloween"], previewable: ["halloween"], creator: true }),
      );
      expect(entries.filter((entry) => entry.value === "halloween")).toHaveLength(1);
    });
  });

  it("is still absent for an employee the server did not list it for", () => {
    withHalloween(() => {
      expect(galleryFor(catalog()).map((entry) => entry.value)).toEqual(["v2", "classic"]);
    });
  });
});

describe("the gallery and the allowed set cannot drift", () => {
  it("every card shown is one the caller is allowed to pick", () => {
    const allowed: OfficeExperience[] = ["v2", "classic"];
    const entries = galleryFor(catalog());
    expect(selectableGalleryEntries(entries, allowed)).toEqual(entries);
  });

  it("a card for something not allowed is filtered out", () => {
    const entries = [...PERMANENT_GALLERY, { value: "halloween" as const, label: "x", hint: "y", art: "z" }];
    expect(selectableGalleryEntries(entries, ["v2", "classic"]).map((e) => e.value)).toEqual([
      "v2",
      "classic",
    ]);
  });
});

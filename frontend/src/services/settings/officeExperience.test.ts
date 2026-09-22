import { beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_OFFICE_EXPERIENCE,
  getOfficeExperience,
  getStoredOfficeExperience,
  officeExperienceFromUrl,
  PERMANENT_OFFICE_EXPERIENCES,
  resolveOfficeExperience,
  setOfficeExperience,
  subscribeOfficeExperience,
  __resetOfficeExperienceForTests,
} from "./officeExperience";
import { resetCurrentUserForTests, setCurrentUserFromMeResponse } from "../../auth/currentUserStore";

const KEY = (viewer: string) => `vo:officeExperience:v1:${viewer}`;

beforeEach(() => {
  window.localStorage.clear();
  resetCurrentUserForTests();
  __resetOfficeExperienceForTests();
});

describe("the default", () => {
  it("is the 3D office, for somebody who has never opened the setting", () => {
    expect(DEFAULT_OFFICE_EXPERIENCE).toBe("v2");
    expect(getOfficeExperience()).toBe("v2");
  });
});

describe("what is not a preference", () => {
  // A hand-edited or stale payload is not a choice anybody made, so the answer is the same one somebody
  // who never opened the setting gets — never a blank office and never a throw.
  it.each([JSON.stringify("nonsense"), JSON.stringify(null), JSON.stringify({ v: 1 }), "{oops", ""])(
    "falls back to the default for %j",
    (payload) => {
      window.localStorage.setItem(KEY("anon"), payload);
      __resetOfficeExperienceForTests();
      expect(getOfficeExperience()).toBe("v2");
    },
  );

  it("refuses to store a value the UI could not have produced", () => {
    setOfficeExperience("banana" as never);
    expect(getOfficeExperience()).toBe("v2");
  });
});

describe("per authenticated employee", () => {
  it("remembers one employee's choice without giving it to the next one on this browser", () => {
    setCurrentUserFromMeResponse({ id: 1, email: "bon@offshorly.com", full_name: "Bon" } as never);
    setOfficeExperience("classic");
    expect(getOfficeExperience()).toBe("classic");
    expect(window.localStorage.getItem(KEY("bon@offshorly.com"))).toBe('"classic"');

    setCurrentUserFromMeResponse({ id: 2, email: "Alex@Offshorly.com", full_name: "Alex" } as never);
    // A different person, on the same browser, in the default office.
    expect(getOfficeExperience()).toBe("v2");

    // And Bon's choice is still Bon's when Bon comes back — including through a case-different email,
    // which is the same key.
    setCurrentUserFromMeResponse({ id: 1, email: "BON@offshorly.com", full_name: "Bon" } as never);
    expect(getOfficeExperience()).toBe("classic");
  });

  it("notifies subscribers when the signed-in employee changes the answer", () => {
    let calls = 0;
    const stop = subscribeOfficeExperience(() => { calls += 1; });
    setOfficeExperience("classic");
    expect(calls).toBe(1);
    // Writing the value it already holds is not a change.
    setOfficeExperience("classic");
    expect(calls).toBe(1);
    stop();
    setOfficeExperience("v2");
    expect(calls).toBe(1);
  });
});

describe("the URL override", () => {
  it("reads only the words that mean something", () => {
    expect(officeExperienceFromUrl("?world=v1")).toBe("classic");
    expect(officeExperienceFromUrl("?world=v2")).toBe("v2");
    expect(officeExperienceFromUrl("?world=banana")).toBeNull();
    expect(officeExperienceFromUrl("?room=dev")).toBeNull();
    expect(officeExperienceFromUrl("")).toBeNull();
  });

  // PHASE 9A. A seasonal name PARSES, because that is how a Creator opens a private preview in one
  // tab. Parsing is not permission: resolution intersects it with the server's allowed set, which the
  // next block is about.
  it("parses a seasonal name without that meaning anything on its own", () => {
    expect(officeExperienceFromUrl("?world=halloween")).toBe("halloween");
    expect(officeExperienceFromUrl("?world=christmas")).toBe("christmas");
  });

  it("beats the saved preference in both directions, and falls through when absent", () => {
    setOfficeExperience("classic");
    expect(resolveOfficeExperience("?world=v2")).toBe("v2");
    expect(resolveOfficeExperience("")).toBe("classic");

    setOfficeExperience("v2");
    expect(resolveOfficeExperience("?world=v1")).toBe("classic");
    expect(resolveOfficeExperience("?world=banana")).toBe("v2");
  });
});

// ══ PHASE 9A — RESOLUTION AGAINST THE SERVER'S ALLOWED SET ══
//
// Every step of `resolveOfficeExperience` is intersected with what the server listed for this
// identity. These are the unit-level proofs of the property App.v2route.test.tsx asserts end to end.

const PERMANENT = PERMANENT_OFFICE_EXPERIENCES;
const WITH_HALLOWEEN = [...PERMANENT_OFFICE_EXPERIENCES, "halloween"] as const;

describe("what the allowed set does to each step", () => {
  it("defaults to the PERMANENT offices when no allowed set is passed — it fails closed", () => {
    // A caller who forgot the catalog, or one running before it landed, must not get a season.
    setOfficeExperience("halloween");
    expect(resolveOfficeExperience("")).toBe("v2");
    expect(resolveOfficeExperience("?world=halloween")).toBe("v2");
  });

  it("ignores a URL override naming something the server did not list", () => {
    expect(resolveOfficeExperience("?world=halloween", PERMANENT, "v2")).toBe("v2");
  });

  it("honours a URL override naming something the server DID list", () => {
    expect(resolveOfficeExperience("?world=halloween", WITH_HALLOWEEN, "v2")).toBe("halloween");
  });

  it("ignores a saved preference naming something the server did not list", () => {
    setOfficeExperience("halloween");
    expect(resolveOfficeExperience("", PERMANENT, "v2")).toBe("v2");
  });

  it("honours a saved preference naming something the server DID list", () => {
    setOfficeExperience("halloween");
    expect(resolveOfficeExperience("", WITH_HALLOWEEN, "v2")).toBe("halloween");
  });

  it("KEEPS the unavailable saved preference rather than erasing it", () => {
    // The same mechanism that makes tampering inert is what lets a real seasonal choice survive an
    // unpublish and come back when the season does.
    setOfficeExperience("halloween");
    expect(resolveOfficeExperience("", PERMANENT, "v2")).toBe("v2");
    expect(getStoredOfficeExperience()).toBe("halloween");
    expect(window.localStorage.getItem(KEY("anon"))).toBe(JSON.stringify("halloween"));
  });
});

describe("the company default", () => {
  it("applies to somebody who has never chosen", () => {
    expect(getStoredOfficeExperience()).toBeNull();
    expect(resolveOfficeExperience("", PERMANENT, "classic")).toBe("classic");
  });

  it("does NOT apply to somebody who chose — including somebody who chose the 3D office", () => {
    // The case that made "never chose" a separate fact from "chose v2": collapsing them would move
    // every employee who had explicitly picked the 3D office the moment a Creator set the default.
    setOfficeExperience("v2");
    expect(getStoredOfficeExperience()).toBe("v2");
    expect(resolveOfficeExperience("", PERMANENT, "classic")).toBe("v2");
  });

  it("falls back to the 3D office when the default itself is not allowed", () => {
    expect(resolveOfficeExperience("", PERMANENT, "halloween")).toBe("v2");
  });

  it("is beaten by an allowed URL override", () => {
    expect(resolveOfficeExperience("?world=v1", PERMANENT, "v2")).toBe("classic");
  });
});

describe("what may be held in storage", () => {
  it("accepts a seasonal value — holding one has never been what opens an office", () => {
    setOfficeExperience("christmas");
    expect(getOfficeExperience()).toBe("christmas");
  });

  it("still refuses a value no build recognises", () => {
    window.localStorage.setItem(KEY("anon"), JSON.stringify("banana"));
    __resetOfficeExperienceForTests();
    expect(getStoredOfficeExperience()).toBeNull();
    expect(getOfficeExperience()).toBe("v2");
  });
});

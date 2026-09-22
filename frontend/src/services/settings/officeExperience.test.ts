import { beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_OFFICE_EXPERIENCE,
  getOfficeExperience,
  officeExperienceFromUrl,
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
  it("reads only the two words that mean something", () => {
    expect(officeExperienceFromUrl("?world=v1")).toBe("classic");
    expect(officeExperienceFromUrl("?world=v2")).toBe("v2");
    expect(officeExperienceFromUrl("?world=banana")).toBeNull();
    expect(officeExperienceFromUrl("?room=dev")).toBeNull();
    expect(officeExperienceFromUrl("")).toBeNull();
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

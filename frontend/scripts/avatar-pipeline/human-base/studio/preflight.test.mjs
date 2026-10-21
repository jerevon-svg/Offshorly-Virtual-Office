// preflight.test.mjs — a real (paid) run is READY only when every critical check holds. From frontend/:
//   npx vitest run scripts/avatar-pipeline/human-base/studio/preflight.test.mjs
import { describe, expect, it } from "vitest";
import { preflight } from "./preflight.mjs";

const P = "p".repeat(64), GiB = 1024 ** 3;
const deps = (over = {}) => ({
  upload: () => ({ photo: "up/newhire.photo.jpg", email: "new.hire@offshorly.com", consent: { statement: "self-photo-v1", by: "new.hire@offshorly.com", at: "t", photoSha256: P } }),
  owners: () => ({ newhire: "new.hire@offshorly.com" }), registry: () => ({ "jerevon@offshorly.com": "bon" }), promoted: () => ({}),
  simulated: () => [], pipelineOpts: () => ({}), state: () => ({ illustration: { exists: false } }), planFor: () => ({ stage: "illustrate", action: "needs-approval" }),
  sha: () => P, exists: () => true, keys: () => ({ openai: true, meshy: true }), balance: async () => 587, diskFree: () => 7 * GiB,
  ledger: () => [], authority: () => null, authorizeDry: async () => ({ allowed: true, failures: [] }), budget: async () => ({ autospendEnabled: false }), ...over,
});
const failed = async (over) => (await preflight("newhire", deps(over))).checks.filter((c) => !c.ok && c.critical).map((c) => c.id);

describe("preflight for one real run", () => {
  it("is READY for a consenting, correctly identified, unsimulated person with keys, balance and disk", async () => {
    const r = await preflight("newhire", deps()); expect(r.ready).toBe(true); expect(r.email).toBe("new.hire@offshorly.com");
  });
  it("refuses a photo without consent — or with consent for a different photo", async () => {
    expect(await failed({ upload: () => ({ photo: "x.jpg", email: "new.hire@offshorly.com" }) })).toEqual(["consent"]);
    expect(await failed({ upload: () => ({ photo: "x.jpg", email: "new.hire@offshorly.com", consent: { statement: "s", by: "e", at: "t", photoSha256: "0".repeat(64) } }) })).toEqual(["consent"]);
  });
  it("refuses an identity the app would not derive from the email, or one the ledger gives to someone else", async () => {
    expect(await failed({ owners: () => ({ newhire: "someone@offshorly.com" }) })).toContain("identity");
    expect(await failed({ owners: () => ({}), upload: () => ({ ...deps().upload(), email: "jerevon@offshorly.com" }) })).toContain("identity");
  });
  it("refuses anything simulated, borrowed or uploaded in place of a generation", async () => {
    expect(await failed({ simulated: () => ["meshy"] })).toEqual(["not_simulated"]);
    expect(await failed({ pipelineOpts: () => ({ mock: { meshy: "lui" } }) })).toEqual(["not_simulated"]);
    expect(await failed({ state: () => ({ illustration: { exists: true, mode: "uploaded" } }) })).toEqual(["not_simulated"]);
  });
  it("refuses missing keys, a balance below head + reserve, too little disk and a spent attempt on these inputs", async () => {
    expect(await failed({ keys: () => ({ openai: false, meshy: true }) })).toEqual(["keys"]);
    expect(await failed({ balance: async () => 120 })).toEqual(["meshy_balance"]);
    expect(await failed({ diskFree: () => 2 * GiB })).toEqual(["disk"]);
    expect((await preflight("newhire", deps({ diskFree: () => 5 * GiB }))).ready).toBe(true);                 // below recommended: a warning, not a stop
    expect(await failed({ ledger: () => [{ who: "newhire", stage: "illustrate", inputSha256: P, at: new Date().toISOString(), outcome: "failed" }] })).toEqual(["spend_rules"]);
  });
  it("refuses a frozen or already-approved character", async () => {
    expect(await failed({ promoted: () => ({ newhire: {} }) })).toEqual(["no_existing_character"]);
  });
  it("with an authority configured, its dry-run verdict decides", async () => {
    const r = await preflight("newhire", deps({ authority: () => ({ url: "u", key: "k" }), authorizeDry: async () => ({ allowed: false, failures: [{ code: "budget_exhausted" }] }) }));
    expect(r.ready).toBe(false); expect(r.checks.find((c) => c.id === "authority").detail).toMatch(/budget_exhausted/);
  });
});

describe("preflight for the approved-illustration path (no photo)", () => {
  const R = "r".repeat(64), rec = { status: "prepared", illustration: { sha256: P }, reference: { path: "ref.png", sha256: R }, prep: { art: "flat", frame: { pixels: 49 }, inpainted: 58472 } };
  const ill = (over = {}) => deps({ upload: () => null, owners: () => ({}), source: () => "Esson_Sprite.png", headRecord: () => rec, rawHead: () => false, recipe: () => ({ hair: "natural" }),
    sha: (f) => (f === "ref.png" ? R : P), state: () => ({ qa: { done: true, pass: true } }), ...over });
  const bad = async (over) => (await preflight("esson", ill(over))).checks.filter((c) => !c.ok && c.critical).map((c) => c.id);
  it("is READY with a clean prepared sprite reference, a recipe, QA passed, balance and no earlier head — no photo, consent or OpenAI key", async () => {
    const r = await preflight("esson", ill({ keys: () => ({ openai: false, meshy: true }) })); expect(r.path).toBe("approved-illustration"); expect(r.ready).toBe(true);
    expect(r.checks.find((c) => c.id === "identity").detail).toMatch(/esson@offshorly.com \(localpart rule/);
  });
  it("refuses a used, changed or non-sprite reference, a missing recipe, an existing head and the configured authority", async () => {
    expect(await bad({ headRecord: () => ({ ...rec, status: "generated" }) })).toEqual(["reference"]);
    expect(await bad({ sha: () => P })).toEqual(["reference"]);
    expect(await bad({ headRecord: () => ({ ...rec, prep: { frame: { pixels: 853718 }, inpainted: 1087728 } }) })).toEqual(["reference"]);
    expect(await bad({ recipe: () => null })).toEqual(["recipe"]);
    expect(await bad({ rawHead: () => true })).toEqual(["no_existing_character"]);
    expect(await bad({ authority: () => ({ url: "x", key: "y" }) })).toEqual(["authority"]);
    expect(await bad({ state: () => ({ qa: { done: true, pass: false, failed: ["flatHouseStyle"] } }) })).toEqual(["illustration_qa"]);
  });
});

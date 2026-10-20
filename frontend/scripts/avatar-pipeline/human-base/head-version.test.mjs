// head-version.test.mjs — a person's raw Meshy head is VERSIONED data: v1 keeps the original layout, a newer paid head is its own
// folder (never an overwrite), and the version comes only from the recipe. Temp roots only. From frontend/:
//   npx vitest run scripts/avatar-pipeline/human-base/head-version.test.mjs
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { headRefDir, headVersion, nextHeadVersion, rawHeadFile, recipeHeadVersion } from "./head-version.mjs";

const made = [], scratch = (prefix) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix)); made.push(d); return d; };
afterAll(() => { for (const d of made) fs.rmSync(d, { recursive: true, force: true }); });

describe("head versions", () => {
  it("defaults to v1 and refuses anything that is not v<N>", () => {
    expect(headVersion(undefined)).toBe("v1");
    expect(headVersion({ hair: "natural" })).toBe("v1");
    expect(headVersion({ head: "v2" })).toBe("v2");
    for (const bad of ["v0", "2", "v2/../v1", "V2", "", 2, "latest"]) expect(() => headVersion({ head: bad })).toThrow(/invalid head version/);
  });

  it("v1 keeps the original layout; a newer version is its own folder and reference", () => {
    expect(rawHeadFile("nicole", "v1", "M")).toBe("M/nicole-head-v1/raw-untouched/nicole-head-v1-raw-model.glb");
    expect(rawHeadFile("nicole", "v2", "M")).toBe("M/nicole-head-v2/raw-untouched/nicole-head-v2-raw-model.glb");
    expect(headRefDir("nicole", "v1", "R")).toBe("R/nicole");
    expect(headRefDir("nicole", "v2", "R")).toBe("R/nicole/head-v2");
  });

  it("a new head only ever goes to a version with no Meshy folder and no prepared reference", () => {
    const M = scratch("hv-m-"), R = scratch("hv-r-");
    expect(nextHeadVersion("zz", { M, R })).toBe("v2");
    fs.mkdirSync(`${M}/zz-head-v2`);
    expect(nextHeadVersion("zz", { M, R })).toBe("v3");
    fs.mkdirSync(`${R}/zz/head-v3`, { recursive: true });
    expect(nextHeadVersion("zz", { M, R })).toBe("v4");
  });

  it("reads the recipe's head; a person without a recipe uses v1; an invalid one throws", () => {
    const f = path.join(scratch("hv-rec-"), "employees.json");
    fs.writeFileSync(f, JSON.stringify({ employees: { a: { hair: "x" }, b: { head: "v2" }, c: { head: "latest" } } }));
    expect(recipeHeadVersion("a", f)).toBe("v1");
    expect(recipeHeadVersion("b", f)).toBe("v2");
    expect(recipeHeadVersion("nobody", f)).toBe("v1");
    expect(() => recipeHeadVersion("c", f)).toThrow(/invalid head version/);
  });

  it("every production recipe names a valid head version", () => {
    const R = JSON.parse(fs.readFileSync("scripts/avatar-pipeline/human-base/employees.json", "utf8")).employees;
    for (const who of Object.keys(R)) expect(() => headVersion(R[who]), who).not.toThrow();
  });
});

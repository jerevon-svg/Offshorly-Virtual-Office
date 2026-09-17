// Phase 2 — the two structural promises that no runtime test can make, asserted against the source.
//
// Both are about what must NOT exist. A behavioural test can show that a mapped employee gets their own
// character; it cannot show that there is no fallback path waiting to hand an unmapped one Bon's body,
// nor that the standalone page was left alone. Those are properties of the text.
// @ts-expect-error node:fs is untyped under tsconfig.app.json (types: ["vite/client"] only) and
// pulling in @types/node here would change global setTimeout typing for the whole app — the same
// exemption graphics-flash.test.ts takes. vitest runs in Node with cwd = frontend/, so the reads
// below are plain relative paths.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const world = readFileSync("src/dev/vo3d/app/world.ts", "utf8");
const bootstrap = readFileSync("src/dev/vo3d/app/bootstrap.ts", "utf8");
const identity = readFileSync("src/dev/vo3d/app/identity.ts", "utf8");

describe("createVo3dWorld's identity parameter", () => {
  it("is optional, so every existing caller keeps compiling", () => {
    expect(world).toContain("createVo3dWorld(canvas: HTMLCanvasElement, identity?: Vo3dIdentity)");
  });

  it("selects the employee's own LOD set through the production registry", () => {
    expect(world).toContain("castLods(identity.avatarId)");
  });

  it("resolves to null — not to Bon — when the employee has no registered character", () => {
    // The ternary is the whole rule: identity present but avatarId falsy => null => nothing loaded.
    expect(world).toContain("identity.avatarId ? castLods(identity.avatarId) : null");
    expect(world).toContain("const avatarMissing = avatarLods === null");
  });

  it("never names a fallback character id anywhere in the selection", () => {
    // Guards the one-line "fix" a future reader is most likely to reach for.
    expect(world).not.toMatch(/castLods\(\s*["']bon["']\s*\)/);
    expect(world).not.toMatch(/avatarId\s*\?\?\s*["']bon["']/);
  });

  it("skips the load entirely rather than requesting an asset that does not exist", () => {
    const start = world.indexOf("function loadAvatar(): void {");
    expect(start).toBeGreaterThan(-1);
    const body = world.slice(start, world.indexOf("\n  }\n", start));
    expect(body).toContain("if (avatarMissing)");
    // The guard has to come before the load, or it guards nothing.
    expect(body.indexOf("if (avatarMissing)")).toBeLessThan(body.indexOf("avatar.load("));
  });
});

describe("standalone V2 compatibility", () => {
  it("the standalone entry still calls createVo3dWorld with the canvas alone", () => {
    expect(bootstrap).toContain("createVo3dWorld(document.getElementById(\"stage\") as HTMLCanvasElement)");
  });

  it("the standalone entry knows nothing about identity", () => {
    expect(bootstrap).not.toContain("identity");
    expect(bootstrap).not.toContain("Vo3dIdentity");
  });

  it("the world imports the identity TYPE only, so no auth module can reach the standalone bundle", () => {
    // A value import here would pull adapters/v1Identity -> auth/* into dev/vo3d.html. Type-only is
    // erased, which is why the contract lives in its own import-free module.
    expect(world).toContain('import type { Vo3dIdentity } from "./identity"');
    expect(world).not.toMatch(/from\s+["']\.\.\/adapters\/v1Identity["']/);
    expect(world).not.toMatch(/from\s+["'][^"']*\/auth\//);
  });

  it("the identity contract module imports nothing at all", () => {
    expect(identity).not.toMatch(/^\s*import\s/m);
  });
});

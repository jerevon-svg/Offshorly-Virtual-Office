// REGRESSION — the white flash on a Smooth rung transition.
//
// WHAT HAPPENED. A rung change that moves render scale calls Renderer.resize(), and resizing the canvas
// REALLOCATES the WebGL drawing buffer, discarding its contents. The adaptation was being driven from
// the BOTTOM of the render loop, after R.render(), so the reallocation threw away the frame that same
// callback had just drawn. The browser then composited an empty canvas: one white frame, landing exactly
// on a rung transition (observed on the 1→2 recovery, where scale goes 0.75 → 0.85).
//
// WHY IT IS TESTED LIKE THIS. The defect is an ORDERING property of the render loop, not a value any
// module returns — there is no object to interrogate and no GL context in this suite to photograph. So
// it is asserted the way this codebase already asserts loop-ordering invariants (see executive.test.ts,
// which reads this same file to check every SeatInteraction is ticked): against the source itself.
//
// The fix is not "resize less". It is that adaptation happens BEFORE the draw, so the frame that gets
// presented is always one drawn into the buffer that is now current. Quality levels, thresholds,
// hysteresis and the ladder are untouched by it.
//
// @ts-expect-error node:fs is untyped under tsconfig.app.json (types: ["vite/client"] only) and
// pulling in @types/node here would change global setTimeout typing for the whole app — the same
// exemption components/OfficeMap/checkoutExitWalk.test.ts takes. vitest runs in Node with
// cwd = frontend/, so the reads below are plain relative paths.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync("src/dev/vo3d/app/bootstrap.ts", "utf8");
const rendererSource = readFileSync("src/dev/vo3d/render/Renderer.ts", "utf8");

/** The body of `function loop()`, up to the closing brace at column 0, with `//` comments removed.
 *
 *  The comments have to go: the block explaining this very ordering quotes `R.render()` by name, and a
 *  source-order assertion that can be satisfied by PROSE is not an assertion about the code. */
function loopBody(): string {
  const start = source.indexOf("function loop(): void {");
  expect(start).toBeGreaterThan(-1);
  const end = source.indexOf("\n}\n", start);
  expect(end).toBeGreaterThan(start);
  return source
    .slice(start, end)
    .split("\n")
    .map((line: string) => line.replace(/\/\/.*$/, ""))
    .join("\n");
}

describe("the render loop orders adaptation before drawing", () => {
  it("drives the graphics controller exactly once per frame", () => {
    const body = loopBody();
    expect(body.match(/graphics\.frame\(/g)).toHaveLength(1);
  });

  it("samples and adapts BEFORE R.render(), so a resize cannot discard the drawn frame", () => {
    const body = loopBody();
    const adapt = body.indexOf("graphics.frame(");
    const render = body.indexOf("R.render()");
    expect(adapt).toBeGreaterThan(-1);
    expect(render).toBeGreaterThan(-1);
    // THE ASSERTION. Reverse these two and the white flash comes back.
    expect(adapt).toBeLessThan(render);
  });

  it("still renders once per frame", () => {
    expect(loopBody().match(/\bR\.render\(\)/g)).toHaveLength(1);
  });
});

describe("what makes the ordering matter", () => {
  it("a render-scale change really does re-enter resize()", () => {
    // If setRenderScale ever stops resizing, this test is measuring nothing and should be revisited
    // rather than deleted — the ordering would still be right, but for a reason that no longer holds.
    const setter = rendererSource.slice(rendererSource.indexOf("setRenderScale(scale: number)"));
    const body = setter.slice(0, setter.indexOf("\n  }"));
    expect(body).toContain("this.resize()");
  });

  it("resize() is what reallocates the drawing buffer", () => {
    const resize = rendererSource.slice(rendererSource.indexOf("  resize(): void {"));
    const body = resize.slice(0, resize.indexOf("\n  }"));
    expect(body).toContain("setPixelRatio");
    expect(body).toContain("setSize");
  });
});

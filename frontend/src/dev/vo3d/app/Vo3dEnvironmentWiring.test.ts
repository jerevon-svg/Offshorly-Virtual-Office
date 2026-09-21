// SETTINGS -> ENVIRONMENT, the wiring. app/world.ts is a WebGL module that cannot be constructed in
// jsdom, so the invariants that live in it are asserted against its source. Each one below is a rule
// somebody could break with a one-line edit and not notice until a demo:
//
//   • the world READS the shared preference and never writes it — which is what stops the inspection
//     rig's two dropdowns from silently overwriting what an employee saved;
//   • it unsubscribes, because the store outlives any one world;
//   • the rig still works, unchanged;
//   • the Company Hub's real forecast is not in this path at all.
// @ts-expect-error node:fs is untyped under tsconfig.app.json (types: ["vite/client"] only) and
// pulling in @types/node here would change global setTimeout typing for the whole app — the same
// exemption components/OfficeMap/HudDock.layering.test.ts takes. vitest runs in Node with
// cwd = frontend/, so the reads below are plain relative paths.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const DIR = "src/dev/vo3d/app";
const read = (file: string): string => readFileSync(`${DIR}/${file}`, "utf8");
const world = read("world.ts");
const hud = read("Vo3dHud.tsx");

describe("the world's side of the environment preference", () => {
  it("reads and subscribes to the shared store", () => {
    expect(world).toContain("getEnvironmentPreferences");
    expect(world).toContain("subscribeEnvironmentPreferences");
    expect(world).toContain('from "../../../services/settings/environmentPreferences"');
  });

  it("NEVER writes it — the developer rig cannot overwrite an employee's saved preference", () => {
    expect(world).not.toContain("setEnvironmentPreference");
  });

  it("applies the saved preference to both axes before the first grade", () => {
    const applier = world.slice(world.indexOf("const applyEnvironmentPreference"));
    expect(applier).toMatch(/timeOfDay\.mode = time/);
    expect(applier).toMatch(/weather\.mode = wx/);
    // …and the very next thing is the re-grade, so the world is never painted on the wrong preference.
    expect(world).toContain("applyEnvironmentPreference();\n  applyEnvPhase(true);");
  });

  it("re-grades and repaints the rig when the preference changes, and unsubscribes on dispose", () => {
    const sub = world.slice(world.indexOf("const unsubscribeEnvironment"));
    expect(sub.slice(0, 400)).toContain("applyEnvironmentPreference()");
    expect(sub.slice(0, 400)).toContain("applyEnvPhase(true)");
    expect(sub.slice(0, 400)).toContain("refreshGuiIfBuilt()");
    expect(world).toContain("unsubscribeEnvironment();");
  });

  it("leaves the developer inspection rig's own two rows working", () => {
    expect(world).toContain('envGui.add(params, "envTime", ENV_TIME_MODES)');
    expect(world).toContain('wxGui.add(params, "envWeather", WEATHER_MODES)');
    expect(world).toContain("function setWeatherMode(m: WeatherMode)");
  });

  it("has no temporary presentation switcher left to compete with it", () => {
    expect(world).not.toContain("presentationEnv");
    expect(world).not.toContain("Vo3dPresentationEnv");
  });

  it("keeps the Company Hub's real forecast out of the virtual sky", () => {
    // services/weather/forecastClient is the WeatherAPI-backed Hub slide. The world's AUTO weather
    // comes from its own provider seam (env/providers), never from that client.
    expect(world).not.toContain("services/weather/forecastClient");
    expect(world).not.toContain("forecastClient");
  });
});

describe("the HUD's side", () => {
  it("offers the category to every V2 employee, not only DEV builds", () => {
    expect(hud).toContain("environment={<Vo3dEnvironmentPanel />}");
    expect(hud).not.toMatch(/environment=\{import\.meta\.env\.DEV/);
  });

  it("hands the panel no world reference — it has nothing to mirror", () => {
    expect(hud).not.toContain("Vo3dEnvironmentPanel worldRef");
  });
});

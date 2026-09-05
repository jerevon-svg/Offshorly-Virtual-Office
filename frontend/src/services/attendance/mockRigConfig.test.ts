import { afterEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error node:fs is untyped under tsconfig.app.json (types: ["vite/client"] only) and pulling
// in @types/node or vite's own types here would change global setTimeout typing for the whole app.
// vitest runs in Node with cwd = frontend/, so the read itself is fine.
import { readFileSync } from "node:fs";

// Regression from Quest Foundation manual acceptance (2026-09-05): on the :5174 mock rig a real
// Check In click never reached POST /attendance/check-in, so first_check_in stayed at 0 while
// DM quests (chat mode = real) advanced. Root cause: VITE_ATTENDANCE_MODE was unset in
// .env.mock and the resolver silently defaults to "mock" (localStorage only). Two guards:
//   1. the resolver's default is documented and asserted, so a future reader knows "unset" means
//      "no backend call";
//   2. .env.mock must declare real attendance, like it already does for chat, so the rig
//      exercises the server-authoritative route the quest engine hooks.

async function loadAttendanceMode(): Promise<string> {
  vi.resetModules();
  const mod = await import("./index");
  return mod.attendanceMode;
}

describe("attendance mode resolution", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("is mock when VITE_ATTENDANCE_MODE is unset — Check In then never calls the backend", async () => {
    vi.stubEnv("VITE_ATTENDANCE_MODE", "");
    expect(await loadAttendanceMode()).toBe("mock");
  });

  it("is real only when VITE_ATTENDANCE_MODE=real", async () => {
    vi.stubEnv("VITE_ATTENDANCE_MODE", "real");
    expect(await loadAttendanceMode()).toBe("real");
  });
});

describe("mock rig (.env.mock) attendance wiring", () => {
  // Read the tracked mode file itself. Not Vite's loadEnv: vitest has already copied .env.local
  // into process.env, which loadEnv treats as highest priority, so it would report the :5173
  // values and not what `vite --mode mock` actually layers on top for :5174.
  const envMock: string = readFileSync(".env.mock", "utf8");
  const declared: Record<string, string> = Object.fromEntries(
    envMock
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"))
      .map((line) => {
        const eq = line.indexOf("=");
        return [line.slice(0, eq), line.slice(eq + 1)];
      }),
  );

  it("points attendance at the real backend so Check In reaches POST /attendance/check-in", () => {
    expect(declared.VITE_ATTENDANCE_MODE).toBe("real");
  });

  it("gives real attendance the same backend base the chat/hub/feed clients use", () => {
    // RealAttendanceService throws at request time without this; the rig must declare it.
    expect(declared.VITE_CHAT_SOCKET_URL).toMatch(/^http:\/\/localhost:8002\/?$/);
    expect(declared.VITE_CHAT_MODE).toBe("real");
  });
});

// PARKOUR V3 — THE SERVER'S COPIES, kept honest: the route table the backend validates relays against
// (backend/app/realtime/traversal_routes.json) is exactly what the world's declared routes say, and the office
// boundary the backend refuses walks across (backend/app/realtime/office_zone.py) uses the client's own numbers.
import { describe, expect, it } from "vitest";
import { LAB_ROUTES } from "./world/ailabV2";
import { routeTable } from "./world/traversalRoutes";
import { FACADE_Z, FRAME, v1Rooms } from "./adapters/v1Floor";
import { GATE, RECEPTION_ROOM_ID } from "./rooms/reception";

// (read from disk at run time: the backend is outside the frontend's own source root, which Vite will not import from)
const read = async (name: string): Promise<string> => {
  const fs = (await import(/* @vite-ignore */ "node:fs" as string)) as { readFileSync(p: string, enc: string): string };
  const here = import.meta.url;
  return fs.readFileSync(decodeURIComponent(new URL("../../../../backend/app/realtime/" + name, here).pathname), "utf8");
};

describe("the backend's copies", () => {
  it("traversal_routes.json is the declared routes, exactly", async () => {
    expect(JSON.parse(await read("traversal_routes.json"))).toEqual(routeTable(LAB_ROUTES));
  });

  it("office_zone.py's boundary is the client's own: the frame, the façade, Reception's rect and its gate line", async () => {
    const py = await read("office_zone.py");
    const num = (name: string) => Number(new RegExp(`^${name} = ([0-9.]+)`, "m").exec(py)![1]);
    expect(num("FRAME_W")).toBe(FRAME.w);
    expect(num("FRAME_H")).toBe(FRAME.d);
    expect(num("FACADE_Z")).toBe(FACADE_Z);
    expect(num("GATE_Z")).toBe(GATE.z);
    const r = v1Rooms().find((x) => x.id === RECEPTION_ROOM_ID)!.rect;
    const rec = /RECEPTION = \{"x": ([0-9.]+), "z": ([0-9.]+), "w": ([0-9.]+), "d": ([0-9.]+)\}/.exec(py)!;
    expect([Number(rec[1]), Number(rec[2]), Number(rec[3]), Number(rec[4])]).toEqual([r.x, r.z, r.w, r.d]);
  });
});

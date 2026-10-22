// vo3d app — THE WORLD'S LINE TO THE SERVER'S SCOOTER REGISTRY (S1).
//
// The host mounts this once the world is ready: it gives the world a way to ASK for a scooter
// (services/scooters/scooterStore claimScooter — nothing rides before the server says yes) and keeps the
// world told what the server says about all six, with `full` set on every connect/reconnect snapshot so the
// world can re-own a ride that survived a dropped socket and hand back one a refresh left behind.
import { useEffect, useRef } from "react";
import { claimScooter, onScooterAccidents, onScooterPose, onTrafficHolds, releaseScooter, liftScooterAccident, reportScooterAccident, sendScooterAccidentReach, sendScooterPose, sendTrafficObstacle, useScooterRegistry, type ScooterAccidentWire, type TrafficVehicleWire } from "../../../services/scooters/scooterStore";
import type { ObstacleReport } from "../world/trafficObstacles";
import type { RelayedScooterPose, Vo3dScooterAuthority, Vo3dScooterState } from "../world/scooters";

interface ScooterWorld {
  setScooterAuthority?(authority: Vo3dScooterAuthority | null): void;
  applyScooterStates?(list: readonly Vo3dScooterState[], full: boolean): void;
  pushScooterPose?(p: RelayedScooterPose): void;
  applyTrafficHolds?(list: readonly TrafficVehicleWire[]): void;
  setTrafficReporter?(report: ((r: ObstacleReport) => void) | null): void;
  applyScooterAccidents?(list: readonly ScooterAccidentWire[]): void;
}

const AUTHORITY: Vo3dScooterAuthority = { claim: claimScooter, release: releaseScooter, sendPose: sendScooterPose, reportAccident: reportScooterAccident, reportAccidentReach: sendScooterAccidentReach, liftAccident: liftScooterAccident };

export function useScooterAuthority(worldRef: { current: ScooterWorld | null }, ready: boolean, selfEmail: string | null): void {
  const registry = useScooterRegistry();
  // ONLY A SERVER THAT SPEAKS SCOOTERS IS ASKED: the authority is installed once its first snapshot has
  // arrived. A backend without the registry (not yet reloaded, an older deploy) never sends one, and the
  // ride stays the single-player ride it was — rather than every mount timing out.
  const serverHasRegistry = registry.fullCount > 0;
  useEffect(() => {
    if (!ready || !serverHasRegistry) return;
    const world = worldRef.current;
    world?.setScooterAuthority?.(AUTHORITY);
    return () => world?.setScooterAuthority?.(null);
  }, [ready, serverHasRegistry, worldRef]);
  // S4 — THE TRAFFIC HOLDS, straight to the world; and the world's way to say its employee is in a car's way,
  // installed only once the server has shown it holds traffic at all (an older backend never hears a report)
  useEffect(() => {
    if (!ready) return;
    const world = worldRef.current;
    let reporting = false;
    const off = onTrafficHolds((list) => {
      world?.applyTrafficHolds?.(list);
      if (!reporting) { reporting = true; world?.setTrafficReporter?.((r) => sendTrafficObstacle(r)); }
    });
    return () => { off(); world?.setTrafficReporter?.(null); };
  }, [ready, worldRef]);
  // S5 — every accident in progress (the fallen scooters themselves come with the scooter states)
  useEffect(() => {
    if (!ready) return;
    return onScooterAccidents((list) => worldRef.current?.applyScooterAccidents?.(list));
  }, [ready, worldRef]);
  // S2 — EVERY OTHER RIDER'S POSE, straight to the world (ten a second each: never through React state)
  useEffect(() => {
    if (!ready) return;
    return onScooterPose((p) => worldRef.current?.pushScooterPose?.(p));
  }, [ready, worldRef]);
  const lastFull = useRef(-1);
  useEffect(() => {
    if (!ready) return;
    const full = registry.fullCount !== lastFull.current;
    if (!full && registry.scooters.length === 0) return;
    lastFull.current = registry.fullCount;
    const me = selfEmail?.trim().toLowerCase() ?? null;
    worldRef.current?.applyScooterStates?.(
      registry.scooters.map((s) => ({ id: s.id, state: s.state, mine: me !== null && s.rider === me, at: s.at, accident: s.accident ?? null })),
      full && registry.fullCount > 0,
    );
    // S2 — JOINING MID-RIDE: each other rider's last pose (stored with its own clock and number) seeds their
    // stream, so they are drawn where they are at once rather than after the next sample
    if (full) {
      for (const s of registry.scooters) {
        const p = s.pose as (RelayedScooterPose & { t?: number; seq?: number }) | null | undefined;
        if (s.state !== "ridden" || !s.rider || s.rider === me || !p || typeof p.t !== "number" || typeof p.seq !== "number") continue;
        worldRef.current?.pushScooterPose?.({ ...p, scooterId: s.id, rider: s.rider, t: p.t, seq: p.seq });
      }
    }
  }, [ready, registry, selfEmail, worldRef]);
}

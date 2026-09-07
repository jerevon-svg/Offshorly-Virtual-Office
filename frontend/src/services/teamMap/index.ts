import { mockTeamMapService } from "./MockTeamMapService";
import { realTeamMapService } from "./RealTeamMapService";
import type { TeamMapService } from "./types";

export * from "./types";
export { MockTeamMapService, mockTeamMapService, buildMockTeamMapPeople } from "./MockTeamMapService";
export { RealTeamMapService, realTeamMapService, setDevIdentity } from "./RealTeamMapService";

// Rides the SAME switch as services/office/index.ts: when the office roster is Atlas-backed the
// map is too (via the VO backend proxy); when the roster is the offline manifest cast, so is the
// map. One flag, one cast — the :5174 rig never reaches Atlas or the VO backend for map data.
function resolveMode(): "mock" | "real" {
  return import.meta.env.VITE_OFFICE_INTEGRATION_MODE === "real" ? "real" : "mock";
}

export const teamMapMode = resolveMode();

export const teamMapService: TeamMapService =
  teamMapMode === "real" ? realTeamMapService : mockTeamMapService;

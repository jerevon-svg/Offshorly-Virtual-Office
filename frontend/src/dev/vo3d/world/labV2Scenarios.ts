// vo3d world — AI LAB V2 TRAVERSAL PROOF SCENARIOS (blockout verification; NOT the orchestration job).
//
// Pure data for avatar/MonkeyCastRunner on the V2 graph (world/ailabV2 buildLabV2Graph). Every movement is a
// DESTINATION request — the runner and the planner decide the route — so these read exactly like the requests
// the orchestration presenter will make later. The proof runs the whole physical workflow once: wake and come
// down three different ways, gather at the briefing ring, disperse to the three stations, two handoffs on
// foot, dock the result, and go home again (trunk climb, ladder, jumps, branch).
import type { CastCmd, CastScenario } from "../avatar/MonkeyCastRunner";
import { ARTIFACT, TOUCAN_PERCH } from "./ailabV2";
import { STATIONS, toWorld } from "./labStations";

const go = (t: number, a: string, to: string): CastCmd => ({ t, a, op: "go", to });
const look = (t: number, a: string, target: string | readonly [number, number, number] | null, afterArrival = false): CastCmd => ({ t, a, op: "attend", target, afterArrival });
const say = (a: string, dur: number): CastCmd => ({ t: 0, a, op: "say", dur, afterArrival: true });
const perch = [TOUCAN_PERCH.x, TOUCAN_PERCH.y + 4, TOUCAN_PERCH.z] as const;
/** where a packet is set down on Milo's desk: its right-hand side, by the keyboard */
const miloDesk = toWorld(STATIONS.find((s) => s.id === "BUILD_01")!, 36, -20);
const MILO_DESK_TOP = [miloDesk.x, 18.4, miloDesk.z] as const;
const DOCK_TOP = [ARTIFACT.dock.x, ARTIFACT.counter.h + 0.4, ARTIFACT.dock.z] as const;

const HOME = { milo: { node: "u2-milo-home" }, nova: { node: "u1-nova-home" }, pip: { node: "b-tip" } };

export const LAB_V2_SCENARIOS: Readonly<Record<string, CastScenario>> = {
  proof: {
    id: "proof", note: "home → descend (pole / ramp / limb+hang+drop) → briefing → stations → handoffs → dock → home (climb / ladder / jumps / branch)", length: 135,
    start: HOME,
    cmds: [
      // WAKE AND COME DOWN — three different ways
      go(2, "pip", "PIP_HANG"), // the limb, then the hang twig
      go(2.5, "milo", "BRIEFING_MILO"), // L2 balcony → fire pole → across the plaza
      go(3, "nova", "BRIEFING_NOVA"), // L1 → the north-west ramp → round the plaza
      go(6, "pip", "BRIEFING_PIP"), // let go, drop, run in
      look(15, "nova", perch), look(15, "milo", perch), look(15, "pip", perch),
      // DISPERSE TO THE STATIONS
      look(19, "nova", null), look(19, "milo", null), look(19, "pip", null),
      go(19, "nova", "NOVA_DESIGN_STATION"), go(19, "milo", "MILO_BUILD_STATION"), go(19, "pip", "PIP_QA_STATION"),
      // HANDOFF 1: Nova carries her direction to Milo, on foot
      { t: 34, a: "nova", op: "carry", packet: "design" },
      go(34, "nova", "HANDOFF_NOVA_MILO"), go(35, "milo", "HANDOFF_NOVA_MILO_RECV"),
      look(0, "nova", "milo", true), look(0, "milo", "nova", true), say("nova", 1.6),
      { t: 0, op: "handoff", giver: "nova", receiver: "milo", packet: "design" },
      go(0, "milo", "MILO_BUILD_STATION"), { t: 0, a: "milo", op: "place", packet: "design", at: MILO_DESK_TOP },
      look(0, "milo", null, true),
      // Nova goes home the climbing way: the trunk, through the hatch
      look(0, "nova", null, true), go(0, "nova", "TRUNK_FOOT"), go(0, "nova", "CLIMB_TOP"), go(0, "nova", "NOVA_HOME"),
      // HANDOFF 2: Milo's build to Pip
      { t: 0, a: "milo", op: "wait", dur: 8 }, // building
      { t: 0, a: "milo", op: "carry", packet: "build" },
      go(0, "milo", "HANDOFF_MILO_PIP"), go(68, "pip", "HANDOFF_MILO_PIP_RECV"),
      look(0, "milo", "pip", true), look(0, "pip", "milo", true), say("milo", 1.4),
      { t: 0, op: "handoff", giver: "milo", receiver: "pip", packet: "build" },
      look(0, "milo", null, true), look(0, "pip", null, true),
      // Pip reviews it, then docks it at the artifact wall
      go(0, "pip", "PIP_QA_STATION"), { t: 0, a: "pip", op: "wait", dur: 6 }, go(0, "pip", "ARTIFACT_DOCK"), { t: 0, a: "pip", op: "place", packet: "build", at: DOCK_TOP },
      // HOME AGAIN: Milo up the trunk and the ladder; Pip by the climb, the jumps and the branch
      go(0, "milo", "MILO_HOME"),
      go(0, "pip", "JUMP_EDGE"), go(0, "pip", "JUMP_LAND"), go(0, "pip", "PIP_HOME"),
    ],
  },
  homes: { id: "homes", note: "everyone at home (scale + sightline check)", length: 8, start: HOME, cmds: [] },
  briefing: {
    id: "briefing", note: "everyone at the briefing ring, facing the Toucan's perch", length: 8,
    start: { nova: { node: "g-brief-nova" }, milo: { node: "g-brief-milo" }, pip: { node: "g-brief-pip" } },
    cmds: [look(0, "nova", perch), look(0, "milo", perch), look(0, "pip", perch)],
  },
  stations: {
    id: "stations", note: "everyone at work", length: 10,
    start: { nova: { node: "st-design_01" }, milo: { node: "st-build_01" }, pip: { node: "st-qa_01" } }, cmds: [],
  },
  handoffs: {
    id: "handoffs", note: "both handoff pairs", length: 8,
    start: { nova: { node: "g-nm-give" }, milo: { node: "g-nm-take" }, pip: { node: "g-mp-take" } },
    cmds: [{ t: 0, a: "nova", op: "carry", packet: "design" }, look(0, "nova", "milo"), look(0, "milo", "nova")],
  },
  climb: { id: "climb", note: "trunk climb through the hatch, side mantle, and back down", length: 26, start: { nova: { node: "g-climb-foot" } }, cmds: [go(0.5, "nova", "CLIMB_TOP"), go(3, "nova", "TRUNK_FOOT")] },
  pole: { id: "pole", note: "Milo: pod → balcony → fire pole", length: 10, start: { milo: { node: "u2-milo-home" } }, cmds: [go(0.5, "milo", "POLE_FOOT")] },
  stair: { id: "stair", note: "L1 → L2 ship stair and back", length: 16, start: { milo: { node: "u1-stair-foot" } }, cmds: [go(0.5, "milo", "STAIR_TOP"), go(2, "milo", "STAIR_FOOT")] },
  residence: {
    id: "residence", note: "agents come out of the residence (entry door, balcony door) and go back in", length: 30,
    start: { nova: { node: "res-inside" }, milo: { node: "res-inside" }, pip: { node: "u2-hub" } },
    cmds: [go(1, "nova", "RESIDENCE_BALCONY"), go(0, "nova", "IDLE_BAL_W"), go(2, "milo", "RESIDENCE_DOOR"), go(0, "milo", "IDLE_L2_RAIL_S"), go(3, "pip", "RESIDENCE_INSIDE"), go(14, "pip", "BUILD_02"), go(18, "milo", "RESIDENCE_INSIDE")],
  },
  population: {
    id: "population", note: "a fuller home: everyone resting on the residence exterior", length: 10,
    start: { nova: { node: "idle-bal-w" }, milo: { node: "idle-l2-rail-s" }, pip: { node: "idle-l2-deck" } }, cmds: [],
  },
  limb: { id: "limb", note: "Pip: limb tip → hang → climb back → SW branch down", length: 22, start: { pip: { node: "b-tip" } }, cmds: [go(0.5, "pip", "PIP_HANG"), go(4, "pip", "HANG_LEDGE"), go(0.5, "pip", "SW_BRANCH_FOOT")] },
  jump: { id: "jump", note: "L1 edge → jump pad → floor", length: 8, start: { pip: { node: "u1-jump" } }, cmds: [go(0.5, "pip", "JUMP_PAD"), go(2.6, "pip", "JUMP_LAND")] },
  ramp: { id: "ramp", note: "Nova: home → ramp down → studio", length: 16, start: { nova: { node: "u1-nova-home" } }, cmds: [go(0.5, "nova", "NOVA_DESIGN_STATION")] },
  run: { id: "run", note: "a long floor run across the Lab (knuckle)", length: 16, start: { pip: { node: "st-design_01-app" } }, cmds: [go(0.5, "pip", "MILO_BUILD_STATION")] },
};

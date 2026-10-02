// vo3d world — MONKEYAGENT MOTION PERSONAS: one locomotion vocabulary, three temperaments.
//
// Every MonkeyAgent moves with the SAME system (world/monkeyTraversal + avatar/monkeyMotion). What differs is a
// small, fixed set of numbers per identity — speed, how soon it drops to all fours, how briskly it does its
// transitions, how it carries itself, where it likes to rest. Deterministic data, never randomness, so Milo is
// recognisably Milo every run and on every client. Kept deliberately subtle: they are intelligent companions,
// and readability beats comedy.
import { BASE_PROFILE, type MotionProfile, type NodeAction } from "./monkeyTraversal";

export type MonkeyPersona = {
  profile: MotionProfile;
  /** the rest pose it picks when it has nothing to do */
  rest: NodeAction;
  /** one line for the dev panel */
  note: string;
};

export const MONKEY_PERSONAS: Readonly<Record<string, MonkeyPersona>> = {
  // MILO — the builder. Steady and unhurried, deeper set, walks more than he runs; sleeps when idle.
  milo: {
    profile: { ...BASE_PROFILE, id: "milo", speed: { walk: 24, scamper: 52, knuckle: 70 }, climb: 13.5, ladder: 16, accel: 130, walkMax: 90, knuckleFrom: 170, tempo: 1.12, lean: 0.16, crouch: 0.7, stridePhase: 0.37, routeBias: { pole: 0.7, branch: 2.6, hang: 2, drop: 2 } },
    rest: "sleep",
    note: "steady, deliberate; prefers walking; sleeps",
  },
  // NOVA — the designer. Light and upright, smooth transitions; sits and watches when idle.
  nova: {
    profile: { ...BASE_PROFILE, id: "nova", speed: { walk: 27, scamper: 58, knuckle: 73 }, climb: 15.5, ladder: 18, accel: 150, walkMax: 75, knuckleFrom: 155, tempo: 0.96, lean: 0.07, crouch: 0.4, stridePhase: 0.71, routeBias: { branch: 10, climb: 1.6, jump: 2, hang: 3, drop: 3, pole: 1.6 } },
    rest: "sit",
    note: "upright, graceful; sits and watches",
  },
  // PIP — the reviewer. Quick and alert, drops to all fours early, brisk transitions; hangs or perches.
  pip: {
    profile: { ...BASE_PROFILE, id: "pip", speed: { walk: 29, scamper: 64, knuckle: 82 }, climb: 17, ladder: 20, accel: 185, walkMax: 55, knuckleFrom: 115, tempo: 0.86, lean: 0.12, crouch: 0.55, stridePhase: 0.13, routeBias: { branch: 0.8, jump: 0.8, hang: 0.9, drop: 0.9 } },
    rest: "perch",
    note: "quick, alert; knuckle-runs early; perches and hangs",
  },
};

export const personaFor = (id: string): MonkeyPersona => MONKEY_PERSONAS[id] ?? { profile: { ...BASE_PROFILE, id }, rest: "stand", note: "base" };

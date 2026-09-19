// Phase 6D — TARGETING A PERSON IN PLAYER MODE. A coworker is scored by the SAME cone and reach a chair
// is, which is the whole claim: no second targeting rule was written for people.
import { describe, expect, it } from "vitest";
import {
  coworkerEmailOf,
  personCandidateId,
  pickTarget,
  REACH,
  type Candidate,
} from "./PlayerTargeting";

const EMAIL = "alex@offshorly.com";
const at = (x: number, z: number): Candidate => ({ id: personCandidateId(EMAIL), kind: "person", pos: { x, z }, label: "Alex", roomId: "" });
const chair = (x: number, z: number, id = "dev-room/bay-chair-n1"): Candidate => ({ id, kind: "seat", pos: { x, z }, label: "Sit", roomId: "dev-room" });
/** looking along -Z, V2's own "north" heading */
const NORTH = { x: 0, z: -1 };

describe("the person id namespace", () => {
  it("round-trips an email, and claims nothing else", () => {
    expect(coworkerEmailOf(personCandidateId(EMAIL))).toBe(EMAIL);
    expect(coworkerEmailOf("dev-room/bay-chair-n1")).toBeNull();
    expect(coworkerEmailOf("reception/counter")).toBeNull();
  });
});

describe("scoring a coworker", () => {
  it("targets somebody you are looking straight at, within reach", () => {
    const t = pickTarget([at(0, -40)], { x: 0, z: 0 }, NORTH);
    expect(t?.id).toBe(personCandidateId(EMAIL));
    expect(t?.kind).toBe("person");
    expect(t?.distance).toBeCloseTo(40, 5);
  });

  it("does not target somebody past the same reach a chair is bounded by", () => {
    expect(pickTarget([at(0, -(REACH + 5))], { x: 0, z: 0 }, NORTH)).toBeNull();
  });

  it("does not target somebody standing behind you", () => {
    expect(pickTarget([at(0, 40)], { x: 0, z: 0 }, NORTH)).toBeNull();
  });

  it("loses to a chair that is more directly faced, and wins when it is the one faced", () => {
    // the chair is dead ahead, the person well off to the side
    const facingChair = pickTarget([at(45, -12), chair(0, -30)], { x: 0, z: 0 }, NORTH);
    expect(facingChair?.kind).toBe("seat");
    // turn to the person: now they are dead ahead and the chair is the one off-axis
    const facingPerson = pickTarget([at(0, -30), chair(45, -12)], { x: 0, z: 0 }, NORTH);
    expect(facingPerson?.kind).toBe("person");
  });

  it("targets whoever you are standing on top of, aiming or not — the same close-range rule a chair gets", () => {
    const t = pickTarget([at(0, 6)], { x: 0, z: 0 }, NORTH);
    expect(t?.kind).toBe("person");
  });
});

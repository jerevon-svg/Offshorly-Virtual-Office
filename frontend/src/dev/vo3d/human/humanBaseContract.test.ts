import { describe, expect, it } from "vitest";
import {
  NEUTRAL_IDENTITY, PARAM_RANGES, SHAPE_CONTROLS, clampIdentity,
  BODY_REGIONS, HUMAN_CORE_JOINTS, HUMAN_HAND_JOINTS, HUMAN_SKELETON_JOINTS, HUMAN_SKELETON_PARENTS, MANDATORY_SLOTS,
  changedSlots, mirrorJoint, regionMask, validateAvatar, type EmployeeAvatar,
} from "./humanBaseContract";
import { BON_AVATAR, BON_IDENTITY_V2, BON_PHASE2_AVATAR, CATALOGUE_BY_ID, PROOF_CATALOGUE } from "./humanCatalogue";
import { EXAMPLE_INTERACTABLES, WORKSTATION, validateInteractable, type Interactable } from "./humanInteraction";

describe("HumanBase_V1 skeleton contract", () => {
  it("keeps the 24 Meshy joints first and in order, so every shared clip still binds", () => {
    expect(HUMAN_SKELETON_JOINTS.slice(0, 24)).toEqual([...HUMAN_CORE_JOINTS]);
    expect(HUMAN_SKELETON_JOINTS).toHaveLength(36);
    expect(HUMAN_HAND_JOINTS.every((j) => HUMAN_SKELETON_JOINTS.indexOf(j) >= 24)).toBe(true);
  });
  it("lists every parent before its child, and every hand joint hangs off its own hand", () => {
    HUMAN_SKELETON_JOINTS.forEach((j, i) => {
      const p = HUMAN_SKELETON_PARENTS[j];
      if (p) expect(HUMAN_SKELETON_JOINTS.indexOf(p)).toBeLessThan(i);
    });
    for (const j of HUMAN_HAND_JOINTS) {
      let p = HUMAN_SKELETON_PARENTS[j];
      while (p && !p.endsWith("Hand")) p = HUMAN_SKELETON_PARENTS[p];
      expect(p).toBe(j.startsWith("Left") ? "LeftHand" : "RightHand");
    }
  });
  it("mirrors left ↔ right and leaves the centre alone", () => {
    expect(mirrorJoint("LeftIndex2")).toBe("RightIndex2");
    expect(mirrorJoint("RightForeArm")).toBe("LeftForeArm");
    expect(mirrorJoint("Spine01")).toBe("Spine01");
    for (const j of HUMAN_SKELETON_JOINTS) expect(HUMAN_SKELETON_JOINTS).toContain(mirrorJoint(j));
  });
  it("packs body regions into a 32-bit hide mask", () => {
    expect(Object.values(BODY_REGIONS).every((v) => v < 32)).toBe(true);
    expect(regionMask(["NECK", "FOOT_R"])).toBe((1 << 0) | (1 << 15));
  });
});

describe("editable avatar configuration", () => {
  it("Bon's configuration is valid against the proof catalogue", () => {
    expect(validateAvatar(BON_AVATAR, CATALOGUE_BY_ID)).toEqual([]);
  });
  it("the canonical head is shared by everyone; a personal (Phase 2) head belongs to one employee only", () => {
    expect(validateAvatar({ ...BON_AVATAR, employeeId: "alex" }, CATALOGUE_BY_ID)).toEqual([]);
    const stolen: EmployeeAvatar = { ...BON_PHASE2_AVATAR, employeeId: "alex" };
    expect(validateAvatar(stolen, CATALOGUE_BY_ID).map((p) => p.problem)).toContain("bon-head belongs to another employee");
  });
  it("rejects a wrong slot, an unknown asset and a missing mandatory slot", () => {
    const bad: EmployeeAvatar = { ...BON_AVATAR, top: { assetId: "clogs" }, bottom: { assetId: "nope" }, shoes: { assetId: "" } };
    const problems = validateAvatar(bad, CATALOGUE_BY_ID);
    expect(problems.find((p) => p.slot === "top")?.problem).toMatch(/is a shoes/);
    expect(problems.find((p) => p.slot === "bottom")?.problem).toMatch(/unknown/);
    expect(problems.find((p) => p.slot === "shoes")?.problem).toBe("missing");
    expect(MANDATORY_SLOTS).toEqual(["top", "bottom", "shoes"]);
  });
  it("a change touches only the slots that changed (what the runtime re-equips)", () => {
    expect(changedSlots(BON_AVATAR, { ...BON_AVATAR, top: { assetId: "tee-offshorly" } })).toEqual(["top"]);
    expect(changedSlots(BON_AVATAR, { ...BON_AVATAR, glasses: { assetId: "glasses-classic" }, shoes: { assetId: "sneakers" } })).toEqual(["shoes", "glasses"]);
    expect(changedSlots(BON_AVATAR, { ...BON_AVATAR, identity: { ...BON_AVATAR.identity, params: { ...BON_IDENTITY_V2, skin: "#000000" } } })).toEqual(["identity"]);
    expect(changedSlots(BON_AVATAR, { ...BON_AVATAR, version: 9 })).toEqual([]);
  });
  it("every catalogue id is unique and colourways are complete", () => {
    expect(new Set(PROOF_CATALOGUE.map((a) => a.id)).size).toBe(PROOF_CATALOGUE.length);
    for (const a of PROOF_CATALOGUE) for (const cw of Object.values(a.colorways ?? {})) expect(cw.main).toMatch(/^#[0-9a-f]{6}$/);
  });
});

describe("world interaction contract", () => {
  it("the workstation and every data-only example validate (desk, vending, coffee, dartboard, billiards)", () => {
    for (const it of [WORKSTATION, ...EXAMPLE_INTERACTABLES]) expect(validateInteractable(it)).toEqual([]);
    expect(EXAMPLE_INTERACTABLES.map((i) => i.kind)).toEqual(["vending-machine", "coffee-machine", "dartboard", "billiards-table"]);
  });
  it("catches dangling references", () => {
    const broken: Interactable = { id: "x", kind: "desk", targets: {}, slots: [{ id: "s", approach: { point: [0, 0], yaw: 0 }, posture: "seated", behavior: "b", hands: { L: { target: "nope", frame: "tip" } }, look: "gone", occupancy: 0, pairWith: "ghost" }] };
    expect(validateInteractable(broken)).toHaveLength(5);
  });
});

describe("identity parameters (the canonical head)", () => {
  it("every shape control and Bon's photo draft sit inside their contract ranges", () => {
    expect(clampIdentity(BON_IDENTITY_V2)).toEqual(BON_IDENTITY_V2);
    for (const k of SHAPE_CONTROLS) expect(Math.abs(BON_IDENTITY_V2.shape[k])).toBeLessThanOrEqual(1);
    expect(Object.keys(NEUTRAL_IDENTITY.shape).sort()).toEqual([...SHAPE_CONTROLS].sort());
  });
  it("clamping keeps any stored or edited value inside the family", () => {
    const wild = clampIdentity({ ...NEUTRAL_IDENTITY, shape: { ...NEUTRAL_IDENTITY.shape, faceWidth: 9 }, eyes: { ...NEUTRAL_IDENTITY.eyes, scale: 5, spacing: -3 } });
    expect(wild.shape.faceWidth).toBe(1);
    expect(wild.eyes.scale).toBe(PARAM_RANGES.eyes.scale[1]);
    expect(wild.eyes.spacing).toBe(PARAM_RANGES.eyes.spacing[0]);
  });
});

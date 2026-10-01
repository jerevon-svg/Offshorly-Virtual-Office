// vo3d build — THE MEETING FLOOR'S CHAIR: a slim pedestal conference chair, the family's own.
//
// Built at the ORIGIN, facing local −z (the furniture convention): the registry puts it on its entity's
// transform, which is what lets interact/Seat roll it back from the table and tuck it in again. Baked to
// one mesh per material — a floor of these costs a handful of draw calls, not one per screw.
import * as THREE from "three";
import { Baker, cyl, rbox } from "./helpers";
import { mat, metal, type MatKey } from "../render/Materials";

/** the seat pan's top face: interact/Seat lands the pelvis here */
export const MEETING_CHAIR_SEAT_TOP = 13.6;

export function meetingChair(style: "task" | "lead", fabricKey: MatKey): THREE.Group {
  const g = new THREE.Group();
  const b = new Baker();
  const frame = mat("mfFrame", 0.45), cloth = mat(fabricKey, 0.9);
  b.add(cyl(6.8, 0.8, frame, 0, 0.4, 0, 7.4)); //                        disc base
  b.add(cyl(0.9, 9.6, metal(), 0, 1.2, 0)); //                            column
  b.add(rbox(16, 1.2, 14.5, frame, 0, 10.6, 0, 0.5)); //                  seat shell
  b.add(rbox(16, 1.8, 15, cloth, 0, 11.8, -0.2, 0.8)); //                 seat pad → top at 13.6
  const backH = style === "lead" ? 20 : 14;
  const back = rbox(15.5, backH, 2.4, cloth, 0, 0, 0, 1.1);
  back.position.set(0, 14.4 + backH / 2, 7.2);
  back.rotation.x = 0.1;
  b.add(back);
  const shell = rbox(15.9, backH - 1, 1.2, frame, 0, 0, 0, 0.5);
  shell.position.set(0, 14.4 + backH / 2, 8.6);
  shell.rotation.x = 0.1;
  b.add(shell);
  for (const sx of [-1, 1]) b.add(rbox(1.1, 1.1, 10, frame, sx * 8.3, 17.4, 1.2, 0.4)); // arms
  b.bakeInto(g, "mf-chair");
  return g;
}

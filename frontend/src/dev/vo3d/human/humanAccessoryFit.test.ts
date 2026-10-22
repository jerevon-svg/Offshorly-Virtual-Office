import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { checkAccessory, envelopePoint, envelopeRadius, fitEnvelopePositions, placeAccessory, type AttachData } from "./humanAccessoryFit";

// a synthetic wearer: skin sphere r 0.42, hair envelope r 0.5 on the upper half (skin below), centre (0, 1.25, 0)
function wearer(hair = 0.5): AttachData {
  const nt = 24, np = 48, outer: number[] = [], skin: number[] = [];
  for (let t = 0; t < nt; t++) for (let p = 0; p < np; p++) { const th = ((t + 0.5) / nt) * Math.PI; skin.push(0.42); outer.push(th < Math.PI * 0.55 ? hair : 0.42); }
  const ear = (sg: number) => ({ root: [sg * 0.4, 1.2, 0] as [number, number, number], outer: [sg * 0.44, 1.2, 0] as [number, number, number], top: [sg * 0.43, 1.27, 0] as [number, number, number], lobe: [sg * 0.43, 1.12, 0.01] as [number, number, number], back: [sg * 0.41, 1.2, -0.05] as [number, number, number] });
  return { v: 1, centre: [0, 1.25, 0], ears: { l: ear(-1), r: ear(1) }, nose: { bridge: [0, 1.2, 0.44], tip: [0, 1.1, 0.5] }, crown: [0, 1.75, 0], forehead: [0, 1.4, 0.4], envelope: { nt, np, outer, skin } };
}
const blob = (o: THREE.Vector3, r: number) => { const g = new THREE.IcosahedronGeometry(r, 1); g.translate(o.x, o.y, o.z); return { P: g.getAttribute("position").array as Float32Array, I: null }; };

describe("accessory attachment contract", () => {
  it("samples the OUTER hair envelope, not the skull", () => {
    const a = wearer(); expect(envelopeRadius(a, new THREE.Vector3(0, 1, 0))).toBeCloseTo(0.5, 2); expect(envelopeRadius(a, new THREE.Vector3(0, 1, 0), "skin")).toBeCloseTo(0.42, 2);
  });
  it("seats a hair accessory ON the actual hairstyle (thick hair moves it out, it never sinks in)", () => {
    for (const hair of [0.46, 0.5, 0.58]) { const a = wearer(hair), M = placeAccessory(a, { region: "hair", dir: [0.3, 0.8, 0.5], standoff: 0, scale: 1 }), p = new THREE.Vector3().applyMatrix4(M);
      expect(p.distanceTo(new THREE.Vector3(0, 1.25, 0))).toBeCloseTo(hair, 2);
      const n = envelopePoint(a, new THREE.Vector3(0.3, 0.8, 0.5)).n, z = new THREE.Vector3().setFromMatrixColumn(M, 2).normalize(); expect(z.dot(n)).toBeGreaterThan(0.99); }
  });
  it("hangs an earring from the wearer's own ear lobe", () => {
    const a = wearer(), M = placeAccessory(a, { region: "ear", side: "l", site: "lobe", scale: 1 }), p = new THREE.Vector3().applyMatrix4(M); expect(p.toArray()).toEqual([-0.43, 1.12, 0.01]);
  });
  it("conforms a hat / band to the hair envelope (+ clearance)", () => {
    const a = wearer(0.55), out = fitEnvelopePositions([0, 1, 0, 0, 0.7, 0.7, 0, 0.01], a, 0.005);
    expect(out[1] - 1.25).toBeCloseTo(0.555, 3); expect(Math.hypot(out[3], out[4] - 1.25, out[5])).toBeCloseTo(0.565, 2);
  });
  it("flags floating, inside-skin and lost-in-hair accessories", () => {
    const a = wearer(), C = new THREE.Vector3(0, 1.25, 0);
    const onHair = blob(C.clone().add(new THREE.Vector3(0, 0.51, 0)), 0.02); expect(checkAccessory(onHair.P, null, a, "hair").ok).toBe(true);
    const floating = blob(C.clone().add(new THREE.Vector3(0, 0.62, 0)), 0.02); expect(checkAccessory(floating.P, null, a, "hair").floating).toBe(true);
    const inSkin = blob(C.clone().add(new THREE.Vector3(0, 0, 0.3)), 0.02); expect(checkAccessory(inSkin.P, null, a, "face").insideSkin).toBeGreaterThan(0);
    const lost = blob(C.clone().add(new THREE.Vector3(0, 0.46, 0)), 0.01); expect(checkAccessory(lost.P, null, a, "face").lostInHair).toBeGreaterThan(0);
  });
});

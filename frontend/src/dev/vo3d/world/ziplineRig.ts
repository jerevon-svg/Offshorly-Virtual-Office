// vo3d world — THE ZIPLINE TROLLEY (PARKOUR V3): the part of a zipline that MOVES — a wheeled trolley on the cable, a
// hanger, and the handle the rider holds — placed every frame from world/traversalRoutes `ziplineHold`, the same rule
// the rider's hands are posed to (avatar/parkourPose setGrip). So the trolley rides the real cable, slope and all, the
// handle hangs plumb beneath it, and the hands are on the handle because both are put at the same point.
import * as THREE from "three";
import type { RoutePoint } from "./traversalRoutes";

const STEEL = new THREE.MeshStandardMaterial({ color: 0x5d6670, roughness: 0.45, metalness: 0.7 });
const BRASS = new THREE.MeshStandardMaterial({ color: 0xc9a25a, roughness: 0.35, metalness: 0.8 });
const GRIP = new THREE.MeshStandardMaterial({ color: 0x2b2f35, roughness: 0.8 });

/** the bar runs this far above the rider's head (the avatar's height) */
const BAR_CLEAR = 3;
const AVATAR_H = 36;
export type GripProfile = { halfSpan: number; handY: number };

/** THE ASSEMBLY, top to bottom: the TROLLEY (pulley wheels in a carriage) sits on the cable, pitched to its slope; a
 *  short vertical CONNECTOR hangs from it to a horizontal HANDLEBAR just over the rider's head; a GRIP hangs from each
 *  end of the bar to where that rider's hands hold it (their own GripProfile — a chibi holds them beside its head). */
export class ZiplineTrolley {
  readonly group = new THREE.Group();
  private readonly carriage = new THREE.Group();
  private readonly connector: THREE.Mesh;
  private readonly bar: THREE.Mesh;
  private readonly grips: THREE.Mesh[];
  private readonly loops: THREE.Mesh[];

  constructor() {
    this.group.name = "zipline-trolley";
    const block = new THREE.Mesh(new THREE.BoxGeometry(3.2, 2.4, 7), BRASS);
    block.position.y = -1.6;
    for (const z of [-2.4, 2.4]) {
      const wheel = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.4, 1.3, 14).rotateZ(Math.PI / 2), STEEL);
      wheel.position.set(0, 0, z); // the pulleys sit ON the cable
      this.carriage.add(wheel);
    }
    this.carriage.add(block);
    this.group.add(this.carriage);
    const unitY = (r: number, m: THREE.Material) => new THREE.Mesh(new THREE.CylinderGeometry(r, r, 1, 8).translate(0, -0.5, 0), m);
    this.connector = unitY(0.4, STEEL);
    this.bar = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.7, 1, 10).rotateZ(Math.PI / 2), STEEL);
    this.grips = [unitY(0.32, STEEL), unitY(0.32, STEEL)];
    this.loops = [0, 1].map(() => new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 3, 10), GRIP));
    this.group.add(this.connector, this.bar, ...this.grips, ...this.loops);
    this.group.traverse((o) => { if ((o as THREE.Mesh).isMesh) o.castShadow = true; });
  }

  /** on the cable at `cable`, running along `yaw` (headingFor convention) at `pitch`, for a rider whose feet line is
   *  `hang` below the cable and who holds the grips as `grip` says */
  place(cable: RoutePoint, yaw: number, pitch: number, hang: number, grip: GripProfile): void {
    this.group.position.set(cable.x, cable.y, cable.z);
    this.group.rotation.set(0, yaw, 0);
    this.carriage.rotation.set(-pitch, 0, 0);
    const barDown = hang - (Math.max(AVATAR_H, grip.handY) + BAR_CLEAR);
    const gripDown = hang - grip.handY;
    this.connector.position.set(0, -2.8, 0);
    this.connector.scale.set(1, Math.max(0.1, barDown - 2.8), 1);
    this.bar.position.set(0, -barDown, 0);
    this.bar.scale.set(grip.halfSpan * 2 + 1.6, 1, 1);
    this.grips.forEach((m, i) => {
      const x = (i === 0 ? 1 : -1) * grip.halfSpan;
      m.position.set(x, -barDown, 0);
      m.scale.set(1, Math.max(0.1, gripDown - barDown - 1.5), 1);
      this.loops[i].position.set(x, -gripDown, 0);
    });
    this.group.updateMatrixWorld(true);
  }

  /** the handle's axis in the world (across the line): the rider's left (+) and right (−) */
  static axis(yaw: number, out = new THREE.Vector3()): THREE.Vector3 {
    return out.set(Math.cos(yaw), 0, -Math.sin(yaw));
  }

  dispose(): void {
    this.group.removeFromParent();
    this.group.traverse((o) => { if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).geometry.dispose(); });
  }
}

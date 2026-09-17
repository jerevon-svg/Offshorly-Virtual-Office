// vo3d — THE TOUCAN AI SCIENTIST OUTFIT for the AI Lab monkey. DEV-ONLY.
//
// COMPLETELY SEPARATE FROM THE CHARACTER. Nothing here touches the monkey's
// mesh, its 28-joint skeleton, its skin weights, its animations or its scale.
// The outfit is a handful of primitive meshes parented to three of the model's
// own bones, so removing it is `outfit.dispose()` and the monkey is exactly the
// approved master again.
//
// WHY BONE-PARENTED RIGID PIECES AND NOT A SKINNED GARMENT. A skinned coat would
// need its own weights painted against this skeleton — the very work this whole
// track has been avoiding. Rigid pieces on the right bones give the same read at
// this size, and each piece only has to survive the motion of ONE joint:
//     glasses  -> mixamorig:Head      (turns with the head, never slides)
//     coat     -> mixamorig:Spine2    (chest; the torso barely twists in Walking)
//     sleeves  -> mixamorig:Left/RightArm (follow the arm swing exactly, so a
//                 ring around the bicep cannot clip no matter how the arm moves)
// SHORT sleeves are a fit decision, not only a style one: a long sleeve would
// have to cross the elbow, which is where a rigid piece would tear.
//
// ALL GEOMETRY IS IN THE MODEL'S NATIVE UNITS (the master is 1.700 tall). The
// pieces are built as children of the loaded scene and then re-parented with
// Object3D.attach, which preserves the world transform, so the loader's
// fit-to-office scale carries through untouched.
//
// Measured fit points (native units, +z is the face, y up):
//     face front at eye height  z 0.346, |x| < 0.318, y 1.15..1.35
//     ears                      |x| 0.420..0.662, y 0.870..1.278
//     torso core                |x| < 0.24, z -0.16..0.16, y 0.50..0.85
//     upper arm                 y 0.626..0.766 (radius ~0.07), shoulder x ±0.154
//     tail root                 +x side, y 0.40..0.55 — the coat stops above it
import * as THREE from "three";

const WHITE = 0xf2f3f5;      // lab coat
const SHIRT = 0x2b3038;      // dark inner shirt
const FRAME = 0x1b1d22;      // glasses frame
const LENS = 0xdce6ee;       // CLEAR lens — the reference reads the eyes THROUGH the glasses
const BRAND = 0x1f9e8f;      // Offshorly/Toucan ring mark
const LANYARD = 0x23262c;    // dark neck strap
const BADGE = 0xf7f8fa;

type Piece = { mesh: THREE.Object3D; bone: string };

export class MonkeyOutfit {
  readonly group = new THREE.Group();          // bookkeeping only; pieces live on bones
  private pieces: Piece[] = [];
  private materials: THREE.Material[] = [];
  private geometries: THREE.BufferGeometry[] = [];
  private attached = false;

  private mat(color: number, rough = 0.62, metal = 0): THREE.MeshStandardMaterial {
    const m = new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal });
    this.materials.push(m);
    return m;
  }

  private track<T extends THREE.BufferGeometry>(g: T): T {
    this.geometries.push(g);
    return g;
  }

  /** Build every piece and hang it off the right bone of `scene`.
   *  Returns false (and changes nothing) if the expected bones are missing. */
  attach(scene: THREE.Object3D): boolean {
    if (this.attached) return true;
    // three.js's GLTFLoader sanitises glTF node names and STRIPS the colon, so
    // `mixamorig:Head` in the file is `mixamorigHead` in the scene graph. Accept
    // both spellings rather than depending on which loader built the graph.
    const bone = (n: string) =>
      (scene.getObjectByName(n) ?? scene.getObjectByName(n.replace(":", ""))) as THREE.Bone | undefined;
    const head = bone("mixamorig:Head");
    const chest = bone("mixamorig:Spine2");
    const armL = bone("mixamorig:LeftArm");
    const armR = bone("mixamorig:RightArm");
    if (!head || !chest || !armL || !armR) {
      console.warn("[vo3d] monkey outfit: expected bones not found; outfit skipped");
      return false;
    }
    scene.updateMatrixWorld(true);

    const white = this.mat(WHITE, 0.68);
    const shirt = this.mat(SHIRT, 0.72);
    const frame = this.mat(FRAME, 0.38, 0.35);
    const lens = new THREE.MeshStandardMaterial({
      color: LENS, roughness: 0.08, metalness: 0.0,
      transparent: true, opacity: 0.13, depthWrite: false,
    });
    this.materials.push(lens);
    const brand = this.mat(BRAND, 0.5);
    const lanyard = this.mat(LANYARD, 0.75);
    const badge = this.mat(BADGE, 0.45);

    // ---------------- GLASSES (head) --------------------------------------
    // Round dark lenses sitting just off the face plane (z 0.346 at eye height),
    // inset from the cheek edge so they read as fitted rather than goggles.
    const glasses = new THREE.Group();
    glasses.name = "monkey-glasses";
    // Measured: the face front plane runs z 0.348 (y 1.14) -> 0.331 (y 1.30) and the
    // muzzle peaks at z 0.420 around y 1.02. The frames were at y 1.238, which put
    // them on the BROW — the eyes sat below the lenses. Centre is y 1.170.
    // Trimmed after review: the 0.113 lenses with a 0.020 rim overhung onto the
    // cheeks. Smaller radius and a much finer rim keep the round shape while
    // cutting the visual bulk; the eyes stay fully readable through them.
    const EYE_X = 0.143, EYE_Y = 1.172, LENS_R = 0.092, LENS_Z = 0.358;
    for (const s of [-1, 1]) {
      const rim = new THREE.Mesh(this.track(new THREE.TorusGeometry(LENS_R, 0.0115, 10, 32)), frame);
      rim.position.set(s * EYE_X, EYE_Y, LENS_Z);
      glasses.add(rim);
      const disc = new THREE.Mesh(this.track(new THREE.CircleGeometry(LENS_R, 32)), lens);
      disc.position.set(s * EYE_X, EYE_Y, LENS_Z - 0.004);
      glasses.add(disc);
      // temple arm sweeping back toward the ear (ears start at |x| 0.42)
      // temple runs from the rim's outer edge back to the ear (ears start |x| 0.420)
      // temple from the rim's outer edge back toward the ear (ears start |x| 0.420)
      const temple = new THREE.Mesh(this.track(new THREE.BoxGeometry(0.30, 0.011, 0.011)), frame);
      temple.position.set(s * 0.300, EYE_Y + 0.016, 0.196);
      temple.rotation.set(0, s * -0.74, 0);
      glasses.add(temple);
    }
    // bridge across the muzzle
    const bridge = new THREE.Mesh(this.track(new THREE.BoxGeometry(0.064, 0.011, 0.011)), frame);
    bridge.position.set(0, EYE_Y + 0.018, LENS_Z - 0.004);
    glasses.add(bridge);
    this.pieces.push({ mesh: glasses, bone: "mixamorig:Head" });

    // ---------------- LAB COAT (chest) ------------------------------------
    // Measured fit: torso half-width 0.21 (y 0.52..0.78), front face z ~0.176.
    // The first version stopped at y 0.50 and read as a crop top. It now runs
    // BELOW the hips as a panelled skirt.
    //
    // THE TAIL DECIDES THE SKIRT'S SHAPE. Tail geometry occupies x > 0.26 between
    // y 0.28 and 0.48, so a closed barrel would bury it. The skirt is therefore
    // two FRONT panels plus a BACK panel with open side vents — which is also what
    // makes it read as cloth rather than a cylinder. In three.js CylinderGeometry
    // theta starts at +Z (the face) and sweeps toward +X, so the spans below are
    // literal: front-left, front-right, back.
    const coat = new THREE.Group();
    coat.name = "monkey-labcoat";
    const R_COAT = 0.248, TOP = 0.800, BOT = 0.500;
    const H = TOP - BOT, MIDY = (TOP + BOT) / 2;
    const FRONT = R_COAT + 0.008;

    const shell = new THREE.Mesh(
      this.track(new THREE.CylinderGeometry(R_COAT, R_COAT * 1.10, H, 40, 1, true)), white,
    );
    shell.position.set(0, MIDY, -0.014);
    shell.material.side = THREE.DoubleSide;
    coat.add(shell);

    // ---- skirt: below the hips, vented at the sides for the tail ----------
    const S_TOP = 0.520, S_BOT = 0.330, SH = S_TOP - S_BOT, SMID = (S_TOP + S_BOT) / 2;
    const skirtPanel = (thetaStart: number, thetaLen: number) => {
      const m = new THREE.Mesh(
        this.track(new THREE.CylinderGeometry(R_COAT * 1.06, R_COAT * 1.24, SH, 28, 1, true,
          thetaStart, thetaLen)), white,
      );
      m.material.side = THREE.DoubleSide;
      m.position.set(0, SMID, -0.014);
      coat.add(m);
    };
    skirtPanel(0.30, 0.88);        // front-right panel
    skirtPanel(-1.18, 0.88);       // front-left panel
    skirtPanel(Math.PI - 0.85, 1.70); // back panel
    // side vents (roughly 66deg..134deg either side) are deliberately empty:
    // that is where the tail passes through.

    // dark inner shirt: a placket down the open front, chest to below the hem
    const inner = new THREE.Mesh(this.track(new THREE.BoxGeometry(0.150, H + SH * 0.55, 0.030)), shirt);
    inner.position.set(0, MIDY - 0.082, FRONT - 0.004);
    coat.add(inner);

    // ---- lapels: a proper V collar folding back off the opening -----------
    for (const s of [-1, 1]) {
      const lapel = new THREE.Mesh(this.track(new THREE.BoxGeometry(0.120, H * 0.96, 0.026)), white);
      lapel.position.set(s * 0.132, MIDY + 0.006, FRONT - 0.020);
      lapel.rotation.set(0, s * 0.52, s * -0.13);
      coat.add(lapel);
      // front panel edge continuing the lapel line down over the skirt
      const edge = new THREE.Mesh(this.track(new THREE.BoxGeometry(0.048, SH * 1.02, 0.024)), white);
      edge.position.set(s * 0.118, SMID + 0.010, FRONT - 0.034);
      edge.rotation.set(0, s * 0.46, 0);
      coat.add(edge);
    }

    const collar = new THREE.Mesh(this.track(new THREE.TorusGeometry(0.150, 0.028, 10, 28)), white);
    collar.position.set(0, TOP - 0.006, -0.014);
    collar.rotation.set(Math.PI / 2, 0, 0);
    coat.add(collar);

    const ringChest = new THREE.Mesh(this.track(new THREE.TorusGeometry(0.030, 0.010, 10, 24)), brand);
    ringChest.position.set(-0.126, TOP - 0.078, FRONT + 0.012);
    ringChest.rotation.set(0, -0.45, 0);
    coat.add(ringChest);
    const ringBack = new THREE.Mesh(this.track(new THREE.TorusGeometry(0.038, 0.012, 10, 24)), brand);
    ringBack.position.set(0, TOP - 0.110, -R_COAT - 0.030);
    coat.add(ringBack);

    // ---------------- ID BADGE ON A LANYARD --------------------------------
    for (const s2 of [-1, 1]) {
      const strap = new THREE.Mesh(this.track(new THREE.BoxGeometry(0.014, 0.215, 0.010)), lanyard);
      strap.position.set(s2 * 0.070, TOP - 0.112, FRONT + 0.016);
      strap.rotation.set(0, 0, s2 * 0.26);
      coat.add(strap);
    }
    const badgeG = new THREE.Group();
    badgeG.name = "monkey-badge";
    badgeG.add(new THREE.Mesh(this.track(new THREE.BoxGeometry(0.078, 0.104, 0.012)), badge));
    const stripe = new THREE.Mesh(this.track(new THREE.BoxGeometry(0.078, 0.024, 0.014)), lanyard);
    stripe.position.set(0, 0.038, 0.001);
    badgeG.add(stripe);
    const cardRing = new THREE.Mesh(this.track(new THREE.TorusGeometry(0.021, 0.007, 10, 20)), brand);
    cardRing.position.set(0, -0.010, 0.008);
    badgeG.add(cardRing);
    badgeG.position.set(0.004, TOP - 0.232, FRONT + 0.028);
    coat.add(badgeG);

    this.pieces.push({ mesh: coat, bone: "mixamorig:Spine2" });

    // ---------------- SLEEVES (arms) ---------------------------------------
    // CONSTRUCTION CHANGED after review: the previous version was a constant-width
    // tube floating mid-limb, so it read as a disconnected band however its
    // dimensions were tweaked. A sleeve is not a tube — it is a TAPER that starts
    // as wide as the coat's shoulder and narrows to the elbow. So this is now a
    // cone whose wide end matches the coat shell (0.128, vs coat radius 0.248 at
    // the torso) and whose narrow end sits at the elbow, plus a shoulder dome
    // that closes the join into the coat.
    //
    // Measured arm chain: shoulder x 0.154 -> elbow x 0.356 -> wrist x 0.550.
    // The sleeve spans x 0.150..0.362 — visibly to the elbow, not past it.
    // Cylinder +Y maps to -X under rotation.z=+pi/2, so the WIDE end (radiusTop)
    // always points inboard at the shoulder for both arms via rotation.z = s*pi/2.
    for (const [s, name] of [[1, "mixamorig:LeftArm"], [-1, "mixamorig:RightArm"]] as const) {
      const sleeve = new THREE.Group();
      sleeve.name = `monkey-sleeve-${s > 0 ? "L" : "R"}`;
      const X0 = 0.150, X1 = 0.362;                 // shoulder -> elbow
      const LEN = X1 - X0, CX = (X0 + X1) / 2;
      const CY = 0.722, CZ = -0.030;

      const taper = new THREE.Mesh(
        this.track(new THREE.CylinderGeometry(0.128, 0.086, LEN, 28, 1, true)), white,
      );
      taper.material.side = THREE.DoubleSide;
      taper.rotation.set(0, 0, s * Math.PI / 2);
      taper.position.set(s * CX, CY, CZ);
      sleeve.add(taper);

      // shoulder dome — closes the sleeve into the coat so there is no gap
      const dome = new THREE.Mesh(this.track(new THREE.SphereGeometry(0.129, 22, 16)), white);
      dome.position.set(s * (X0 + 0.012), CY + 0.004, CZ);
      dome.scale.set(0.80, 1.0, 1.0);
      sleeve.add(dome);

      // rolled hem at the elbow
      const hem = new THREE.Mesh(this.track(new THREE.TorusGeometry(0.088, 0.014, 10, 26)), white);
      hem.position.set(s * X1, CY - 0.006, CZ);
      hem.rotation.set(0, Math.PI / 2, 0);
      sleeve.add(hem);

      this.pieces.push({ mesh: sleeve, bone: name });
    }

    // ---- hang everything off the bones, preserving the fitted world pose ----
    for (const p of this.pieces) {
      const b = bone(p.bone);
      if (!b) continue;
      p.mesh.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        // the AI Lab is out of the shadow pass entirely (build/ailab cost rules)
        m.castShadow = false;
        m.receiveShadow = false;
        m.frustumCulled = false;
      });
      scene.add(p.mesh);          // position in model space first…
      scene.updateMatrixWorld(true);
      b.attach(p.mesh);           // …then re-parent, keeping the world transform
      this.group.add(new THREE.Object3D()); // bookkeeping placeholder
    }
    this.attached = true;
    return true;
  }

  get visible(): boolean { return this.pieces.every((p) => p.mesh.visible); }
  set visible(v: boolean) { for (const p of this.pieces) p.mesh.visible = v; }

  /** triangles the outfit adds */
  get triangles(): number {
    let n = 0;
    for (const p of this.pieces) {
      p.mesh.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh || !m.geometry) return;
        const idx = m.geometry.getIndex();
        n += idx ? idx.count / 3 : m.geometry.getAttribute("position").count / 3;
      });
    }
    return Math.round(n);
  }

  /** put the monkey back exactly as the approved master */
  dispose(): void {
    for (const p of this.pieces) p.mesh.removeFromParent();
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
    this.pieces = [];
    this.geometries = [];
    this.materials = [];
    this.attached = false;
  }
}

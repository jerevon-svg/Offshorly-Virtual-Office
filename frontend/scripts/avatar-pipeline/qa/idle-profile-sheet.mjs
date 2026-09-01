// ---------------------------------------------------------------------------
// Idle-profile review sheet (zero credits): CPU-skins one character's rig at a
// frame of two idle clips and rasterizes front / three-quarter / back views
// side by side, so a masculine-vs-feminine idle choice (see lod-policy.mjs's
// IDLE_PROFILES) can be judged without a browser. Hand-bone vertices are
// tinted red and ForeArm orange so arm/wrist flare is unambiguous.
//
// Generalized from bon-v3-idle-9-handfix-v1-sheet.mjs (same skinning, camera
// and tinting) so every character can be reviewed with one command.
//
//   node scripts/avatar-pipeline/qa/idle-profile-sheet.mjs <chain-id> \
//        <beforeLabel>=<clip.glb> <afterLabel>=<clip.glb> [--frame=30] [--out=<png>]
//
// Clip paths are relative to the chain's own output dir.
// ---------------------------------------------------------------------------
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import sharp from "sharp";

const [chain, ...rest] = process.argv.slice(2);
const clips = rest.filter((a) => !a.startsWith("--")).map((a) => {
  const eq = a.indexOf("=");
  if (eq < 1) throw new Error(`bad clip spec (expected <label>=<file.glb>): ${a}`);
  return { label: a.slice(0, eq), file: a.slice(eq + 1) };
});
if (!chain || clips.length < 2) {
  console.error("Usage: node idle-profile-sheet.mjs <chain-id> <label>=<clip.glb> <label>=<clip.glb> [--frame=N] [--out=file.png]");
  process.exit(1);
}
const flag = (name, fallback) => {
  const hit = rest.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const FRAME = Number(flag("frame", 30));
const D = `scripts/avatar-pipeline/output/meshy-employees/${chain}/`;
const OUT = D + flag("out", `${chain}-sheet-idle-profile.png`);

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const qm = (a,b) => { const [x1,y1,z1,w1]=a,[x2,y2,z2,w2]=b;
  return [w1*x2+x1*w2+y1*z2-z1*y2, w1*y2-x1*z2+y1*w2+z1*x2, w1*z2+x1*y2-y1*x2+z1*w2, w1*w2-x1*x2-y1*y2-z1*z2]; };
const trs = (t,r,s) => { const [x,y,z,w]=r, x2=x+x,y2=y+y,z2=z+z;
  const xx=x*x2,xy=x*y2,xz=x*z2,yy=y*y2,yz=y*z2,zz=z*z2,wx=w*x2,wy=w*y2,wz=w*z2;
  return [(1-(yy+zz))*s[0],(xy+wz)*s[0],(xz-wy)*s[0],0,(xy-wz)*s[1],(1-(xx+zz))*s[1],(yz+wx)*s[1],0,
          (xz+wy)*s[2],(yz-wx)*s[2],(1-(xx+yy))*s[2],0,t[0],t[1],t[2],1]; };
const mul = (a,b) => { const o=new Array(16);
  for(let c=0;c<4;c++)for(let r=0;r<4;r++){let v=0;for(let k=0;k<4;k++)v+=a[k*4+r]*b[c*4+k];o[c*4+r]=v;} return o; };
const xf = (m,p) => [m[0]*p[0]+m[4]*p[1]+m[8]*p[2]+m[12], m[1]*p[0]+m[5]*p[1]+m[9]*p[2]+m[13], m[2]*p[0]+m[6]*p[1]+m[10]*p[2]+m[14]];

const rig = await io.read(D + `${chain}-rigged.glb`);
const root = rig.getRoot();
const skin = root.listSkins()[0];
const jointNames = skin.listJoints().map((j) => j.getName());
const ibm = skin.getInverseBindMatrices().getArray();
const prim = root.listMeshes()[0].listPrimitives()[0];
const POS = prim.getAttribute("POSITION").getArray();
const JI = prim.getAttribute("JOINTS_0").getArray();
const WT = prim.getAttribute("WEIGHTS_0").getArray();
const N = prim.getAttribute("POSITION").getCount();
const HAND = new Set([jointNames.indexOf("LeftHand"), jointNames.indexOf("RightHand")]);
const FOREARM = new Set([jointNames.indexOf("LeftForeArm"), jointNames.indexOf("RightForeArm")]);

async function worldMats(clipFile, frame) {
  const d = await io.read(D + clipFile);
  const anim = d.getRoot().listAnimations()[0];
  const ov = {};
  for (const ch of anim.listChannels()) {
    const nm = ch.getTargetNode().getName(), p = ch.getTargetPath();
    const o = ch.getSampler().getOutput().getArray(), n = p === "rotation" ? 4 : 3;
    const k = Math.min(frame, o.length / n - 1);
    (ov[nm] = ov[nm] || {})[p] = Array.from(o.slice(k * n, k * n + n));
  }
  const out = {};
  const walk = (node, parent) => {
    const nm = node.getName(), o = ov[nm] || {};
    const m = mul(parent, trs(o.translation || node.getTranslation(), o.rotation || node.getRotation(), o.scale || node.getScale()));
    out[nm] = m;
    for (const c of node.listChildren()) walk(c, m);
  };
  for (const n of d.getRoot().listScenes()[0].listChildren()) walk(n, [1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]);
  return jointNames.map((n) => out[n]);
}

function skinAll(jw) {
  const skinMats = jw.map((m, i) => mul(m, Array.from(ibm.slice(i*16, i*16+16))));
  const pts = new Float32Array(N * 3);
  const tint = new Uint8Array(N);
  for (let i = 0; i < N; i++) {
    const p = [POS[i*3], POS[i*3+1], POS[i*3+2]];
    let x=0,y=0,z=0, handW=0, faW=0;
    for (let k = 0; k < 4; k++) {
      const w = WT[i*4+k]; if (w <= 0) continue;
      const j = JI[i*4+k];
      if (HAND.has(j)) handW += w; if (FOREARM.has(j)) faW += w;
      const q = xf(skinMats[j], p);
      x += w*q[0]; y += w*q[1]; z += w*q[2];
    }
    pts[i*3]=x; pts[i*3+1]=y; pts[i*3+2]=z;
    tint[i] = handW > 0.5 ? 2 : faW > 0.5 ? 1 : 0;
  }
  return { pts, tint };
}

const W = 300, H = 400;
function render(pts, tint, yawDeg, label) {
  const yaw = yawDeg * Math.PI / 180, cy = Math.cos(yaw), sy = Math.sin(yaw);
  let minX=1e9,maxX=-1e9,minY=1e9,maxY=-1e9;
  const rx = new Float32Array(N), ry = new Float32Array(N), rz = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const x = pts[i*3], y = pts[i*3+1], z = pts[i*3+2];
    const X = x*cy + z*sy, Z = -x*sy + z*cy;
    rx[i]=X; ry[i]=y; rz[i]=Z;
    if(X<minX)minX=X; if(X>maxX)maxX=X; if(y<minY)minY=y; if(y>maxY)maxY=y;
  }
  const pad = 18;
  const s = Math.min((W-2*pad)/(maxX-minX), (H-2*pad-14)/(maxY-minY));
  const ox = W/2 - (minX+maxX)/2*s, oy = H-pad + minY*s;
  const buf = Buffer.alloc(W*H*3, 255);
  const zb = new Float32Array(W*H).fill(-1e9);
  for (let i = 0; i < N; i++) {
    const px = Math.round(rx[i]*s + ox), py = Math.round(oy - ry[i]*s);
    if (px<0||px>=W||py<0||py>=H) continue;
    const idx = py*W+px;
    if (rz[i] <= zb[idx]) continue;
    zb[idx] = rz[i];
    const shade = 0.55 + 0.45*((rz[i]-(-1))/2);
    const t = tint[i];
    const col = t===2 ? [220,40,40] : t===1 ? [235,150,40] : [95,110,135];
    for (let c=0;c<3;c++) buf[idx*3+c] = Math.max(0, Math.min(255, Math.round(col[c]*Math.max(0.5,Math.min(1.15,shade)))));
  }
  return sharp(buf, { raw: { width: W, height: H, channels: 3 } })
    .composite([{ input: Buffer.from(
      `<svg width="${W}" height="${H}"><text x="8" y="17" font-family="monospace" font-size="13" fill="#111">${label}</text></svg>`), top:0, left:0 }])
    .png().toBuffer();
}

const VIEWS = [["front", 0], ["3/4", 40], ["back", 180]];
const rows = [];
for (const { label, file } of clips) {
  const { pts, tint } = skinAll(await worldMats(file, FRAME));
  const tiles = [];
  for (const [vn, yaw] of VIEWS) tiles.push(await render(pts, tint, yaw, `${label} ${vn}`));
  rows.push(tiles);
}
const sheet = await sharp({ create: { width: W*VIEWS.length, height: H*rows.length, channels: 3, background: { r:255,g:255,b:255 } } })
  .composite(rows.flatMap((tiles, r) => tiles.map((t, c) => ({ input: t, left: c*W, top: r*H }))))
  .png().toBuffer();
await sharp(sheet).toFile(OUT);
console.log(`wrote ${OUT} (red = Hand-bone verts, orange = ForeArm, frame ${FRAME})`);

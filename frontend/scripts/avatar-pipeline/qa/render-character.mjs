// ---------------------------------------------------------------------------
// Headless CPU renderer that reproduces what CharacterCanvas actually shows:
//   - skins the mesh on the CPU from a chosen clip/frame (same bone math)
//   - CharacterCanvas's exact camera (CONFIG: elev 35, azim 0, ortho, the
//     bone-box framing with the 12% pad and frameMarginX/Y)
//   - the unlit MeshBasicMaterial look: base-colour texture ONLY, sampled
//     bilinearly, no lights, no emissive, no specular
// Purpose: judge surface quality (seams/cracks/speckle) without a browser.
// ---------------------------------------------------------------------------
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import draco3d from "draco3dgltf";
import sharp from "sharp";

const CONFIG = { elevationDeg: 35, azimuthDeg: 0, distance: 5, frameMarginY: 1.09, frameMarginX: 1.115 };

export async function makeIO() {
  return new NodeIO().registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ "draco3d.decoder": await draco3d.createDecoderModule() });
}
const qm=(a,b)=>{const[x1,y1,z1,w1]=a,[x2,y2,z2,w2]=b;
 return[w1*x2+x1*w2+y1*z2-z1*y2,w1*y2-x1*z2+y1*w2+z1*x2,w1*z2+x1*y2-y1*x2+z1*w2,w1*w2-x1*x2-y1*y2-z1*z2];};
const trs=(t,r,s)=>{const[x,y,z,w]=r,x2=x+x,y2=y+y,z2=z+z;
 const xx=x*x2,xy=x*y2,xz=x*z2,yy=y*y2,yz=y*z2,zz=z*z2,wx=w*x2,wy=w*y2,wz=w*z2;
 return[(1-(yy+zz))*s[0],(xy+wz)*s[0],(xz-wy)*s[0],0,(xy-wz)*s[1],(1-(xx+zz))*s[1],(yz+wx)*s[1],0,
        (xz+wy)*s[2],(yz-wx)*s[2],(1-(xx+yy))*s[2],0,t[0],t[1],t[2],1];};
const mul=(a,b)=>{const o=new Array(16);for(let c=0;c<4;c++)for(let r=0;r<4;r++){let v=0;for(let k=0;k<4;k++)v+=a[k*4+r]*b[c*4+k];o[c*4+r]=v;}return o;};
const xf=(m,p)=>[m[0]*p[0]+m[4]*p[1]+m[8]*p[2]+m[12],m[1]*p[0]+m[5]*p[1]+m[9]*p[2]+m[13],m[2]*p[0]+m[6]*p[1]+m[10]*p[2]+m[14]];

// Skinned world positions + UVs for one clip/frame, plus the bone box.
export function poseMesh(doc, clipName, frame, headingDeg = 0) {
  const root = doc.getRoot();
  const skin = root.listSkins()[0];
  const jn = skin.listJoints().map(j => j.getName());
  const ibm = skin.getInverseBindMatrices().getArray();
  const prim = root.listMeshes()[0].listPrimitives()[0];
  const POS = prim.getAttribute("POSITION").getArray();
  const UV  = prim.getAttribute("TEXCOORD_0").getArray();
  const JI  = prim.getAttribute("JOINTS_0").getArray();
  const WT  = prim.getAttribute("WEIGHTS_0").getArray();
  const IDX = prim.getIndices()?.getArray();
  const N   = prim.getAttribute("POSITION").getCount();

  const anim = clipName ? root.listAnimations().find(a => a.getName() === clipName) : null;
  const ov = {};
  if (anim) for (const ch of anim.listChannels()) {
    const nm = ch.getTargetNode().getName(), p = ch.getTargetPath();
    const o = ch.getSampler().getOutput().getArray(), n = p === "rotation" ? 4 : 3;
    const k = Math.min(frame, o.length / n - 1);
    (ov[nm] = ov[nm] || {})[p] = Array.from(o.slice(k * n, k * n + n));
  }
  const hy = headingDeg * Math.PI / 180;
  const rootM = [Math.cos(hy),0,-Math.sin(hy),0, 0,1,0,0, Math.sin(hy),0,Math.cos(hy),0, 0,0,0,1];
  const W = {};
  const walk = (node, par) => { const nm = node.getName(), o = ov[nm] || {};
    const m = mul(par, trs(o.translation || node.getTranslation(), o.rotation || node.getRotation(), o.scale || node.getScale()));
    W[nm] = m; for (const c of node.listChildren()) walk(c, m); };
  for (const n of root.listScenes()[0].listChildren()) walk(n, rootM);

  const sm = jn.map((n, i) => mul(W[n], Array.from(ibm.slice(i*16, i*16+16))));
  const P = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    const p = [POS[i*3], POS[i*3+1], POS[i*3+2]];
    let x=0,y=0,z=0;
    for (let k = 0; k < 4; k++) { const w = WT[i*4+k]; if (w <= 0) continue;
      const q = xf(sm[JI[i*4+k]], p); x += w*q[0]; y += w*q[1]; z += w*q[2]; }
    P[i*3]=x; P[i*3+1]=y; P[i*3+2]=z;
  }
  const bones = jn.map(n => [W[n][12], W[n][13], W[n][14]]);
  return { P, UV, IDX, N, bones };
}

// CharacterCanvas's framing: bone box + 12% pad; heading-independent variant
// mirrors computeStableFramingBox (measure with heading 0).
export function framingFromBones(bones) {
  let mn=[1e9,1e9,1e9], mx=[-1e9,-1e9,-1e9];
  for (const b of bones) for (let k=0;k<3;k++){ mn[k]=Math.min(mn[k],b[k]); mx[k]=Math.max(mx[k],b[k]); }
  const size = mx.map((v,i)=>v-mn[i]);
  for (let k=0;k<3;k++){ mn[k]-=size[k]*0.12; mx[k]+=size[k]*0.12; }
  return { min: mn, max: mx };
}

export function makeCamera(box, baseW, baseH) {
  const size = box.max.map((v,i)=>v-box.min[i]);
  const elev = CONFIG.elevationDeg*Math.PI/180, az = CONFIG.azimuthDeg*Math.PI/180, d = CONFIG.distance;
  const target = [0, size[1]*0.5, 0];
  let eye = [target[0] + d*Math.cos(elev)*Math.sin(az), target[1] + d*Math.sin(elev), target[2] + d*Math.cos(elev)*Math.cos(az)];
  const norm=v=>{const n=Math.hypot(...v);return v.map(x=>x/n);};
  const sub=(a,b)=>[a[0]-b[0],a[1]-b[1],a[2]-b[2]];
  const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
  const dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
  const buildBasis = (eye, target) => { const fwd = norm(sub(eye, target));
    const right = norm(cross([0,1,0], fwd)); const up = cross(fwd, right); return { fwd, right, up }; };
  let B = buildBasis(eye, target);
  const extent = (bx, eye, B) => { let e={minX:1e9,maxX:-1e9,minY:1e9,maxY:-1e9};
    for (const X of [bx.min[0],bx.max[0]]) for (const Y of [bx.min[1],bx.max[1]]) for (const Z of [bx.min[2],bx.max[2]]) {
      const v = sub([X,Y,Z], eye);
      const cx = dot(v,B.right), cy = dot(v,B.up);
      e.minX=Math.min(e.minX,cx); e.maxX=Math.max(e.maxX,cx); e.minY=Math.min(e.minY,cy); e.maxY=Math.max(e.maxY,cy); }
    return e; };
  const e1 = extent(box, eye, B);
  eye = [eye[0] + B.right[0]*((e1.minX+e1.maxX)/2) + B.up[0]*((e1.minY+e1.maxY)/2),
         eye[1] + B.right[1]*((e1.minX+e1.maxX)/2) + B.up[1]*((e1.minY+e1.maxY)/2),
         eye[2] + B.right[2]*((e1.minX+e1.maxX)/2) + B.up[2]*((e1.minY+e1.maxY)/2)];
  const e2 = extent(box, eye, B);
  const aspect = baseW/baseH;
  const top = Math.max(((e2.maxY-e2.minY)/2)*CONFIG.frameMarginY, (((e2.maxX-e2.minX)/2)*CONFIG.frameMarginX)/aspect);
  return { eye, B, top, right: top*aspect, aspect,
    project(p) { const v = sub(p, this.eye);
      return [ dot(v,this.B.right)/this.right, dot(v,this.B.up)/this.top, dot(v,this.B.fwd) ]; } };  // +fwd points at the eye, so larger = nearer
}

// Unlit textured rasterizer (MeshBasicMaterial equivalent): bilinear base-colour only.
export function rasterize(mesh, cam, tex, W, H, bg = [255,255,255]) {
  const { P, UV, IDX, N } = mesh;
  const buf = Buffer.alloc(W*H*3);
  for (let i = 0; i < W*H; i++) { buf[i*3]=bg[0]; buf[i*3+1]=bg[1]; buf[i*3+2]=bg[2]; }
  const zb = new Float32Array(W*H).fill(-Infinity);
  const tw = tex.width, th = tex.height, td = tex.data, tc = tex.channels;
  const sample = (u, v) => {
    u = u - Math.floor(u); v = v - Math.floor(v);
    const x = u*tw - 0.5, y = v*th - 0.5;   // glTF UV origin is top-left
    const x0 = Math.floor(x), y0 = Math.floor(y), fx = x-x0, fy = y-y0;
    const c = [0,0,0];
    for (let dy=0; dy<2; dy++) for (let dx=0; dx<2; dx++) {
      const xx = Math.min(tw-1, Math.max(0, x0+dx)), yy = Math.min(th-1, Math.max(0, y0+dy));
      const w = (dx?fx:1-fx)*(dy?fy:1-fy), o = (yy*tw+xx)*tc;
      c[0]+=td[o]*w; c[1]+=td[o+1]*w; c[2]+=td[o+2]*w;
    }
    return c;
  };
  const triCount = IDX ? IDX.length/3 : N/3;
  const sx = [], sy = [], sz = [];
  for (let i = 0; i < N; i++) {
    const q = cam.project([P[i*3],P[i*3+1],P[i*3+2]]);
    sx[i] = (q[0]*0.5+0.5)*W; sy[i] = (0.5-q[1]*0.5)*H; sz[i] = q[2];
  }
  for (let t = 0; t < triCount; t++) {
    const a = IDX?IDX[t*3]:t*3, b = IDX?IDX[t*3+1]:t*3+1, c = IDX?IDX[t*3+2]:t*3+2;
    const x0=sx[a],y0=sy[a],x1=sx[b],y1=sy[b],x2=sx[c],y2=sy[c];
    const area = (x1-x0)*(y2-y0)-(x2-x0)*(y1-y0);
    if (area === 0) continue;
    const minX=Math.max(0,Math.floor(Math.min(x0,x1,x2))), maxX=Math.min(W-1,Math.ceil(Math.max(x0,x1,x2)));
    const minY=Math.max(0,Math.floor(Math.min(y0,y1,y2))), maxY=Math.min(H-1,Math.ceil(Math.max(y0,y1,y2)));
    for (let py=minY; py<=maxY; py++) for (let px=minX; px<=maxX; px++) {
      const cx=px+0.5, cy=py+0.5;
      let w0=((x1-x0)*(cy-y0)-(cx-x0)*(y1-y0))/area;
      let w1=((cx-x0)*(y2-y0)-(x2-x0)*(cy-y0))/area;
      let w2=1-w0-w1;
      if (w0<0||w1<0||w2<0) continue;
      const bA=w2, bB=w1, bC=w0;
      const z=bA*sz[a]+bB*sz[b]+bC*sz[c];
      const o=py*W+px;
      if (z<=zb[o]) continue;
      zb[o]=z;
      const u=bA*UV[a*2]+bB*UV[b*2]+bC*UV[c*2];
      const v=bA*UV[a*2+1]+bB*UV[b*2+1]+bC*UV[c*2+1];
      const col=sample(u,v);
      buf[o*3]=Math.max(0,Math.min(255,col[0]));
      buf[o*3+1]=Math.max(0,Math.min(255,col[1]));
      buf[o*3+2]=Math.max(0,Math.min(255,col[2]));
    }
  }
  return buf;
}

export async function baseColorTexture(doc) {
  const mat = doc.getRoot().listMaterials()[0];
  const tex = mat.getBaseColorTexture();
  const img = Buffer.from(tex.getImage());
  const { data, info } = await sharp(img).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height, channels: info.channels };
}

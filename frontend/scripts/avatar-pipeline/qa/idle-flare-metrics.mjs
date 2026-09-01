// Idle arm-flare metric (zero credits), promoted here from a per-character
// script so CHARACTER_PIPELINE_STANDARD.md section 3 can point at a tracked
// path (the pipeline's output/ tree is gitignored).
//
// Reports how far outboard of the hip the hands sit and how bent the elbow is
// across the idle clip — the numbers the arm-chain correction targets. Compares
// any set of <label>=<glb> args against each other, so a corrected clip can be
// judged against the raw one (and against another character's approved clip).
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import draco3d from "draco3dgltf";
const io=new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({"draco3d.decoder":await draco3d.createDecoderModule()});
const qm=(a,b)=>{const[x1,y1,z1,w1]=a,[x2,y2,z2,w2]=b;return[w1*x2+x1*w2+y1*z2-z1*y2,w1*y2-x1*z2+y1*w2+z1*x2,w1*z2+x1*y2-y1*x2+z1*w2,w1*w2-x1*x2-y1*y2-z1*z2];};
const qrot=(q,v)=>{const[x,y,z,w]=q,[a,b,c]=v;const ix=w*a+y*c-z*b,iy=w*b+z*a-x*c,iz=w*c+x*b-y*a,iw=-x*a-y*b-z*c;
 return[ix*w+iw*-x+iy*-z-iz*-y,iy*w+iw*-y+iz*-x-ix*-z,iz*w+iw*-z+ix*-y-iy*-x];};
const sub=(a,b)=>[a[0]-b[0],a[1]-b[1],a[2]-b[2]];
const nrm=(v)=>{const n=Math.hypot(...v);return v.map(x=>x/n);};
const dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
for(const spec of process.argv.slice(2)){
  const [label,file]=spec.split("=");
  const d=await io.read(file);
  const anim=d.getRoot().listAnimations()[0];
  const K=Math.max(...anim.listChannels().map(c=>c.getSampler().getOutput().getArray().length/(c.getTargetPath()==="rotation"?4:3)));
  const at=(f)=>{const ov={};for(const ch of anim.listChannels()){const nm=ch.getTargetNode().getName(),p=ch.getTargetPath();
    const o=ch.getSampler().getOutput().getArray(),n=p==="rotation"?4:3;const k=Math.min(f,o.length/n-1);
    (ov[nm]=ov[nm]||{})[p]=Array.from(o.slice(k*n,k*n+n));}
   const wq={},wp={};
   const walk=(node,pq,pp)=>{const nm=node.getName(),o=ov[nm]||{};
     const lq=o.rotation||node.getRotation(), lt=o.translation||node.getTranslation();
     const q=qm(pq,lq), r=qrot(pq,lt), p=[pp[0]+r[0],pp[1]+r[1],pp[2]+r[2]];
     wq[nm]=q; wp[nm]=p; for(const c of node.listChildren())walk(c,q,p);};
   for(const n of d.getRoot().listScenes()[0].listChildren())walk(n,[0,0,0,1],[0,0,0]);
   return {wq,wp};};
  const acc={L:[],R:[],eL:[],eR:[]};
  for(let f=0;f<K;f++){const {wq,wp}=at(f);
   for(const side of ["Left","Right"]){
     const S=side[0];
     acc[S].push(Math.abs(wp[side+"Hand"][0])-Math.abs(wp[side+"UpLeg"][0]));   // outboard of hip
     const ua=nrm(sub(wp[side+"ForeArm"],wp[side+"Arm"])), fa=nrm(sub(wp[side+"Hand"],wp[side+"ForeArm"]));
     acc["e"+S].push(Math.acos(Math.max(-1,Math.min(1,dot(ua,fa))))*180/Math.PI);
   }}
  const st=(a)=>`${Math.min(...a).toFixed(3)}..${Math.max(...a).toFixed(3)} (mean ${(a.reduce((x,y)=>x+y,0)/a.length).toFixed(3)})`;
  console.log(`${label.padEnd(22)} keys=${K}`);
  console.log(`   hand outboard of hip  L ${st(acc.L)}   R ${st(acc.R)}`);
  console.log(`   elbow bend deg        L ${st(acc.eL)}   R ${st(acc.eR)}`);
}

// vo3d app — THE STANDALONE DEV ENTRY. dev/vo3d.html loads this file and nothing else, exactly as it
// always has; the world itself now lives in app/world.ts behind createVo3dWorld(canvas).
//
// This page never disposes: it owns the document, the world lives as long as the tab, and that is the
// whole point of keeping it — the standalone V2 demo must stay presentable on its own, unchanged, while
// the same world becomes mountable somewhere else.
import { createVo3dWorld } from "./world";

createVo3dWorld(document.getElementById("stage") as HTMLCanvasElement);

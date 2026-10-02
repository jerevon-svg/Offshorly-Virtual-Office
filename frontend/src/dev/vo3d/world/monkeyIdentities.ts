// vo3d world — WHO THE AI LAB'S MONKEYAGENTS ARE (identity only: name and look). Production data, shared by the
// Lab's cast (avatar/MonkeyCastRunner). Runtime state —
// roles, execution state, stations — is never part of who anyone is.
import type { MonkeyIdentity } from "./monkeyAgentContract";

/** THE FOUNDERS — Milo, Nova and Pip, on the one production base */
export const FOUNDER_IDENTITIES: readonly MonkeyIdentity[] = [
  { id: "milo", name: "Milo",
    look: { iris: 0x6a4428, accent: 0xf2b134, garments: ["tee"], accessories: [{ item: "headset", socket: "ears" }] } },
  { id: "nova", name: "Nova",
    look: { fur: 0x6f7f99, marks: { crown: 0xd4dbe6 }, iris: 0x3f8f5a, accent: 0x3a2f45,
      garments: ["longsleeve"], accessories: [{ item: "glasses", socket: "face" }] } },
  { id: "pip", name: "Pip",
    look: { fur: 0xc08a3e, marks: { muzzle: 0xe2ad85 }, iris: 0x3b6fb5,
      garments: ["vest", "cap"], accessories: [] } },
];

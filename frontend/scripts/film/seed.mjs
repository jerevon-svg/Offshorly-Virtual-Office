#!/usr/bin/env node
// FILM RIG ONLY — clean, film-ready content in the ISOLATED film database, through the REAL API.
//
// Every write below is an ordinary request to the film backend (:8003 → backend/dev_film.db) as an
// ordinary employee, using the development identity header the frontend itself sends on this rig.
// Nothing is inserted into a table directly and nothing reaches production, Atlas or :8002.
// Idempotent: re-running finds what it made (by title) instead of piling up duplicates.
//
//   node scripts/film/seed.mjs            # create / refresh the film content
//   node scripts/film/seed.mjs --check    # print what the film DB holds, change nothing
const API = "http://localhost:8003";
const BON = "jerevon@offshorly.com";
const E = { alex: "alex@offshorly.com", angelo: "angelo@offshorly.com", micah: "micah@offshorly.com", jan: "jan@offshorly.com" };
const check = process.argv.includes("--check");

async function call(email, method, path, body) {
  const res = await fetch(`${API}${path}`, {
    method, headers: { "content-type": "application/json", "x-dev-email": email },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} as ${email} → ${res.status} ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

// Refuse to run against anything but the film backend: its /health must answer, and the port is fixed.
const health = await fetch(`${API}/health`).then((r) => r.ok, () => false);
if (!health) { console.error("film backend (:8003) is not running — backend/run-film-backend.sh"); process.exit(1); }

const day = 24 * 3600 * 1000;
const iso = (ms) => new Date(Date.now() + ms).toISOString();

// ---- Company Hub ------------------------------------------------------------------------------------
// Copy written for the camera: no [DEV], no testing language, no placeholders. The images are the
// product's own per-type hub art (image_url null → CompanyHub.tsx's TYPE_ART).
const HUB = [
  {
    type: "birthday", title: "Happy Birthday, Micah! 🎂",
    description: "Micah is celebrating today. Stop by the Design Room or send a birthday wish.",
    priority: "normal", ctaLabel: "Wish Happy Birthday", targetEmployeeEmail: E.micah,
  },
  {
    type: "recognition", title: "Kudos to Alex 🏆",
    description: "Alex went above and beyond for the team this month. Take a moment to say thank you.",
    priority: "important", ctaLabel: "Give Kudos", targetEmployeeEmail: E.alex,
  },
  {
    type: "announcement", title: "Friday Town Hall",
    description: "Join everyone in the Meeting Room at 4 PM for this month's wins and what's next.",
    priority: "normal", ctaLabel: "Read More",
  },
];

async function seedHub() {
  const items = await call(BON, "GET", "/hub/items");
  for (const spec of HUB) {
    if (items.some((i) => i.title === spec.title)) continue;
    if (check) { console.log(`hub: would create "${spec.title}"`); continue; }
    await call(BON, "POST", "/hub/items", { ...spec, startAt: iso(-3600e3), endAt: iso(30 * day) });
    console.log(`hub: created "${spec.title}"`);
  }
  // Bon has already read the product's own launch notice, so the post-check-in Hub opens on the film
  // items. Acknowledging is the real per-employee action the Hub's own button performs.
  const fresh = await call(BON, "GET", "/hub/items");
  for (const it of fresh) {
    if (it.priority === "required" && !check && !it.acknowledgedAt && !it.acknowledged_at) {
      await call(BON, "POST", `/hub/items/${it.id}/acknowledge`).catch(() => {});
    }
    if ((it.title === "Employee of the Month" || it.title === "Welcome to the Company Hub") && !check) {
      await call(BON, "POST", `/hub/items/${it.id}/dismiss`).catch(() => {});
    }
  }
  return fresh;
}

// ---- Chat: a few real conversations so Chat is not "No conversations yet." ------------------------
async function seedChat() {
  const convs = await call(BON, "GET", "/conversations");
  const dm = async (email) => (await call(BON, "POST", "/conversations", { peerEmail: email })).id;
  const out = {};
  for (const [k, email] of Object.entries(E)) out[k] = check ? convs.find((c) => (c.participants ?? []).some?.((p) => (p.email ?? p) === email))?.id : await dm(email);
  if (!check && !convs.some((c) => c.isGroup || c.is_group)) {
    const g = await call(BON, "POST", "/conversations/group", { participantEmails: Object.values(E) });
    out.team = g.id;
  } else out.team = convs.find((c) => c.isGroup || c.is_group)?.id;
  return out;
}

// ---- Boards: one office board with real Excalidraw elements --------------------------------------
const BOARD_TITLE = "Q4 Office Launch";
function note(id, x, y, text, bg) {
  const base = { id, x, y, angle: 0, strokeColor: "#1e1e1e", backgroundColor: bg, fillStyle: "solid", strokeWidth: 1,
    strokeStyle: "solid", roughness: 1, opacity: 100, groupIds: [], frameId: null, roundness: { type: 3 }, seed: 1 + x + y,
    version: 1, versionNonce: 1, isDeleted: false, updated: Date.now(), link: null, locked: false };
  return [
    { ...base, type: "rectangle", width: 200, height: 160, boundElements: [{ type: "text", id: `${id}-t` }] },
    { ...base, id: `${id}-t`, type: "text", x: x + 10, y: y + 60, width: 180, height: 40, backgroundColor: "transparent",
      text, originalText: text, fontSize: 20, fontFamily: 5, textAlign: "center", verticalAlign: "middle",
      containerId: id, lineHeight: 1.25, autoResize: true, boundElements: null, roundness: null },
  ];
}
async function seedBoard() {
  const boards = await call(BON, "GET", "/rooms/office/whiteboards");
  if (boards.some((b) => b.title === BOARD_TITLE) || check) return boards.find((b) => b.title === BOARD_TITLE)?.id;
  const b = await call(BON, "POST", "/rooms/office/whiteboards", { title: BOARD_TITLE });
  const elements = [
    ...note("n1", 0, 0, "Kickoff 🚀", "#ffec99"),
    ...note("n2", 240, 0, "Design review", "#b2f2bb"),
    ...note("n3", 480, 0, "Team demo day", "#a5d8ff"),
    ...note("n4", 120, 200, "Celebrate the win 🎉", "#ffc9c9"),
  ];
  const document = { type: "excalidraw", version: 2, source: "https://excalidraw.com", elements, appState: { viewBackgroundColor: "#ffffff" }, files: {} };
  await call(BON, "PUT", `/whiteboards/${b.id}`, { document, version: b.version ?? 1 });
  console.log(`board: created "${BOARD_TITLE}"`);
  return b.id;
}

// ---- Messages: sent over the REAL socket by each employee (the same send_message a browser emits) --
const SCRIPT = [
  ["alex", "alex", "Morning! Ready for the design review at 2?"],
  ["bon", "alex", "Yes! Bringing the new office mockups 🙌"],
  ["micah", "micah", "Thank you all for the birthday wishes 🎂"],
  ["angelo", "angelo", "Pushed the fix, can you take a look?"],
  ["jan", "jan", "Heading to the Meeting Room in 5"],
  ["jan", "team", "Demo went great today, thanks team!"],
  ["angelo", "team", "Great work everyone 🎉"],
];
async function seedMessages(chat) {
  const have = await call(BON, "GET", `/conversations/${chat.alex}/messages`).catch(() => []);
  if (check || have.length) return;
  const { Puppets } = await import("./puppets.mjs");
  const p = new Puppets(API);
  const who = { bon: "bon", alex: "alex", angelo: "angelo", micah: "micah", jan: "jan" };
  await p.connect(Object.keys(who));
  for (const [from, conv, text] of SCRIPT) { p.send(from, chat[conv], text); await new Promise((r) => setTimeout(r, 400)); }
  await new Promise((r) => setTimeout(r, 800));
  p.close();
  console.log(`chat: sent ${SCRIPT.length} messages`);
}

// ---- Kudos TO Bon, so his Notification Center has real entries (POST /feed/{target}/kudos) ---------
async function seedKudosForBon() {
  const feed = await call(BON, "GET", `/feed/${encodeURIComponent(BON)}`).catch(() => []);
  if (check || feed.some((p) => p.type === "recognition" || p.type === "congratulation" || p.kind === "kudos")) return;
  await call(E.alex, "POST", `/feed/${encodeURIComponent(BON)}/kudos`, { message: "Thanks for the amazing office designs! 🙌" });
  await call(E.jan, "POST", `/feed/${encodeURIComponent(BON)}/kudos`, { message: "Great teamwork on the launch 🚀" });
  console.log("kudos: 2 for Bon");
}

const hub = await seedHub();
const chat = await seedChat();
const board = await seedBoard();
await seedMessages(chat);
await seedKudosForBon().catch((e) => console.log(`kudos: ${e.message}`));
console.log(JSON.stringify({ hub: hub.map((i) => `${i.type}: ${i.title}`), chat, board }, null, 2));

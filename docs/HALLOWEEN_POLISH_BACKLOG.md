# Halloween Office — accepted V1 visual foundation, and what was deliberately left

**Status:** checkpointed as the accepted V1 visual foundation on 2026-09-22. Further polish is
**deliberately paused** so the White Christmas experience can be built on the same seasonal
architecture. Nothing below is a defect report — it is the list of things we chose not to do yet.

**Halloween is creator-only and unpublished.** The company default is the normal 3D Office. Nothing
in this checkpoint changes what any employee sees.

---

## Completed

- **Shared chat styling root cause fixed.** `ToucanAssistantPanel.module.css` imports
  `Chat/ConversationView.module.css` directly, so Toucan, employee DMs, group chat and spatial chat
  are the same classes. The white conversation surfaces were `_panel_`, `_messages_`, `_inputPill_`
  and `_textarea_` at `#fdfcfa` — named from the stylesheet, not guessed. Employee DM **visually
  verified**.
- **Blood moon and night moon visually captured.** Fixing this also fixed a real bug:
  `blendPresetInto` copies `skyGrade` field by field and was silently dropping the `moonColor` and
  `moonScale` fields between the grade and the sky.
- **Contrast audit: 140 → 0** across ten surfaces, with minor transition-related sampling jitter
  (one run reported 6, the next 0, with no code change in between).
- **310 focused tests passed; TypeScript clean.** Lint clean apart from a pre-existing
  `HudIcon.tsx` fast-refresh warning.
- **Office draw calls: V2 2921 / Halloween 2994 (+73)**, held flat across a large decoration-density
  increase by the per-material static bake.
- **Halloween remains creator-only and unpublished.**

## Deferred polish

- Larger layered ceiling cobweb formations (current webs are corner fans and swags).
- Twisted branches and additional haunted silhouettes.
- Scattered leaves and stronger floor treatments.
- Corridor-specific decorations — corridors currently inherit only room-edge props.
- Exterior Halloween transformation.
- A more unsettling daytime atmosphere; day currently reads overcast and neglected rather than eerie.
- Visual review of Quests, Rewards, Team Map, Notifications, Company Hub and the remaining
  interaction states. These audit at zero contrast failures but were not inspected by eye.

## Verification to revisit

- **Manually open and inspect the Toucan Assistant.** The headless summon never opened the panel, so
  it was never seen. It shares every class fixed for the DM window, so it is expected to be correct —
  but that is an inference, not an observation.
- **Check real-device FPS / frame time.** SwiftShader software rendering gives 1–2 fps for both the
  normal and Halloween offices, so the measurements taken here are unusable as a hardware proxy.
- **Recheck seasonal screenshots and interaction safety before publication**, since publishing is
  what first puts this in front of employees.

## Screenshot evidence

Kept in place; no new images were generated for this checkpoint.

- `frontend/.halloween-shots/v5/` — three time-of-day atmospheres × player / wide / hub
  (`{day,sunset,night}-{player,wide,hub}.png`), plus `hud.png`.
- `frontend/.halloween-shots/v6/` — chat and moon verification:
  `dm-final.png` (themed employee DM), `after-chat-click.png` (themed Chats sidebar),
  `moon-sunset.png` (blood moon), `moon-night.png` (night moon), plus the picker and the
  unsuccessful Toucan summon attempts (`toucan.png`, `toucan-open.png`).

> These are working screenshots from the local mock rig, not release assets. If they are not wanted
> in the repository, `frontend/.halloween-shots/` can be gitignored without affecting the feature —
> the only Halloween image the product actually ships is
> `frontend/src/assets/experience/office-halloween.webp`, the gallery card.

## Where the next season plugs in

White Christmas needs no new architecture. Two changes make a season real:

1. **Backend** — add its identifier to `IMPLEMENTED_EXPERIENCES` in
   `backend/app/models/office_experience.py`. No migration, no new table, no new endpoint.
2. **Frontend** — a decoration layer under `frontend/src/dev/vo3d/season/`, a grade table, and an
   entry in `SEASONAL_PRESENTATION` in `components/OfficeMap/officeExperienceGallery.ts` with a real
   capture of the decorated office.

The pieces Halloween established and Christmas inherits: `SeasonLayer` (attach / dispose /
per-frame), the derived placement rules, the per-material static bake and glow instancing, the
`EnvOverlay` composition seam in `env/Environment.ts`, the `moonColor` / `moonScale` sky fields, the
`data-vo-experience` UI skin scope, the seasonal HUD-icon variant map in `components/HudIcon.tsx`,
and the synthesized seasonal audio seam in `dev/vo3d/audio/`.

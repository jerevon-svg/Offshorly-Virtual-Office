# White Christmas Office — V1 foundation, and what was deliberately left

**Status:** V1 implemented and visually verified on 2026-09-22, **uncommitted**. Built on the seasonal
architecture Halloween established; no new seasonal system, no new settings category, no new backend
endpoint, no migration.

**White Christmas is creator-only and unpublished.** The company default is still the normal 3D
Office. Halloween's publication state is unchanged. Nothing in this checkpoint changes what any
employee sees.

---

## The blocking defect found during this pass, and its root cause

**Symptom.** The entire 3D office rendered as a flat near-white sheet in the Christmas experience.
Nameplates and the HUD stayed visible; the office geometry, furniture, avatars and every Christmas
decoration were invisible. The normal 3D Office was unaffected.

**Root cause — a CSS rule, not the renderer.** `styles/christmasTheme.css` listed
`[data-testid="vo3d-overheads"]` among the selectors it gives a panel background to. That test id is
not a panel: it is the full-screen `position: fixed`, `pointer-events: none`, z-index 19 DOM layer
that carries nameplates *over* the world (`dev/vo3d/app/Vo3dOverheads.tsx`). Painting it opaque laid
a frosted white sheet across the whole viewport. The HUD and nameplates survived because they sit
inside and above that layer. The selector was copied across from the Halloween skin, where that test
id appears only in a `color:` rule.

**Why it looked like a rendering fault and was not one.** Everything in the renderer checked out:

| Check | Result |
| --- | --- |
| `gl.readPixels` on the live context | a complete, correctly lit office, every frame |
| Canvas count / is it the live one / context lost | 1 canvas, in the document, `isContextLost() === false` |
| Framebuffer alpha | 255 everywhere, in both worlds |
| Light params reaching the renderer | Christmas **at or below** v2's key, ambient, env and exposure |
| Fog in OFFICE presentation | `scene.fog === null` in both worlds (office presentation disables it) |
| Render calls per frame | ~2970, final pass to the default framebuffer, stable across frames |
| Forcing v2's exact light params at runtime | no change — so not the grade |
| Hiding the season root and the precipitation field | no change — so not the decoration |

`document.elementsFromPoint` did **not** find it either: that API skips `pointer-events: none`
elements, so it reported the canvas as the topmost thing. What found it was enumerating every element
covering most of the viewport that had any background at all — one hit in Christmas, none in v2.

**Fix.** Removed that one selector from the background rule. The file now carries the rule it
violated: *a selector may only be given a background if it names a surface the product actually
draws; a layer, stage or stack that exists to position things over the world is never a surface,
however panel-like its test id looks.*

**Evidence.**

- Before: `frontend/.christmas-shots/fix/before-christmas-white-screen.png`
- The same frame's real framebuffer, proving the scene was fine:
  `frontend/.christmas-shots/fix/before-readpixels-proves-scene-rendered.png`
- After: `frontend/.christmas-shots/fix/after-christmas.png` (and `after-v2.png`, same session, same
  camera, for comparison)

A second, unrelated trap cost time and is recorded so it is not re-learned: **Chrome's headless
`page.screenshot` returns a stale surface for this app's GPU canvas.** Both `fromSurface: false` and
`--run-all-compositor-stages-before-draw` fail outright on this Chrome. World captures were therefore
taken by reading the framebuffer with `gl.readPixels` and writing the PNG directly; the final
verification set was re-taken in a **headed** browser, where `page.screenshot` works.

---

## Completed

### Environment
- **Decoration layer** under `frontend/src/dev/vo3d/season/christmas/` — materials, procedural
  builders, per-room placement tables and the environment grade. Attached by the existing
  `createSeasonLayer` seam; `dispose()` removes every group, geometry and material it made.
- **Every room decorated**, with a per-room character (`grove` / `crystal` / `hearth` / `boutique` /
  `drift`) so no two rooms at the same density look alike. Hero compositions in Reception and the
  Central Hub.
- **Corridors are decorated** — the top item on Halloween's deferred list. The hall is not a room, so
  its anchors are *derived*: a ring of points just outside each room rect, kept only where they are
  outside every other room, inside the frame and clear of every doorway. That is the hall's own wall
  line, which is the one band of a corridor nobody walks down.
- **Exterior**: a stand of snow-covered trees and drifts along the far edge of the entrance sidewalk —
  the only exterior the product camera shows.
- **The frost sheen** (`frostCarpet`) — one quad over the whole floor plate, low opacity, no depth
  write. The single highest-value object in the season: at the office camera the building is mostly
  floor, and a floor left warm cream keeps the frame reading as the ordinary office whatever is
  standing on it.
- **Day / sunset / night** all graded, composed through the existing `EnvOverlay` seam.
  `season/christmas/grade.test.ts` walks the whole table through the real `overlay()` +
  `blendPresetInto()` path and asserts every configured value arrives — the Halloween `moonColor` /
  `moonScale` bug class, tested rather than hoped for. Christmas exercises both of those fields.
- **AUTO is not overridden.** Halloween forces dusk; Christmas does not, because all three phases are
  graded to be beautiful. The real clock keeps deciding, and a manual time or weather choice is
  untouched.
- **Snowfall reuses the existing precipitation field** (`env/Rain.ts` gains a snow mode: two uniforms
  switching motion and shape). No second particle system. **Snow is outdoors-only by construction** —
  the field is placed as (camera box − office footprint) decomposed into four strips, so a flake
  cannot exist over the building at any angle or zoom. The particle budget, the office-presentation
  gate and the weather fade all apply unchanged.

### UI
- `styles/christmasTheme.css`, scoped entirely to `html[data-vo-experience="christmas"]`.
- **No blanket `color:` rule.** The product is already a light, dark-ink design and so is this season,
  so the theme is a re-tint rather than an inversion. Ink is only ever stated on a selector this file
  also gives a background to, which is what keeps the product's genuinely dark surfaces safe by
  construction. Halloween needed three `!important` correctives for its broad inversion; this needed
  none.
- Covered: dock, Check Out, Toucan button, panels, cards, flyouts, modals, tabs, nav, inputs, focus,
  hover/active/disabled, tooltips, empty states, scrollbars, avatar frames, Company Hub illustrations,
  the reminder card, and the whole chat family.
- **Chat interiors match their frames.** `ToucanAssistantPanel.module.css` imports
  `Chat/ConversationView.module.css`, so Toucan, employee DMs, group chat and spatial chat are the
  same classes — `_panel_`, `_messages_`, `_inputPill_`, `_textarea_`, read from the stylesheet rather
  than guessed. Verified by eye on the Toucan Assistant and an employee DM.
- Status colours, notification badges, earned badges and employee photos are explicitly exempt.

### Catalog, gallery and Creator Studio
- Backend: `christmas` added to `IMPLEMENTED_EXPERIENCES` — the whole backend change. No migration, no
  new table, no new endpoint.
- Gallery entry with a **real capture** of the implemented office
  (`src/assets/experience/office-christmas.webp`, shot through the app's own camera, daylight, HUD
  off). No generated art.
- Creator Studio lists **White Christmas Office — Ready — only you can see it** with a Publish button,
  alongside Halloween. Both unpublished; company default still 3D Office. **Nothing was published and
  the default was not changed.**

---

## Verification

### Screenshots (all inspected, not merely captured)

**Environment — `frontend/.christmas-shots/fix/`** (headed browser, real M1 GPU, HUD included):
`{day,sunset,night}-{hub,reception,workspace,exterior,wide}.png`, plus `after-christmas.png`,
`after-v2.png` and the two before/root-cause frames listed above.

**Environment — `frontend/.christmas-shots/v1/`** (framebuffer readback, HUD off, per-room):
`{day,sunset,night}-{default,reception-room,central-hub,gaming-room,design-room,dev-room,exterior,wide}.png`.

**UI — `frontend/.christmas-shots/ui/`**: `00-hud`, `10-{hub,tasks,rewards,map,notifications,search,room,boards}`,
`20/22/23/24-settings*`, `27b-gallery-christmas-card`, `27-gallery-christmas-card` (Creator Studio),
`30/34-chat-sidebar`, `32/35-dm-window`, `36-dm-interior`, `42/43-toucan-*`, `44-toucan-composer`,
`50-hover-checkout`.

These are working screenshots from the local mock rig, not release assets. The only Christmas image
the product actually ships is the gallery card.

### Checks

- **Contrast audit** (measured, not eyeballed: every visible text node, real background resolution,
  real WCAG ratio, across eleven surfaces): **Christmas 8 below AA, normal 3D Office 12**. All eight
  remaining are the *same* pre-existing product issue that fails identically in the normal office — a
  white ✓ glyph on the product's own success green, on a surface this theme does not paint. Two
  defects the audit caught in this theme were fixed at cause: the disabled-button ink (4.09 → ~4.9)
  and the Company Hub card eyebrow (2.53 → ~4.9).
- **Tests:** 277 passed across the 18 directly-relevant frontend files (season, env, weather,
  graphics, settings, office catalog, gallery, experience panel, Creator Studio, experience cards);
  23 passed in `backend/tests/test_office_experience.py`.
- **One pre-existing failure, not caused by this work:** `src/App.v2route.test.tsx` ("which office a
  URL opens"). It fails on pristine `HEAD` too — confirmed by running the identical command in a
  clean `git worktree` at 121dbd5. That whole vo3d suite is **order-dependent in large parallel
  batches**: the pristine baseline failed 20 tests in the big run, this branch failed 16 and then 50
  across two runs of the same unchanged code, with a different set each time. Individually and in
  small groups the same files pass. Treat big-batch runs of `src/dev/vo3d` as unreliable until that
  shared-state problem is fixed; it is not a Christmas defect and was not addressed here.
- **TypeScript:** clean (`tsconfig.app.json`, the real gate).
- **Lint:** `oxlint` clean on every changed file. The repo-wide script also reports pre-existing
  warnings in vendored `public/vendor/draco`.

### Performance — measured, same camera, same phase, real GPU

`ANGLE (Apple, ANGLE Metal Renderer: Apple M1)`, whole ground floor framed identically, night, 3s
sample:

| | fps | draw calls | triangles |
| --- | --- | --- | --- |
| Normal 3D Office | 37.7 | 2921 | 2,577,634 |
| White Christmas | 35.5 | 2974 (+53) | 3,061,358 (+484k) |

~6% frame cost for the whole season, and **+53 draw calls** for every tree, lantern, garland, gift,
icicle, crystal and drift in the building — held down by the per-material static bake and the glow
instancing Halloween established. No avatar texture, LOD or render density was lowered.

Unlike the Halloween checkpoint, these numbers are **not** SwiftShader: this pass ran on the real M1
through system Chrome, so the frame times are usable. Absolute fps still drifts between runs with
machine load; compare within a run.

---

## Remaining cosmetic polish

- **Garland swags** read as translucent bands from the office camera rather than as foliage. Density
  was already reduced once (8 → 5 in hero rooms) after they rendered as parallel stripes. A thicker
  drop or a denser sprig texture would help.
- **Icicle runs** are barely legible from the office camera — they read well only at room zoom.
- **Wreaths** are placed on wall faces and are mostly edge-on from above; they are close to invisible
  at the product framing.
- **No seasonal HUD icons.** Halloween ships eleven re-rendered icons; Christmas does not, because
  generating artwork was out of scope. The existing icons sit correctly on the frosted dock, but a
  matching icon set is the obvious next visual step.
- **No seasonal audio.** The `envAudio.setSeasonAmbience` seam exists and Halloween uses it; a
  synthesised winter bed was out of scope for V1.
- **Exterior beyond the entrance sidewalk** is untouched — the campus in EXPLORE presentation is not
  snow-covered, only tinted. The product camera never shows it.
- **Room-by-room density review.** The per-room tables were tuned from whole-floor and hero-room
  captures; the departmental rooms were checked at floor scale rather than individually.

## Verification still to do

- **An employee DM with real message history.** The rig's conversations are empty, and no message was
  sent because that would write to the mock database. The DM *window* (header, column, composer, send)
  was verified, and the Toucan Assistant — which shares every one of those classes — was verified with
  a real message bubble in it. The bubble styling for a long two-sided conversation is therefore an
  inference, not an observation.
- **Group chat and spatial chat** specifically. Same classes as the two surfaces verified above, but
  not opened by eye.
- **A second pass over Quests/Missions and Team Map by eye.** Both audit at zero contrast failures and
  were captured, but were reviewed at panel level rather than control by control.
- **Re-check interaction safety before publication**, since publishing is what first puts this in
  front of employees. Decorations are nav-inert by construction (`nav/solids.ts` never reads a THREE
  object) and the layer's own test asserts the hanging band stays clear of head height and the wall
  head — but a live walk-through has not been done.

## Blockers to publication

None functional. Publication is a deliberate decision, not a missing piece: the identifier is
implemented, the card is real, and the Creator Studio's Publish button works through the existing
server-enforced flow whenever Bon chooses to use it.

---

## Where a future season plugs in

Unchanged from Halloween's note, and now proven twice:

1. **Backend** — add the identifier to `IMPLEMENTED_EXPERIENCES` in
   `backend/app/models/office_experience.py`.
2. **Frontend** — a decoration layer under `dev/vo3d/season/<name>/`, a grade table, an entry in
   `SEASONAL_PRESENTATION`, and a real capture.

Christmas additionally generalised three things the next season inherits: `collapseGlows` and
`bakeStatics` now take the caller's own materials and name prefix, `SeasonLayerDeps` carries the frame
and sidewalk rects for exterior passes, and `env/Environment.snowfall` lets a season drive the
existing precipitation field without adding a particle system.

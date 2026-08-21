import { useEffect, useRef, useState } from "react";
import {
  ASSET_PATH_TO_SRC,
  FRAME_HEIGHT,
  FRAME_WIDTH,
  formatCharacterName,
  officeAssetLayers,
} from "../../data/office-layout";
import type { AssetLayer } from "../../types/office";
import type { Phase } from "../../data/officePhase";
import type { SeatTarget } from "../../data/emptySeats";
import { DOOR_ANIM_MS, DOOR_SLIDE_DIRECTION } from "../../data/officeDoors";
import { backrestCropLayerId } from "../../data/backSitOccupancy";
import { getBackrestCropFraction } from "../../data/chairBackrestCrop";
import { createDepthCompare } from "./depthSort";
import { GreetingBubble } from "./GreetingBubble";
import { TalkingBubble } from "./TalkingBubble";
import { OfficePhaseOverlay } from "./OfficePhaseOverlay";
import { CharacterCanvas, directionToHeadingDegrees } from "../../render3d/CharacterCanvas";
import {
  LIVE_3D_CHARACTERS,
  resolveLive3dGlbUrl,
  type Live3dAssetSet,
} from "../../render3d/live3dCharacters";
import { avatarIdForEmail } from "../../data/avatarIdentity";
import type { WalkDirection } from "../../data/bonWalkFrames";
import {
  collectDeviceSignals,
  computeDeviceTier,
  detectDeviceTier,
  hasWorkingWebGl,
  isMobileLike,
  isSoftwareRendererSignal,
  type DeviceCapabilitySignals,
  type DeviceTier,
} from "../../services/render/deviceTier";
import { getSharedDeviceTierMicrobench } from "../../services/render/deviceTierBenchmark";
import { LIVE_3D_CAP_BY_TIER, LIVE_3D_SELF_MIN_TIER } from "../../services/render/tierBudgets";
import styles from "./OfficeStage.module.css";

// ---------------------------------------------------------------------------
// Live-3D gating.
//
// Two independent gates decide whether a given character layer shows its
// CharacterCanvas (live-3D) instead of its normal sprite <img>:
//
//  1. ELIGIBILITY (live3dCharacters.ts's LIVE_3D_CHARACTERS) — does this
//     avatar id have an approved, shipped GLB asset set at all? Bon is the
//     only real entry today; adding employee #2 is a registry-only change.
//  2. PERMISSION (computeLive3dGating below) — does the CURRENT VIEWER's
//     device/role allow showing it right now? This is where device tier
//     (deviceTier.ts) and the self vs. crowd budget split
//     (tierBudgets.ts) come in:
//       - T0 (mobile/weak hardware): never, no exceptions, self included —
//         a hard safety floor.
//       - The viewer's OWN character ("self", see selfCharacterId prop):
//         shown starting at LIVE_3D_SELF_MIN_TIER (T1+), independent of the
//         crowd cap below.
//       - Every other character: shown only within LIVE_3D_CAP_BY_TIER's
//         per-tier crowd budget (currently 0 below T2) — self consumption
//         does NOT count against this budget.
//
// A separate, dev-only `?live3d=` URL override (see
// getLive3dEnabledAvatarIds below) bypasses gate 2 entirely for manual
// testing of characters that aren't (yet) eligible, e.g. Alex — but even
// the override still requires *some* asset set to show (falls back to
// DEV_ONLY_LIVE_3D_ENTRIES when the character has no real registry entry).
// ---------------------------------------------------------------------------

// Assets for characters NOT (yet) eligible for production — kept around
// purely so the dev-only `?live3d=` override above can still preview them.
// Never consulted by the tier/budget gating path, only by the override.
const DEV_ONLY_LIVE_3D_ENTRIES: Record<string, Live3dAssetSet> = {
  // Manifest aspect ratio: width 20 / height 34.46.
  alex: {
    glbUrl: `${import.meta.env.BASE_URL}scripts/avatar-pipeline/output/meshy-test/rig/alex-basic-walking_glb_url.glb`,
    renderWidth: 160,
    renderHeight: 276,
  },
};

const DEVICE_TIER_VALUES: DeviceTier[] = ["T0", "T1", "T2"];

// LOCAL DEV TESTING escape hatch ONLY — same rationale/pattern as the
// `?live3d=` override above and `?as=` in useAuthGate.ts: lets a developer
// force the CURRENT session's device tier via `?deviceTier=T1` (or T0/T2)
// when their own machine/browser under-reports real capability signals
// (e.g. a test rig reporting hardwareConcurrency=2 while showing no
// perceptible lag). This does NOT touch computeDeviceTier's actual
// threshold rules (cores<4, memory<4, software-renderer list, etc.) — those
// stay exactly as-is for every real user with no override param. Gated on
// import.meta.env.DEV so `vite build` drops this as dead code and it can
// never affect production traffic.
function getDeviceTierOverride(): DeviceTier | null {
  if (!import.meta.env.DEV || typeof window === "undefined") return null;
  const raw = new URLSearchParams(window.location.search).get("deviceTier");
  if (!raw) return null;
  const upper = raw.trim().toUpperCase();
  return DEVICE_TIER_VALUES.includes(upper as DeviceTier) ? (upper as DeviceTier) : null;
}

// detectDeviceTier() does real WebGL probing (creates a canvas + GL
// context) — must run exactly ONCE per session, not per-character or
// per-render. Module-level lazy singleton, matching the precedent set by
// SharedRenderer.ts's shared WebGLRenderer and glbCache.ts's shared GLTF
// cache (both singletons for the same "expensive shared resource" reason).
let cachedDeviceTier: DeviceTier | null = null;
function getDeviceTierOnce(): DeviceTier {
  if (cachedDeviceTier === null) {
    cachedDeviceTier = getDeviceTierOverride() ?? detectDeviceTier();
  }
  return cachedDeviceTier;
}

// collectDeviceSignals() does the same real WebGL probing as
// detectDeviceTier() above — cached the same way, and separately from the
// tier itself, because the RENDERING layer (the JSX below) needs the raw
// signals to distinguish two different "T0" buckets that detectDeviceTier's
// return value alone can't tell apart: (a) mobile / no WebGL context at
// all — sprite-only, no 3D is even possible — vs (b) working WebGL but
// confirmed too weak (software renderer, or a weak-static device that
// failed/never ran its microbench rescue) — gets a STATIC single 3D frame
// instead. See deviceTier.ts's isMobileLike/hasWorkingWebGl/
// isSoftwareRendererSignal exports and this file's isStaticFrameBucket
// below.
let cachedDeviceSignals: DeviceCapabilitySignals | null = null;
function getDeviceSignalsOnce(): DeviceCapabilitySignals {
  if (cachedDeviceSignals === null) {
    cachedDeviceSignals = collectDeviceSignals();
  }
  return cachedDeviceSignals;
}

// True only for a weak-static (low core count, or low RAM when readable)
// device that's still eligible for the microbench rescue: has working
// WebGL, isn't mobile, and isn't a known software renderer (software
// renderers are an unconditional hard-fail per D-E — a tiny benchmark
// scene can pass deceptively on a software GL context even though the real
// character scene would choke).
function isRescueEligible(signals: DeviceCapabilitySignals): boolean {
  return !isMobileLike(signals) && hasWorkingWebGl(signals) && !isSoftwareRendererSignal(signals);
}

// True for the D-D "confirmed weak but has working WebGL" bucket — software
// renderer, or a weak-static device that failed (or hasn't yet completed)
// its microbench rescue. Distinct from the true sprite-only floor (mobile /
// no WebGL at all, D-C) — both can resolve `tier` to "T0", but only this
// bucket gets a static (non-animated) 3D frame instead of the 2D sprite.
function isStaticFrameBucket(tier: DeviceTier, signals: DeviceCapabilitySignals): boolean {
  if (tier !== "T0") return false;
  if (isMobileLike(signals)) return false;
  return hasWorkingWebGl(signals);
}

// Module-level, session-shared microbench-rescue state — the microbench
// itself (see deviceTierBenchmark.ts's getSharedDeviceTierMicrobench) must
// run at most ONCE per page load, with every currently- or later-mounted
// character/OfficeStage instance sharing the same result, rather than each
// independently kicking off its own run.
let rescueStarted = false;
let rescueResolvedTier: DeviceTier | null = null;
let rescueSubscribers: Array<(tier: DeviceTier) => void> = [];

function startRescueOnce(signals: DeviceCapabilitySignals): void {
  if (rescueStarted) return;
  rescueStarted = true;
  void getSharedDeviceTierMicrobench()
    .then((result) => computeDeviceTier({ ...signals, microbenchMs: result.medianFrameMs }))
    .catch(() => "T0" as DeviceTier)
    .then((tier) => {
      rescueResolvedTier = tier;
      const subs = rescueSubscribers;
      rescueSubscribers = [];
      subs.forEach((notify) => notify(tier));
    });
}

// Test-only escape hatch (mirrors SharedRenderer's/glbCache's own
// __reset*ForTests) — lets tests force a fresh detectDeviceTier() call
// after mocking it to a different return value, instead of being stuck
// with whatever the first test in the file happened to trigger. Also
// resets the signals cache and the microbench-rescue singleton above, for
// the same reason.
export function __resetDeviceTierCacheForTests(): void {
  cachedDeviceTier = null;
  cachedDeviceSignals = null;
  rescueStarted = false;
  rescueResolvedTier = null;
  rescueSubscribers = [];
}

/**
 * Progressive device-tier hook. Seeds synchronously from the same
 * getDeviceTierOnce() singleton as before (identical first-paint behavior,
 * `?deviceTier=` dev override precedence unchanged), then — only for a
 * weak-static-but-rescue-eligible T0 device — kicks off the session-shared
 * microbench and re-renders with the (possibly-rescued) final tier once it
 * resolves. This is the source of the accepted ~1-2s benchmark-induced
 * stutter + visible pop-in swap tradeoffs (see the approved plan's D-B).
 */
function useDeviceTier(): DeviceTier {
  const [tier, setTier] = useState<DeviceTier>(() => getDeviceTierOnce());

  useEffect(() => {
    // The dev override always wins and is never rescued — it's an explicit
    // manual choice, not a signal to second-guess.
    if (getDeviceTierOverride()) return;
    if (rescueResolvedTier !== null) {
      if (tier !== rescueResolvedTier) setTier(rescueResolvedTier);
      return;
    }
    if (tier !== "T0") return;
    const signals = getDeviceSignalsOnce();
    if (!isRescueEligible(signals)) return;
    rescueSubscribers.push(setTier);
    startRescueOnce(signals);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return tier;
}

const TIER_ORDER: DeviceTier[] = ["T0", "T1", "T2"];
function tierAtLeast(tier: DeviceTier, min: DeviceTier): boolean {
  return TIER_ORDER.indexOf(tier) >= TIER_ORDER.indexOf(min);
}

// avatarIdForEmail (data/avatarIdentity.ts) resolves a character layer id
// to its avatar id, used below to look up LIVE_3D_CHARACTERS. Handles both
// id shapes: the static office-assets-manifest roster keys characters
// directly ("alex", "bon"), but a real/mock office-integration roster (see
// OfficeMap.tsx's officePeopleToLayers) instead keys every person's layer
// on their email ("alex@offshorly.com") — an id with no "@" is treated as
// its own localpart, so "alex" resolves to "alex" the same way
// "alex@offshorly.com" does.

// Reads the `live3d` query param (comma-separated list of avatar ids, e.g.
// `?live3d=alex,bon`) into a Set, or an empty Set when disabled/not in dev.
function getLive3dEnabledAvatarIds(): Set<string> {
  if (!import.meta.env.DEV || typeof window === "undefined") {
    return new Set();
  }
  const raw = new URLSearchParams(window.location.search).get("live3d");
  if (!raw) return new Set();
  return new Set(
    raw
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean),
  );
}

type CharacterOverrides = Record<string, { x: number; y: number }>;

type OfficeStageProps = {
  // Day/night tint — defaults to "day" (near-neutral) so existing callers
  // that don't pass it (e.g. tests) render unaffected.
  phase?: Phase;
  characterOverrides?: CharacterOverrides;
  characterSrcOverrides?: Record<string, string>;
  // Character ids to omit entirely from render (e.g. bon once CHECKED_OUT).
  hiddenCharacterIds?: string[];
  // Additional static-portrait character layers to render alongside the
  // manifest's fixed roster — used for avatars saved via AvatarCreator and
  // positioned in their chosen team room. Each entry's `src` comes from
  // `extraCharacterSrcById` (a data URL / mock preview import), not
  // ASSET_PATH_TO_SRC, since these aren't part of the static asset manifest.
  extraCharacterLayers?: AssetLayer[];
  extraCharacterSrcById?: Record<string, string>;
  onCharacterClick?: (layer: AssetLayer, anchor: { clientX: number; clientY: number }) => void;
  onRoomClick?: (layer: AssetLayer, anchor: { clientX: number; clientY: number }) => void;
  greetingCharacterId?: string | null;
  greetingNonce?: number;
  // Custom greeting text (e.g. onboarding's "Welcome to Offshorly!" instead
  // of the search-locate default "Hi there, I'm {name}!").
  greetingText?: string;
  // Character ids to render a looping "talking" indicator above — fully
  // separate from the greeting system (used by the chat feature).
  talkingCharacterIds?: string[];
  // Text to show inside the talking bubble for a given character id, when
  // that character has recently sent a chat message (falls back to the
  // looping dots when absent).
  talkingTextById?: Record<string, string>;
  // Phase A live-3D "responder" signal, keyed by character LAYER id (not
  // chat senderId/email like talkingTextById above) — recently sent a
  // message within the bubble-display window (see
  // characterAnimationState.ts's isResponder doc comment). OfficeMap.tsx
  // builds this separately from talkingTextById because talkingTextById is
  // keyed by chat senderId, which for peer roster layers happens to equal
  // layer.id (rosterLayers.ts keys id on person.email) but for the self
  // layer is the viewer's OWN chat id (selfChatId, an email), never
  // playerLayerId/currentUserId (an avatar id like "bon") — looking self up
  // directly in talkingTextById by layer.id therefore always misses.
  // Absent entries default to false, matching every existing caller/test
  // that doesn't pass this.
  characterIsResponderById?: Record<string, boolean>;
  // Door art layer ids currently slid open (see officeDoors.ts). Layers not
  // present here render at rest (translateX(0)/no override) — omitting the
  // prop entirely means "no doors open," matching existing callers/tests
  // that don't pass it.
  openDoorLayerIds?: Set<string>;
  // Empty (unoccupied) painted seats to render as clickable "sit here"
  // markers — occupied seats get no marker at all (see emptySeats.ts).
  // Deliberately not passed to the PiP mini-camera OfficeStage instance
  // (OfficeMap.tsx only wires this on the main instance).
  emptySeats?: SeatTarget[];
  onSeatClick?: (seat: SeatTarget, anchor: { clientX: number; clientY: number }) => void;
  // Synthetic backrest-crop layer id (`${furnitureId}-backrest-crop`, see
  // backSitOccupancy.ts's backrestCropLayerId) -> that seat's back-facing
  // occupant's own sprite baseline (position.y + height), for every
  // currently back-sit occupant (see OfficeMap.tsx's
  // computeBackSitOccupantBaselines). OfficeStage generates a synthetic,
  // clip-path-cropped "backrest only" clone of any furniture layer whose id
  // has an entry here (once suffixed) and lets depthSort force THAT clone
  // (not the original chair layer) to render in front of its occupant —
  // see depthSort.ts's sortKey doc comment and chairBackrestCrop.ts for the
  // full reasoning. Omitted/undefined = existing always-behind behavior for
  // every seat, unchanged (matches every existing caller/test that doesn't
  // pass this prop).
  backSitOccupantBaselines?: Record<string, number>;
  // Phase C live-3D dev-toggle only (see LIVE_3D_ENTRIES above) — the same
  // per-character facing direction/walking state already computed for the
  // sprite path (useCharacterWalk's `direction`/`isWalking`), keyed by
  // layer id exactly like characterOverrides/characterSrcOverrides above.
  // Absent entries default to facing "front" and animating, matching every
  // existing caller/test that doesn't pass these (no live-3D layer present
  // there anyway).
  characterDirectionsById?: Record<string, WalkDirection>;
  characterIsWalkingById?: Record<string, boolean>;
  // Phase A live-3D animation-state input: which character layer ids are
  // currently seated in a real (painted-chair) seat — see OfficeMap.tsx's
  // isSitting. Absent entries default to false (standing), matching every
  // existing caller/test that doesn't pass this. The seat's own facing
  // direction is expected to already be reflected in
  // characterDirectionsById above (see data/seatDirections.ts) — never
  // derived here from the camera.
  characterIsSittingById?: Record<string, boolean>;
  // The character layer id that IS the current viewer's own avatar (see
  // OfficeMap.tsx's playerLayerId — the existing "which sprite is you"
  // mechanism, reused here rather than inventing a second identity
  // concept). Drives the live-3D self-vs-crowd gating split above:
  // undefined/omitted (e.g. tests) means "no
  // character here is the viewer," so every character falls through to the
  // crowd-budget path — matching every existing caller/test that doesn't
  // pass this prop.
  selfCharacterId?: string | null;
};

// Shared click-vs-drag threshold logic: only fires onClick when pointer
// movement between down/up stays under 6px (otherwise treated as a drag/pan).
// Generic over the clicked item so it can drive both character/room layer
// clicks (AssetLayer) and empty-seat marker clicks (SeatTarget).
function useClickVsDrag<T>(
  onClick: ((item: T, anchor: { clientX: number; clientY: number }) => void) | undefined,
) {
  const downRef = useRef<{ x: number; y: number } | null>(null);
  return {
    onPointerDown: (e: React.PointerEvent) => {
      downRef.current = { x: e.clientX, y: e.clientY };
    },
    onPointerUp: (item: T, e: React.PointerEvent) => {
      const d = downRef.current;
      if (d) {
        const dist = Math.hypot(e.clientX - d.x, e.clientY - d.y);
        if (dist < 6) {
          e.stopPropagation();
          onClick?.(item, { clientX: e.clientX, clientY: e.clientY });
        }
      }
      downRef.current = null;
    },
  };
}

export function OfficeStage({
  phase = "day",
  characterOverrides,
  characterSrcOverrides,
  hiddenCharacterIds,
  onCharacterClick,
  onRoomClick,
  greetingCharacterId,
  greetingNonce,
  greetingText,
  extraCharacterLayers,
  extraCharacterSrcById,
  talkingCharacterIds,
  talkingTextById,
  characterIsResponderById,
  openDoorLayerIds,
  emptySeats,
  onSeatClick,
  backSitOccupantBaselines,
  characterDirectionsById,
  characterIsWalkingById,
  characterIsSittingById,
  selfCharacterId,
}: OfficeStageProps = {}) {
  const characterClick = useClickVsDrag<AssetLayer>(onCharacterClick);
  const roomClick = useClickVsDrag<AssetLayer>(onRoomClick);
  const seatClick = useClickVsDrag<SeatTarget>(onSeatClick);
  const live3dEnabledAvatarIds = getLive3dEnabledAvatarIds();
  const deviceTier = useDeviceTier();
  // D-D bucket (see isStaticFrameBucket's doc comment above): confirmed
  // weak but has working WebGL — software renderer, or a weak-static
  // device that failed/never ran its microbench rescue. Distinct from the
  // true sprite-only floor (mobile / no WebGL at all).
  const isStaticFrame = isStaticFrameBucket(deviceTier, getDeviceSignalsOnce());
  // Layer ids whose live-3D model failed to load (GLB fetch/parse error,
  // or a mid-session WebGL context loss) — see CharacterCanvas's onError
  // prop below. Once a layer id lands here it renders the normal sprite
  // for the rest of this mount, even if it's otherwise eligible/permitted.
  const [erroredLive3dIds, setErroredLive3dIds] = useState<Set<string>>(new Set());
  const reportLive3dError = (layerId: string) => {
    setErroredLive3dIds((prev) => (prev.has(layerId) ? prev : new Set(prev).add(layerId)));
  };
  // Crowd budget consumed so far THIS render pass — a plain local counter
  // (not state) is correct here since the sorted.map() below runs
  // synchronously, top to bottom, exactly once per render; self-avatar
  // consumption is intentionally never added to this (see
  // LIVE_3D_SELF_MIN_TIER's doc comment in tierBudgets.ts).
  let crowdBudgetUsed = 0;
  const crowdBudgetCap = LIVE_3D_CAP_BY_TIER[deviceTier];

  // Resolve live character positions (e.g. bon's walking override) BEFORE
  // sorting, so depth ordering reflects true current feet-Y each render.
  const resolved = officeAssetLayers
    .filter((l) => !(l.kind === "character" && hiddenCharacterIds?.includes(l.id)))
    .concat(extraCharacterLayers ?? [])
    .map((l) => {
      const ov = l.kind === "character" ? characterOverrides?.[l.id] : undefined;
      return ov ? { ...l, x: ov.x, y: ov.y } : l;
    });
  // Synthetic backrest-crop layers: for every furniture layer currently
  // back-sit-occupied (its id, once suffixed, is a key in
  // backSitOccupantBaselines — see backSitOccupancy.ts/OfficeMap.tsx), clone
  // it into a new layer sharing the same path/position/size/imgCrop (so it
  // renders identically, and still qualifies for depthSort's isSeat() path-
  // match), but flagged with frontClipBottomPct so only its top "backrest"
  // portion is visible (clip-path applied below at render time). The clone's
  // id gets the -backrest-crop suffix, which is exactly what
  // backSitOccupantBaselines is keyed by, so ONLY this synthetic layer (never
  // the original chair layer, whose id has no such suffix) picks up the
  // front-of-occupant sort-key override in depthSort.ts. Not generated for
  // any other seat (unoccupied, or occupied but facing front/left/right) —
  // gated purely on presence in the map, which backSitOccupancy.ts already
  // restricts to real back-sit occupants.
  const backrestCropLayers: AssetLayer[] = [];
  if (backSitOccupantBaselines) {
    for (const layer of resolved) {
      if (layer.kind !== "furniture") continue;
      const cropId = backrestCropLayerId(layer.id);
      if (backSitOccupantBaselines[cropId] === undefined) continue;
      backrestCropLayers.push({
        ...layer,
        id: cropId,
        frontClipBottomPct: getBackrestCropFraction(layer.path),
      });
    }
  }
  const withBackrestCrops = backrestCropLayers.length
    ? resolved.concat(backrestCropLayers)
    : resolved;
  const sorted = withBackrestCrops.slice().sort(createDepthCompare(backSitOccupantBaselines));

  const resolvedGreetedLayer = greetingCharacterId
    ? resolved.find((l) => l.id === greetingCharacterId)
    : undefined;

  return (
    <div
      className={styles.stage}
      style={{
        width: FRAME_WIDTH,
        aspectRatio: `${FRAME_WIDTH} / ${FRAME_HEIGHT}`,
      }}
    >
      {sorted.map((layer) => {
        const isChar = layer.kind === "character";
        const srcOverride = isChar
          ? (characterSrcOverrides?.[layer.id] ?? extraCharacterSrcById?.[layer.id])
          : undefined;
        const src = srcOverride ?? ASSET_PATH_TO_SRC[layer.path];

        if (layer.kind === "floor") {
          return (
            <div key={layer.id} className={styles.floor}>
              <img src={src} alt="" />
            </div>
          );
        }

        const isClickable = isChar && layer.id !== "bon";
        const isRoomClickable = layer.kind === "room";
        const live3dAvatarId = isChar ? avatarIdForEmail(layer.id) : null;
        const hasErroredLive3d = erroredLive3dIds.has(layer.id);
        const registryEntry = live3dAvatarId ? LIVE_3D_CHARACTERS[live3dAvatarId] : undefined;
        // Dev-only URL override: bypasses the tier/budget gating below
        // entirely, falling back to DEV_ONLY_LIVE_3D_ENTRIES for a
        // not-yet-eligible character (e.g. Alex) so it can still be
        // previewed manually. Already dead-code-eliminated from
        // production builds via getLive3dEnabledAvatarIds' import.meta.env
        // .DEV check.
        const devOverrideEntry =
          live3dAvatarId && live3dEnabledAvatarIds.has(live3dAvatarId)
            ? registryEntry ?? DEV_ONLY_LIVE_3D_ENTRIES[live3dAvatarId]
            : undefined;
        const isSelf = !!selfCharacterId && layer.id === selfCharacterId;
        let live3dEntry: Live3dAssetSet | undefined;
        // Whether the CharacterCanvas below should run its normal animated
        // render loop (true, the default) or the D-D "static single frame"
        // mode (false) — see CharacterCanvas's `animated` prop doc comment.
        let live3dAnimated = true;
        // Dev override bypasses per-tier LOD selection entirely (it always
        // shows LOD0 detail, matching its existing manual-preview intent),
        // set alongside live3dEntry below so the render code can tell which
        // path chose it without a fragile reference-equality check.
        let usedDevOverride = false;
        if (!hasErroredLive3d) {
          if (devOverrideEntry) {
            live3dEntry = devOverrideEntry;
            usedDevOverride = true;
          } else if (registryEntry && deviceTier !== "T0") {
            // Size-gated relaxation: while the live-3D registry holds only
            // ONE entry (bon, today), there's no "crowd" to budget against —
            // every viewer (self or peer) sees the same single character, so
            // the T2-only crowd cap would just be gatekeeping bon from his
            // own peers for no reason. In that state, T1+ is sufficient for
            // everyone. The moment a second character is added to
            // LIVE_3D_CHARACTERS, this branch automatically stops applying
            // and the untouched self+crowd-cap logic below re-arms — no
            // separate flag or character-count check to maintain elsewhere.
            if (Object.keys(LIVE_3D_CHARACTERS).length <= 1) {
              live3dEntry = tierAtLeast(deviceTier, LIVE_3D_SELF_MIN_TIER)
                ? registryEntry
                : undefined;
            } else if (isSelf) {
              // Self gets its own, more generous allowance — independent
              // of (and never counted against) the crowd budget below.
              live3dEntry = tierAtLeast(deviceTier, LIVE_3D_SELF_MIN_TIER)
                ? registryEntry
                : undefined;
            } else if (crowdBudgetUsed < crowdBudgetCap) {
              live3dEntry = registryEntry;
              crowdBudgetUsed += 1;
            }
          } else if (registryEntry && isStaticFrame) {
            // D-D: confirmed-weak-but-has-WebGL device (software renderer,
            // or a weak-static device that failed/never ran its microbench
            // rescue) — a real, static (non-animated) single 3D frame of
            // the cheapest LOD, instead of the 2D sprite. Deliberately NOT
            // gated by the self/crowd budget above (this is a fallback
            // rendering mode, not full live-3D crowd consumption) and
            // independent of the ?live3d= dev override (already handled by
            // devOverrideEntry above).
            live3dEntry = registryEntry;
            live3dAnimated = false;
          }
        }

        const className = [styles.layer, isClickable ? styles.characterLayer : ""]
          .filter(Boolean)
          .join(" ");

        return (
          <div
            key={layer.id}
            className={className}
            {...(isRoomClickable ? { "data-room-id": layer.id } : {})}
            style={{
              left: `${(layer.x / FRAME_WIDTH) * 100}%`,
              top: `${(layer.y / FRAME_HEIGHT) * 100}%`,
              width: `${(layer.width / FRAME_WIDTH) * 100}%`,
              height: `${(layer.height / FRAME_HEIGHT) * 100}%`,
              ...(layer.transform ? { transform: layer.transform } : {}),
              // Synthetic backrest-crop layer only (see frontClipBottomPct's
              // doc comment in types/office.ts): clip the WRAPPER div itself
              // (not the img inside it) to only its top frontClipBottomPct
              // fraction, showing just the backrest/headrest portion. Never
              // resizes the div (would rescale the imgCrop %-based math
              // below), just visually clips it — same box, same img
              // position, less of it drawn.
              ...(layer.frontClipBottomPct !== undefined
                ? { clipPath: `inset(0 0 ${(1 - layer.frontClipBottomPct) * 100}% 0)` }
                : {}),
              ...(layer.blendMode
                ? { mixBlendMode: layer.blendMode as React.CSSProperties["mixBlendMode"] }
                : {}),
            }}
            {...(isClickable
              ? {
                  onPointerDown: characterClick.onPointerDown,
                  onPointerUp: (e: React.PointerEvent) => characterClick.onPointerUp(layer, e),
                }
              : isRoomClickable
                ? {
                    onPointerDown: roomClick.onPointerDown,
                    onPointerUp: (e: React.PointerEvent) => roomClick.onPointerUp(layer, e),
                  }
                : {})}
          >
            {live3dEntry ? (
              // live3dEntry is only ever set once both eligibility AND
              // permission gate above (or the dev override) allow it — same
              // wrapper div/slot/position/size as every other character
              // (depth-sort/occlusion untouched, still driven by this
              // layer's y+height baseline above), just a <canvas> in place
              // of the sprite <img>. onError below flips this specific
              // layer id into erroredLive3dIds, causing THIS character
              // (only) to fall back to its normal sprite on the next
              // render — never a blank/broken box.
              <CharacterCanvas
                glbUrl={
                  usedDevOverride
                    ? live3dEntry.glbUrl
                    : resolveLive3dGlbUrl(live3dEntry, deviceTier, !live3dAnimated)
                }
                width={live3dEntry.renderWidth}
                height={live3dEntry.renderHeight}
                animated={live3dAnimated}
                headingDegrees={directionToHeadingDegrees(
                  characterDirectionsById?.[layer.id] ?? "front",
                )}
                isWalking={characterIsWalkingById?.[layer.id] ?? true}
                isSitting={characterIsSittingById?.[layer.id] ?? false}
                // Reuses the existing chat-panel "talking" signal (rather
                // than plumbing a separate chat/call-specific flag) —
                // isChatting mirrors talkingCharacterIds exactly as the
                // prior gestureActive prop did; isResponder comes from
                // characterIsResponderById (layer-id-keyed — see its doc
                // comment above for why this can't be looked up directly
                // in talkingTextById, which is senderId/email-keyed).
                isChatting={talkingCharacterIds?.includes(layer.id) ?? false}
                isResponder={!!characterIsResponderById?.[layer.id]}
                onError={() => reportLive3dError(layer.id)}
              />
            ) : (
            <img
              src={src}
              alt=""
              style={(() => {
                const cropStyle: React.CSSProperties | undefined = layer.imgCrop
                  ? {
                      position: "absolute",
                      width: `${layer.imgCrop.wPct}%`,
                      height: `${layer.imgCrop.hPct}%`,
                      left: `${layer.imgCrop.leftPct}%`,
                      top: `${layer.imgCrop.topPct}%`,
                      maxWidth: "none",
                    }
                  : undefined;
                const slideDir = DOOR_SLIDE_DIRECTION[layer.id];
                if (!slideDir) return cropStyle;
                const isOpen = openDoorLayerIds?.has(layer.id) ?? false;
                return {
                  ...cropStyle,
                  transition: `transform ${DOOR_ANIM_MS}ms ease-in-out`,
                  transform: isOpen
                    ? slideDir === "left"
                      ? "translateX(-100%)"
                      : "translateX(100%)"
                    : "translateX(0)",
                };
              })()}
            />
            )}
          </div>
        );
      })}
      {emptySeats?.map((seat) => {
        // Fixed on-screen marker footprint (world px, before %-conversion) —
        // seat centroids have no inherent size of their own (they're a
        // point), so this is just big enough to be an easy click target
        // without visually dwarfing the chair art underneath it.
        const size = 28;
        return (
          <div
            key={seat.key}
            className={styles.emptySeatMarker}
            style={{
              left: `${((seat.x - size / 2) / FRAME_WIDTH) * 100}%`,
              top: `${((seat.y - size / 2) / FRAME_HEIGHT) * 100}%`,
              width: `${(size / FRAME_WIDTH) * 100}%`,
              height: `${(size / FRAME_HEIGHT) * 100}%`,
            }}
            onPointerDown={seatClick.onPointerDown}
            onPointerUp={(e) => seatClick.onPointerUp(seat, e)}
          />
        );
      })}
      {resolvedGreetedLayer && (
        <GreetingBubble
          key={greetingNonce}
          layer={resolvedGreetedLayer}
          text={greetingText ?? `Hi there, I'm ${formatCharacterName(resolvedGreetedLayer)}!`}
        />
      )}
      {talkingCharacterIds?.map((id, index) => {
        const layer = resolved.find((l) => l.id === id);
        if (!layer) return null;
        // Participants standing close together (e.g. bon walked up next to
        // the peer for chat) can land almost-identical bubble anchors —
        // nudge each participant's bubble to its own side so overlapping
        // text stays readable instead of garbling together.
        const sideOffset =
          talkingCharacterIds.length > 1 ? (index - (talkingCharacterIds.length - 1) / 2) * 130 : 0;
        return (
          <TalkingBubble key={id} layer={layer} text={talkingTextById?.[id]} sideOffset={sideOffset} />
        );
      })}
      <OfficePhaseOverlay phase={phase} />
    </div>
  );
}

export default OfficeStage;

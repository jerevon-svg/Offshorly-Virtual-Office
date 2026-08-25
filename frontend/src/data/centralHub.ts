// Central Hub is a plain walk-to-point room layer (office-assets-manifest.json,
// kind: "room") with no door gate and no painted seats — the Break/Lunch
// auto-walk target. Kept as a tiny named constant (rather than inlining the
// string) so both OfficeMap.tsx's walkToHub() and any future reference share
// one source of truth for the manifest/roomLayers id.
export const CENTRAL_HUB_ROOM_ID = "central-hub";

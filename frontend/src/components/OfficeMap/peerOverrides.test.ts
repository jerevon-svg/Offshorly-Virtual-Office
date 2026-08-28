import { describe, expect, it } from "vitest";
import { resolvePeerOverrides, resolveRenderablePeerEmails } from "./peerOverrides";
import type { PeerWalkerRenderState } from "./PeerWalker";
import { officePeopleToLayers } from "../../data/rosterLayers";
import type { OfficePerson } from "../../services/office/floorMerge";

function state(pos: { x: number; y: number }): PeerWalkerRenderState {
  return { pos, src: "some-src.png", isWalking: false, direction: "front", isSitting: true };
}

describe("resolvePeerOverrides", () => {
  it("given a synced desk position for X and X in the offline set, X is excluded from every override map (lineup/absent wins, not the synced desk pos)", () => {
    const peerWalkState = { "x@example.com": state({ x: 999, y: 999 }) };
    const offlineEmails = new Set(["x@example.com"]);

    const result = resolvePeerOverrides(peerWalkState, offlineEmails);

    expect(result.pos["x@example.com"]).toBeUndefined();
    expect(result.src["x@example.com"]).toBeUndefined();
    expect(result.isWalking["x@example.com"]).toBeUndefined();
    expect(result.isSitting["x@example.com"]).toBeUndefined();
    expect(result.direction["x@example.com"]).toBeUndefined();
  });

  it("when X is NOT offline, the synced pos wins (present in every override map)", () => {
    const peerWalkState = { "x@example.com": state({ x: 42, y: 7 }) };
    const offlineEmails = new Set<string>(); // X not in it

    const result = resolvePeerOverrides(peerWalkState, offlineEmails);

    expect(result.pos["x@example.com"]).toEqual({ x: 42, y: 7 });
    expect(result.isSitting["x@example.com"]).toBe(true);
  });

  it("other peers are unaffected by one peer going offline", () => {
    const peerWalkState = {
      "x@example.com": state({ x: 1, y: 1 }),
      "y@example.com": state({ x: 2, y: 2 }),
    };
    const result = resolvePeerOverrides(peerWalkState, new Set(["x@example.com"]));
    expect(result.pos["x@example.com"]).toBeUndefined();
    expect(result.pos["y@example.com"]).toEqual({ x: 2, y: 2 });
  });
});

describe("resolveRenderablePeerEmails", () => {
  it("excludes self, non-roster peers, and offline peers", () => {
    const result = resolveRenderablePeerEmails(
      ["self@x.com", "roster@x.com", "no-layer@x.com", "offline@x.com"],
      new Set(["roster@x.com", "offline@x.com", "self@x.com"]),
      new Set(["offline@x.com"]),
      "self@x.com",
    );
    expect(result).toEqual(["roster@x.com"]);
  });

  it("a peer who comes back online is renderable again (no offline entry -> included)", () => {
    const result = resolveRenderablePeerEmails(
      ["back-online@x.com"],
      new Set(["back-online@x.com"]),
      new Set(), // no longer offline
      "self@x.com",
    );
    expect(result).toEqual(["back-online@x.com"]);
  });

  it("a movementSync store entry with no roster layer yet is not rendered until the roster layer appears (events-before-roster)", () => {
    // Simulates: walk_started/positions_snapshot already landed for this
    // email, but /floor's roster hasn't resolved a layer for them yet.
    const beforeRoster = resolveRenderablePeerEmails(
      ["early@x.com"],
      new Set(), // no roster layer yet
      new Set(),
      "self@x.com",
    );
    expect(beforeRoster).toEqual([]);

    // Once the roster layer appears (next render), the SAME email becomes
    // renderable with no special-casing needed — the movementSync store
    // itself never lost the entry in between (this helper is stateless/pure,
    // called fresh each render off the ALWAYS-current store snapshot).
    const afterRoster = resolveRenderablePeerEmails(
      ["early@x.com"],
      new Set(["early@x.com"]),
      new Set(),
      "self@x.com",
    );
    expect(afterRoster).toEqual(["early@x.com"]);
  });

  it("recomputing rosterLayers (e.g. an unrelated SSE roster refresh) does not change a peer's effective override, as long as roster membership itself is unchanged", () => {
    const peerWalkState = { "stable@x.com": state({ x: 77, y: 88 }) };
    const offlineEmails = new Set<string>();

    // First "render" with one rosterLayers array reference...
    const firstRosterLayerEmailSet = new Set(["stable@x.com"]);
    const firstOverrides = resolvePeerOverrides(peerWalkState, offlineEmails);
    const firstRenderable = resolveRenderablePeerEmails(
      Object.keys(peerWalkState),
      firstRosterLayerEmailSet,
      offlineEmails,
      "self@x.com",
    );

    // ...then a roster/SSE refresh recomputes an entirely NEW rosterLayers
    // array (new Set instance, same membership) — resolvePeerOverrides
    // doesn't even take rosterLayers as an input, so it's structurally
    // impossible for a roster recompute to change its output; the
    // renderable-set membership is also unchanged since the email set
    // itself didn't change.
    const secondRosterLayerEmailSet = new Set(["stable@x.com"]); // new Set instance, same content
    const secondOverrides = resolvePeerOverrides(peerWalkState, offlineEmails);
    const secondRenderable = resolveRenderablePeerEmails(
      Object.keys(peerWalkState),
      secondRosterLayerEmailSet,
      offlineEmails,
      "self@x.com",
    );

    expect(secondOverrides.pos["stable@x.com"]).toEqual(firstOverrides.pos["stable@x.com"]);
    expect(secondRenderable).toEqual(firstRenderable);
  });
});

describe("single render identity (mixed-case roster email + lowercased peer override)", () => {
  function person(overrides: Partial<OfficePerson> = {}): OfficePerson {
    return {
      email: "Mixed.Case@Offshorly.com",
      displayName: "Mixed Case",
      status: "ONLINE",
      departmentName: "dev-team",
      jobTitle: null,
      currentActivity: null,
      lastMessage: null,
      avatarId: "bon",
      roomId: "dev-team",
      atlasRoomId: null,
      inEphemeralRoom: false,
      ...overrides,
    };
  }

  it("collapses a mixed-case roster email and its lowercased movement-sync override into ONE identity", () => {
    // Atlas's roster email is raw-case; every movement-sync key (walk
    // state, peer overrides) is already lowercased. Before the
    // rosterLayers.ts fix, `officePeopleToLayers` kept the raw case, so
    // `rosterLayerEmailSet`/`peerWalkOverridePos` (both lowercased) never
    // matched the roster layer's own id — the two "views" of the same
    // employee never collapsed into one.
    const layers = officePeopleToLayers([person()]);
    expect(layers).toHaveLength(1);
    const layerId = layers[0].id;

    // The lowercased key movement-sync's store would use for this employee.
    const movementSyncKey = "mixed.case@offshorly.com";
    expect(layerId).toBe(movementSyncKey);

    const peerWalkState = { [movementSyncKey]: state({ x: 10, y: 20 }) };
    const overrides = resolvePeerOverrides(peerWalkState, new Set());
    // The override actually resolves against THIS layer's id — proving the
    // live peer position/src overwrite the same node instead of leaving a
    // static, un-overridden roster twin behind.
    expect(overrides.pos[layerId]).toEqual({ x: 10, y: 20 });

    const rosterLayerEmailSet = new Set(layers.map((l) => l.id.toLowerCase()));
    const renderable = resolveRenderablePeerEmails(
      [movementSyncKey],
      rosterLayerEmailSet,
      new Set(),
      "someone-else@x.com",
    );
    expect(renderable).toEqual([movementSyncKey]);

    // Invariant: exactly one identity for this employee across BOTH the
    // static roster layer list AND the live-renderable peer set — no
    // duplicate/mismatched ids.
    const allIds = [...layers.map((l) => l.id), ...renderable];
    const uniqueLowercasedIds = new Set(allIds.map((id) => id.toLowerCase()));
    expect(uniqueLowercasedIds.size).toBe(1);
  });
});

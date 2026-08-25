import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PeerWalker } from "./PeerWalker";
import type { AvatarSpriteSet } from "../../services/avatar/types";

// Thin wrapper test — useCharacterWalk's own walk mechanics are covered by
// useCharacterWalk.test.ts. This only asserts PeerWalker's own
// wrapping/reporting behavior: it renders nothing, and picks staticSrc vs a
// characterSprite()-derived src depending on whether a spriteSet is given.

const FAKE_SPRITE_SET: AvatarSpriteSet = {
  walk: {
    front: ["walk-front-0.png", "walk-front-1.png"],
    back: ["walk-back-0.png", "walk-back-1.png"],
    left: ["walk-left-0.png", "walk-left-1.png"],
    right: ["walk-right-0.png", "walk-right-1.png"],
  },
  idle: {
    front: "idle-front.png",
    back: "idle-back.png",
    left: "idle-left.png",
    right: "idle-right.png",
  },
};

describe("PeerWalker", () => {
  it("renders null and reports staticSrc when spriteSet is null", () => {
    const onUpdate = vi.fn();
    const { container } = render(
      <PeerWalker
        layerId="peer@example.com"
        from={{ x: 0, y: 0 }}
        path={[{ x: 10, y: 10 }]}
        startNonce={0}
        arrivedAt={null}
        arrivedNonce={0}
        spriteSet={null}
        staticSrc="static-portrait.png"
        onUpdate={onUpdate}
      />,
    );

    expect(container.firstChild).toBeNull();
    expect(onUpdate).toHaveBeenCalledWith(
      "peer@example.com",
      expect.objectContaining({ src: "static-portrait.png" }),
    );
  });

  it("reports a characterSprite()-derived src, not staticSrc, when spriteSet is provided", () => {
    const onUpdate = vi.fn();
    render(
      <PeerWalker
        layerId="peer@example.com"
        from={{ x: 0, y: 0 }}
        path={[{ x: 10, y: 10 }]}
        startNonce={0}
        arrivedAt={null}
        arrivedNonce={0}
        spriteSet={FAKE_SPRITE_SET}
        staticSrc="static-portrait.png"
        onUpdate={onUpdate}
      />,
    );

    // Mount always fires the [startNonce]-keyed walkTo effect (even at
    // startNonce=0), so by the time onUpdate is called the walk has started
    // and the reported src is a walk frame, not idle — either way it must
    // come from the sprite set, never the static portrait.
    const lastCall = onUpdate.mock.calls[onUpdate.mock.calls.length - 1];
    expect(lastCall[1].src).not.toBe("static-portrait.png");
    expect(Object.values(FAKE_SPRITE_SET.walk).flat()).toContain(lastCall[1].src);
  });
});

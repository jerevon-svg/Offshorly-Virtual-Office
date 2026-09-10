import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { ChatWindowHeader } from "./ChatWindowHeader";
import styles from "./ConversationView.module.css";

// The spatial marker is a SECONDARY status, not a second title: it belongs on the same small
// line the DND / delayed-response copy uses, so the employee name and the header's call actions
// keep the width they need.
describe("ChatWindowHeader — spatial status line", () => {
  afterEach(() => cleanup());

  it("renders Spatial Conversation as secondary status, never beside the name", () => {
    const { container } = render(
      <ChatWindowHeader name="Micah" isSpatial onClose={vi.fn()} onMinimizeToggle={vi.fn()} />,
    );

    const badge = container.querySelector(`.${styles.spatialBadge}`)!;
    expect(badge).toHaveTextContent("Spatial Conversation");
    // It lives inside the subtitle line, and the title row holds only the name.
    expect(badge.closest(`.${styles.subtitle}`)).not.toBeNull();
    expect(badge.closest(`.${styles.titleRow}`)).toBeNull();
    expect(container.querySelector(`.${styles.titleRow}`)!.textContent).toBe("Micah");
  });

  it("shares the secondary line with an existing status (e.g. DND) rather than replacing it", () => {
    const { container } = render(
      <ChatWindowHeader
        name="Micah"
        isSpatial
        subtitle="🔴 DND · Notifications muted"
        onClose={vi.fn()}
      />,
    );
    const subtitle = container.querySelector(`.${styles.subtitle}`)!;
    expect(subtitle.textContent).toContain("Spatial Conversation");
    expect(subtitle.textContent).toContain("DND");
  });

  it("leaves a non-spatial header with no spatial marker at all", () => {
    const { container } = render(<ChatWindowHeader name="Alex" onClose={vi.fn()} />);
    expect(container.querySelector(`.${styles.spatialBadge}`)).toBeNull();
    expect(screen.queryByText(/Spatial Conversation/)).toBeNull();
  });
});

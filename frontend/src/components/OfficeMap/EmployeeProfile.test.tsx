// @ts-expect-error node:fs is untyped under tsconfig.app.json (types: ["vite/client"] only) —
// same exemption HudDock.layering.test.ts takes. vitest runs in Node with cwd = frontend/.
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { EmployeeProfile } from "./EmployeeProfile";
import type { FeedPost } from "../../services/feed/feedClient";
import type { OfficePerson } from "../../services/office/floorMerge";

const {
  fetchFeed,
  createFeedPost,
  giveKudos,
  deleteFeedPost,
  reactToPost,
  removeReaction,
  createComment,
  deleteComment,
} =
  vi.hoisted(() => ({
    fetchFeed: vi.fn(),
    createFeedPost: vi.fn(),
    giveKudos: vi.fn(),
    deleteFeedPost: vi.fn(),
    reactToPost: vi.fn(),
    removeReaction: vi.fn(),
    createComment: vi.fn(),
    deleteComment: vi.fn(),
  }));

vi.mock("../../services/feed/feedClient", async () => {
  const actual = await vi.importActual<typeof import("../../services/feed/feedClient")>(
    "../../services/feed/feedClient",
  );
  return {
    ...actual,
    fetchFeed,
    createFeedPost,
    giveKudos,
    deleteFeedPost,
    reactToPost,
    removeReaction,
    createComment,
    deleteComment,
  };
});

const { useProgressionStore } = vi.hoisted(() => ({ useProgressionStore: vi.fn() }));

vi.mock("../../services/quests/progressionStore", async () => {
  const actual = await vi.importActual<typeof import("../../services/quests/progressionStore")>(
    "../../services/quests/progressionStore",
  );
  // unclaimedTierCount stays REAL — the tab dot's whole point is that it is derived, so the test
  // must exercise the real derivation and only stub the data source and the fetches.
  return { ...actual, useProgressionStore, refreshBadges: vi.fn(), refreshProgression: vi.fn() };
});

type StoreBadge = import("../../services/quests/questsClient").Badge;
const makeBadge = (over: Partial<StoreBadge> = {}): StoreBadge => ({
  id: "regular",
  title: "Regular",
  description: "Check in to the office",
  category: "engagement",
  emblem: "regular",
  metricKind: "event_count",
  metric: 25,
  tier: 2,
  tierName: "silver",
  thresholds: [5, 20, 60, 150],
  nextThreshold: 60,
  tiersAwardedAt: ["2026-09-01T00:00:00Z", "2026-09-02T00:00:00Z", null, null],
  tiersClaimedAt: [null, null, null, null],
  tierRewards: [{ xp: 25, coins: 10 }, { xp: 75, coins: 25 }, { xp: 150, coins: 50 }, { xp: 300, coins: 100 }],
  ...over,
});

function makePost(overrides: Partial<FeedPost> = {}): FeedPost {
  return {
    id: "post-1",
    targetEmail: "alex@example.com",
    authorEmail: "bon@example.com",
    type: "post",
    content: "Great work!",
    createdAt: new Date("2026-01-01T12:00:00Z").toISOString(),
    reactions: [],
    myReaction: null,
    comments: [],
    canDelete: false,
    ...overrides,
  };
}

const ROSTER: OfficePerson[] = [
  {
    email: "alex@example.com",
    displayName: "Alex",
    status: "ONLINE",
    departmentName: "Management",
    jobTitle: "COO",
    currentActivity: null,
    lastMessage: null,
    avatarId: "alex",
    roomId: "room-1",
    atlasRoomId: null,
    inEphemeralRoom: false,
  },
  {
    email: "bon@example.com",
    displayName: "Bon",
    status: "ONLINE",
    departmentName: "Design",
    jobTitle: "Designer",
    currentActivity: null,
    lastMessage: null,
    avatarId: "bon",
    roomId: "room-1",
    atlasRoomId: null,
    inEphemeralRoom: false,
  },
];

describe("EmployeeProfile", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchFeed.mockResolvedValue([]);
    useProgressionStore.mockReturnValue({ progression: null, badges: null });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders the profile header with roster name/role/status", async () => {
    render(<EmployeeProfile email="alex@example.com" viewerEmail="bon@example.com" roster={ROSTER} onClose={vi.fn()} />);

    expect(screen.getByText("Alex")).toBeInTheDocument();
    await waitFor(() => expect(fetchFeed).toHaveBeenCalledWith("alex@example.com"));
  });


  // ---- Achievements tab attention dot -------------------------------------------------------
  // Derived from the SAME unclaimed-tier count the gallery header shows. No stored "seen" flag,
  // so the dot cannot drift from the reward state it stands for.
  describe("Achievements tab claim indicator", () => {
    const self = () =>
      render(<EmployeeProfile email="bon@example.com" viewerEmail="bon@example.com" roster={ROSTER} onClose={vi.fn()} />);

    it("shows a dot and announces the count when a tier reward is claimable", () => {
      useProgressionStore.mockReturnValue({ progression: null, badges: [makeBadge()] }); // 2 earned, 0 claimed
      self();
      expect(screen.getByTestId("tab-achievements-dot")).toBeInTheDocument();
      expect(screen.getByTestId("tab-achievements")).toHaveAttribute("aria-label", "Achievements, 2 rewards to claim");
    });

    it("singularises the announcement for exactly one claimable tier", () => {
      useProgressionStore.mockReturnValue({
        progression: null,
        badges: [makeBadge({ tiersClaimedAt: ["2026-09-01T01:00:00Z", null, null, null] })],
      });
      self();
      expect(screen.getByTestId("tab-achievements")).toHaveAttribute("aria-label", "Achievements, 1 reward to claim");
    });

    it("shows no dot when every earned tier is already claimed", () => {
      useProgressionStore.mockReturnValue({
        progression: null,
        badges: [makeBadge({ tiersClaimedAt: ["2026-09-01T01:00:00Z", "2026-09-02T01:00:00Z", null, null] })],
      });
      self();
      expect(screen.queryByTestId("tab-achievements-dot")).toBeNull();
      expect(screen.getByTestId("tab-achievements")).toHaveAttribute("aria-label", "Achievements");
    });

    it("keeps the dot after the Achievements tab is opened — only claiming clears it", () => {
      useProgressionStore.mockReturnValue({ progression: null, badges: [makeBadge()] });
      self();
      fireEvent.click(screen.getByTestId("tab-achievements"));
      expect(screen.getByTestId("tab-achievements-dot")).toBeInTheDocument();
    });

    it("carries no indicator on someone else's profile", () => {
      useProgressionStore.mockReturnValue({ progression: null, badges: [makeBadge()] });
      render(<EmployeeProfile email="alex@example.com" viewerEmail="bon@example.com" roster={ROSTER} onClose={vi.fn()} />);
      expect(screen.queryByTestId("tab-achievements-dot")).toBeNull();
    });
  });

  it("falls back to a localpart-derived name when the email isn't in the roster", () => {
    render(<EmployeeProfile email="new.hire@example.com" viewerEmail="bon@example.com" roster={ROSTER} onClose={vi.fn()} />);

    expect(screen.getByText("New.hire")).toBeInTheDocument();
    expect(screen.getByText("Role unavailable")).toBeInTheDocument();
  });

  it("renders a normal post with author and content, and a composed sentence for a birthday activity", async () => {
    fetchFeed.mockResolvedValue([
      makePost({ id: "p1", type: "post", authorEmail: "bon@example.com", content: "Great work!" }),
      makePost({
        id: "p2",
        type: "birthday",
        authorEmail: "bon@example.com",
        targetEmail: "alex@example.com",
        content: "wished them a Happy Birthday! 🎉",
      }),
    ]);

    render(<EmployeeProfile email="alex@example.com" viewerEmail="bon@example.com" roster={ROSTER} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("tab", { name: "Feed" }));

    await waitFor(() => expect(screen.getByText("Great work!")).toBeInTheDocument());
    expect(screen.getByText(/Bon wished Alex a Happy Birthday! 🎉/)).toBeInTheDocument();
  });

  it("clicking a reaction emoji reacts, clicking the active one again removes it", async () => {
    const post = makePost({ id: "p1", reactions: [{ emoji: "❤️", count: 1 }], myReaction: null });
    fetchFeed.mockResolvedValue([post]);
    reactToPost.mockResolvedValue({ ...post, reactions: [{ emoji: "❤️", count: 2 }], myReaction: "❤️" });
    removeReaction.mockResolvedValue({ ...post, reactions: [], myReaction: null });

    render(<EmployeeProfile email="alex@example.com" viewerEmail="bon@example.com" roster={ROSTER} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("tab", { name: "Feed" }));
    await waitFor(() => expect(screen.getByLabelText("React with ❤️")).toBeInTheDocument());

    fireEvent.click(screen.getByLabelText("React with ❤️"));
    await waitFor(() => expect(reactToPost).toHaveBeenCalledWith("p1", "❤️"));
    await waitFor(() => expect(screen.getByLabelText("React with ❤️")).toHaveTextContent("2"));

    fireEvent.click(screen.getByLabelText("React with ❤️"));
    await waitFor(() => expect(removeReaction).toHaveBeenCalledWith("p1"));
  });

  it("expanding comments shows a comment and its one-level reply", async () => {
    const post = makePost({
      id: "p1",
      comments: [
        {
          id: "c1",
          postId: "p1",
          parentCommentId: null,
          authorEmail: "alex@example.com",
          content: "Happy birthday!",
          createdAt: new Date().toISOString(),
          replies: [
            {
              id: "c2",
              postId: "p1",
              parentCommentId: "c1",
              authorEmail: "bon@example.com",
              content: "Thank you!!",
              createdAt: new Date().toISOString(),
              replies: [],
            },
          ],
        },
      ],
    });
    fetchFeed.mockResolvedValue([post]);

    render(<EmployeeProfile email="alex@example.com" viewerEmail="bon@example.com" roster={ROSTER} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("tab", { name: "Feed" }));
    await waitFor(() => expect(screen.getByText(/💬 Comment/)).toBeInTheDocument());

    fireEvent.click(screen.getByText(/💬 Comment/));

    expect(screen.getByText("Happy birthday!")).toBeInTheDocument();
    expect(screen.getByText("Thank you!!")).toBeInTheDocument();
  });

  it("only shows Delete on a post when canDelete is true", async () => {
    fetchFeed.mockResolvedValue([
      makePost({ id: "p1", canDelete: true, content: "mine" }),
      makePost({ id: "p2", canDelete: false, content: "not mine" }),
    ]);

    render(<EmployeeProfile email="alex@example.com" viewerEmail="bon@example.com" roster={ROSTER} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("tab", { name: "Feed" }));
    await waitFor(() => expect(screen.getByText("mine")).toBeInTheDocument());

    const deleteButtons = screen.getAllByText("Delete");
    expect(deleteButtons).toHaveLength(1);
  });

  it("submitting the composer creates a post and prepends it to the feed", async () => {
    fetchFeed.mockResolvedValue([]);
    createFeedPost.mockResolvedValue(makePost({ id: "new-post", content: "Nice job team" }));

    render(<EmployeeProfile email="alex@example.com" viewerEmail="bon@example.com" roster={ROSTER} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("tab", { name: "Feed" }));
    await waitFor(() => expect(screen.getByPlaceholderText(/Share an update/)).toBeInTheDocument());

    fireEvent.change(screen.getByPlaceholderText(/Share an update/), { target: { value: "Nice job team" } });
    fireEvent.click(screen.getByRole("button", { name: "Post" }));

    await waitFor(() => expect(createFeedPost).toHaveBeenCalledWith("alex@example.com", "Nice job team"));
    await waitFor(() => expect(screen.getByText("Nice job team")).toBeInTheDocument());
  });

  // Give Kudos is a separate, explicit act from the normal post composer (backend pays the
  // recipient for it) — so it must be its own control, and never offered on your own profile.
  it("gives Kudos with a message through the Kudos action, not the post composer", async () => {
    giveKudos.mockResolvedValue(
      makePost({ id: "k1", type: "recognition", content: "Saved the release", authorEmail: "bon@example.com" }),
    );

    render(<EmployeeProfile email="alex@example.com" viewerEmail="bon@example.com" roster={ROSTER} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("tab", { name: "Feed" }));

    fireEvent.change(await screen.findByLabelText("Kudos message"), { target: { value: "Saved the release" } });
    fireEvent.click(screen.getByRole("button", { name: /Give Kudos/ }));

    await waitFor(() => expect(giveKudos).toHaveBeenCalledWith("alex@example.com", "Saved the release"));
    expect(createFeedPost).not.toHaveBeenCalled();
    // The Kudos activity renders the composed sentence AND the giver's message.
    expect(await screen.findByText(/Bon gave Alex Kudos!/)).toBeInTheDocument();
    expect(screen.getByText("Saved the release")).toBeInTheDocument();
  });

  it("offers no Kudos action on your own profile", async () => {
    render(<EmployeeProfile email="bon@example.com" viewerEmail="bon@example.com" roster={ROSTER} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("tab", { name: "Feed" }));

    await waitFor(() => expect(fetchFeed).toHaveBeenCalled());
    expect(screen.queryByTestId("kudos-composer")).not.toBeInTheDocument();
  });
  // Notification landing (see NotificationCenter.tsx's profileFeed destination): a "You received
  // Kudos!" notification opens this panel already on the Feed tab with that Kudos highlighted,
  // rather than dropping the viewer on the profile tab to go find it.
  describe("notification landing", () => {
    it("opens on the requested tab and highlights the post a notification pointed at", async () => {
      fetchFeed.mockResolvedValue([
        makePost({ id: "other", content: "Unrelated" }),
        makePost({ id: "kudos-1", type: "recognition", content: "Saved the release" }),
      ]);

      render(
        <EmployeeProfile
          email="alex@example.com"
          viewerEmail="bon@example.com"
          roster={ROSTER}
          onClose={vi.fn()}
          initialTab="feed"
          focusPostId="kudos-1"
        />,
      );

      // Landed on the Feed without anyone clicking the tab.
      expect(await screen.findByText("Saved the release")).toBeInTheDocument();
      const highlighted = document.querySelectorAll('[data-highlighted="true"]');
      expect(highlighted).toHaveLength(1);
      expect(highlighted[0].getAttribute("data-post-id")).toBe("kudos-1");
    });

    it("still opens the feed when the pointed-at post is not in the fetched window", async () => {
      fetchFeed.mockResolvedValue([makePost({ id: "other", content: "Unrelated" })]);

      render(
        <EmployeeProfile
          email="alex@example.com"
          viewerEmail="bon@example.com"
          roster={ROSTER}
          onClose={vi.fn()}
          initialTab="feed"
          focusPostId="long-gone"
        />,
      );

      expect(await screen.findByText("Unrelated")).toBeInTheDocument();
      expect(document.querySelectorAll('[data-highlighted="true"]')).toHaveLength(0);
    });

    it("defaults to the profile tab and highlights nothing when opened normally", async () => {
      fetchFeed.mockResolvedValue([makePost({ id: "kudos-1", type: "recognition" })]);

      render(
        <EmployeeProfile email="alex@example.com" viewerEmail="bon@example.com" roster={ROSTER} onClose={vi.fn()} />,
      );

      await waitFor(() => expect(fetchFeed).toHaveBeenCalled());
      expect(screen.getByRole("tab", { name: "Feed" })).toBeInTheDocument();
      expect(document.querySelectorAll('[data-highlighted="true"]')).toHaveLength(0);
    });
  });

// REGRESSION — the panel rendered at 600px despite `.panel { width: min(1320px, 96vw) }`,
// because a stale GROUPED rule (`.panel, .panelWide { width: min(600px, 94vw) }`) sat later in
// the file at equal specificity and won the cascade. A plain "is it declared?" check passes in
// that situation, so these assert the shell classes are declared exactly ONCE across the whole
// stylesheet — grouped selectors included.
describe("EmployeeProfile.module.css has no stale shell overrides", () => {
  const raw = readFileSync("src/components/OfficeMap/EmployeeProfile.module.css", "utf8");
  // Drop @media / @keyframes bodies: a shell class legitimately reappears inside those, and it
  // is the TOP-LEVEL duplicates at equal specificity that silently win the cascade.
  const topLevel = raw.replace(/@[\w-]+[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, "");

  /** How many top-level rules set `prop` on a bare `.name` selector, grouped selectors included. */
  function declarations(name: string, prop: string): number {
    const rules = topLevel.match(/[^{}]+\{[^{}]*\}/g) ?? [];
    return rules.filter((rule: string) => {
      const [selectors, body] = rule.split("{");
      const bare = selectors
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .split(",")
        .some((part: string) => part.trim() === `.${name}`);
      return bare && new RegExp(`(^|;|\\s)${prop}\\s*:`).test(body);
    }).length;
  }

  it("sets the panel's width in exactly one top-level rule", () => {
    // The bug: a later `.panel, .panelWide { width: min(600px, 94vw) }` beat the shell's width.
    expect(declarations("panel", "width")).toBe(1);
  });

  it.each([
    ["backdrop", "background"],
    ["side", "width"],
    ["body", "padding"],
    ["tabs", "display"],
    ["composerInput", "flex"],
  ])("sets .%s's %s in exactly one top-level rule", (name, prop) => {
    expect(declarations(name, prop)).toBe(1);
  });

  it("declares a landscape desktop panel with a stable width and height", () => {
    const panel = /\n\.panel\s*\{([^}]*)\}/.exec(raw)?.[1] ?? "";
    // Landscape band: wide enough for a 2/3 workspace, not so wide it overshoots the reference.
    const width = /width:\s*min\((\d+)px/.exec(panel);
    expect(width).not.toBeNull();
    expect(Number(width?.[1])).toBeGreaterThanOrEqual(1120);
    expect(Number(width?.[1])).toBeLessThanOrEqual(1200);
    // A FIXED height — `height: auto` let the modal resize when switching tabs.
    expect(panel).toMatch(/height:\s*min\(\d+px/);
    expect(panel).not.toMatch(/height:\s*auto/);
    expect(raw).not.toMatch(/min\(600px/);
  });
});
});

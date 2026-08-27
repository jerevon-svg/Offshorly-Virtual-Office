import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { EmployeeProfile } from "./EmployeeProfile";
import type { FeedPost } from "../../services/feed/feedClient";
import type { OfficePerson } from "../../services/office/floorMerge";

const { fetchFeed, createFeedPost, deleteFeedPost, reactToPost, removeReaction, createComment, deleteComment } =
  vi.hoisted(() => ({
    fetchFeed: vi.fn(),
    createFeedPost: vi.fn(),
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
    deleteFeedPost,
    reactToPost,
    removeReaction,
    createComment,
    deleteComment,
  };
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
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders the profile header with roster name/role/status", async () => {
    render(<EmployeeProfile email="alex@example.com" viewerEmail="bon@example.com" roster={ROSTER} onClose={vi.fn()} />);

    expect(screen.getByText("Alex")).toBeInTheDocument();
    await waitFor(() => expect(fetchFeed).toHaveBeenCalledWith("alex@example.com"));
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
    fireEvent.click(screen.getByRole("button", { name: "Feed" }));

    await waitFor(() => expect(screen.getByText("Great work!")).toBeInTheDocument());
    expect(screen.getByText(/Bon wished Alex a Happy Birthday! 🎉/)).toBeInTheDocument();
  });

  it("clicking a reaction emoji reacts, clicking the active one again removes it", async () => {
    const post = makePost({ id: "p1", reactions: [{ emoji: "❤️", count: 1 }], myReaction: null });
    fetchFeed.mockResolvedValue([post]);
    reactToPost.mockResolvedValue({ ...post, reactions: [{ emoji: "❤️", count: 2 }], myReaction: "❤️" });
    removeReaction.mockResolvedValue({ ...post, reactions: [], myReaction: null });

    render(<EmployeeProfile email="alex@example.com" viewerEmail="bon@example.com" roster={ROSTER} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Feed" }));
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
    fireEvent.click(screen.getByRole("button", { name: "Feed" }));
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
    fireEvent.click(screen.getByRole("button", { name: "Feed" }));
    await waitFor(() => expect(screen.getByText("mine")).toBeInTheDocument());

    const deleteButtons = screen.getAllByText("Delete");
    expect(deleteButtons).toHaveLength(1);
  });

  it("submitting the composer creates a post and prepends it to the feed", async () => {
    fetchFeed.mockResolvedValue([]);
    createFeedPost.mockResolvedValue(makePost({ id: "new-post", content: "Nice job team" }));

    render(<EmployeeProfile email="alex@example.com" viewerEmail="bon@example.com" roster={ROSTER} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Feed" }));
    await waitFor(() => expect(screen.getByPlaceholderText(/Write something on/)).toBeInTheDocument());

    fireEvent.change(screen.getByPlaceholderText(/Write something on/), { target: { value: "Nice job team" } });
    fireEvent.click(screen.getByRole("button", { name: "Post" }));

    await waitFor(() => expect(createFeedPost).toHaveBeenCalledWith("alex@example.com", "Nice job team"));
    await waitFor(() => expect(screen.getByText("Nice job team")).toBeInTheDocument());
  });
});

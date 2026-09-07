import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Whiteboard, WhiteboardSummary } from "../../services/whiteboard/whiteboardClient";

// The real editor pulls in Excalidraw (canvas, no jsdom) — stub it with a marker so the
// panel's list → create/open → editor handoff can be asserted without a canvas.
// `editorFails` lets a test make the (mocked) editor crash the way a lazy chunk that failed to load
// does: the throw must be contained by the panel's own boundary, not escape upward. It stays set
// until the test clears it — React retries a concurrent render synchronously before consulting
// boundaries, so a throw-once mock would never reach the boundary at all.
let editorFails = false;
vi.mock("./WhiteboardEditor", () => ({
  default: ({ board }: { board: Whiteboard }) => {
    if (editorFails) throw new Error("Failed to fetch dynamically imported module");
    return <div data-testid="editor">editor:{board.title}:v{board.version}</div>;
  },
}));

type Scope = { kind: "conversation" | "room"; id: string };
const listWhiteboards = vi.fn<(scope: Scope) => Promise<WhiteboardSummary[]>>();
const createWhiteboard = vi.fn<(scope: Scope, title: string) => Promise<Whiteboard>>();
const getWhiteboard = vi.fn<(id: string) => Promise<Whiteboard>>();

vi.mock("../../services/whiteboard/whiteboardClient", () => ({
  listWhiteboardsIn: (scope: Scope) => listWhiteboards(scope),
  createWhiteboardIn: (scope: Scope, title: string) => createWhiteboard(scope, title),
  getWhiteboard: (id: string) => getWhiteboard(id),
}));

const CONV: Scope = { kind: "conversation", id: "c1" };

import { WhiteboardPanel } from "./WhiteboardPanel";

const summary: WhiteboardSummary = {
  id: "b1",
  conversationId: "c1",
  roomId: null,
  title: "Sprint plan",
  version: 2,
  createdByEmail: "a@example.com",
  updatedByEmail: "b@example.com",
  createdAt: "2026-09-05T10:00:00.000Z",
  updatedAt: "2026-09-05T11:00:00.000Z",
};

beforeEach(() => {
  listWhiteboards.mockReset();
  createWhiteboard.mockReset();
  getWhiteboard.mockReset();
});

afterEach(() => cleanup());

describe("WhiteboardPanel", () => {
  it("lists the conversation's boards and opens one into the editor", async () => {
    listWhiteboards.mockResolvedValue([summary]);
    getWhiteboard.mockResolvedValue({ ...summary, document: { document: {} } });
    render(<WhiteboardPanel scope={CONV} title="Squad" onClose={() => {}} />);

    await waitFor(() => expect(screen.getByText("Sprint plan")).toBeInTheDocument());
    expect(listWhiteboards).toHaveBeenCalledWith(CONV);

    fireEvent.click(screen.getByText("Sprint plan"));
    await waitFor(() => expect(screen.getByTestId("editor")).toHaveTextContent("editor:Sprint plan:v2"));
    expect(getWhiteboard).toHaveBeenCalledWith("b1");

    // Back returns to the list and re-fetches it.
    fireEvent.click(screen.getByText("← Boards"));
    await waitFor(() => expect(listWhiteboards).toHaveBeenCalledTimes(2));
    expect(screen.queryByTestId("editor")).toBeNull();
  });

  it("creates a board from the title form and opens it immediately", async () => {
    listWhiteboards.mockResolvedValue([]);
    createWhiteboard.mockResolvedValue({ ...summary, id: "b2", title: "Retro", version: 1, document: null });
    render(<WhiteboardPanel scope={CONV} title="Squad" onClose={() => {}} />);

    await waitFor(() => expect(screen.getByText(/No whiteboards yet/)).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("New whiteboard title"), { target: { value: "  Retro " } });
    fireEvent.click(screen.getByText("Create"));

    await waitFor(() => expect(screen.getByTestId("editor")).toHaveTextContent("editor:Retro:v1"));
    expect(createWhiteboard).toHaveBeenCalledWith(CONV, "Retro");
  });

  it("contains an editor load failure inside the panel and recovers via Try again", async () => {
    // React re-logs boundary-caught errors; keep the run quiet and assert on the UI instead.
    vi.spyOn(console, "error").mockImplementation(() => {});
    listWhiteboards.mockResolvedValue([summary]);
    getWhiteboard.mockResolvedValue({ ...summary, document: { document: {} } });
    const onClose = vi.fn();
    render(<WhiteboardPanel scope={CONV} title="Squad" onClose={onClose} />);
    await waitFor(() => expect(screen.getByText("Sprint plan")).toBeInTheDocument());

    editorFails = true;
    fireEvent.click(screen.getByText("Sprint plan"));

    // Local failure state — the dialog chrome (header, board title, close) is still there.
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("The whiteboard editor couldn't load."));
    expect(screen.getByRole("dialog", { name: "Whiteboards" })).toBeInTheDocument();
    expect(screen.getByLabelText("Close whiteboards")).toBeInTheDocument();
    expect(screen.queryByText("Something went wrong. Please refresh the page.")).toBeNull();

    editorFails = false;
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(screen.getByTestId("editor")).toHaveTextContent("editor:Sprint plan:v2"));
    expect(screen.queryByRole("alert")).toBeNull();
    vi.restoreAllMocks();
  });

  it("lets the user go back to the board list from the editor failure state", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    listWhiteboards.mockResolvedValue([summary]);
    getWhiteboard.mockResolvedValue({ ...summary, document: { document: {} } });
    render(<WhiteboardPanel scope={CONV} title="Squad" onClose={() => {}} />);
    await waitFor(() => expect(screen.getByText("Sprint plan")).toBeInTheDocument());

    editorFails = true;
    fireEvent.click(screen.getByText("Sprint plan"));
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    editorFails = false;

    fireEvent.click(screen.getAllByRole("button", { name: "← Boards" })[0]);
    await waitFor(() => expect(listWhiteboards).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByText("Sprint plan")).toBeInTheDocument();
    vi.restoreAllMocks();
  });

  it("lists and creates within a ROOM scope (W4) through the same panel", async () => {
    const room: Scope = { kind: "room", id: "dev-team" };
    listWhiteboards.mockResolvedValue([]);
    createWhiteboard.mockResolvedValue({ ...summary, id: "r1", conversationId: null, roomId: "dev-team", title: "Standup", version: 1, document: null });
    render(<WhiteboardPanel scope={room} title="Dev Team" onClose={() => {}} />);

    await waitFor(() => expect(screen.getByText(/No whiteboards yet/)).toBeInTheDocument());
    expect(listWhiteboards).toHaveBeenCalledWith(room);
    expect(screen.getByText("· Dev Team")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("New whiteboard title"), { target: { value: "Standup" } });
    fireEvent.click(screen.getByText("Create"));
    await waitFor(() => expect(screen.getByTestId("editor")).toHaveTextContent("editor:Standup:v1"));
    expect(createWhiteboard).toHaveBeenCalledWith(room, "Standup");
  });

  it("shows the server's error (e.g. 403) instead of a list, and closes via the × button", async () => {
    listWhiteboards.mockRejectedValue(new Error("Not a participant in this conversation"));
    const onClose = vi.fn();
    render(<WhiteboardPanel scope={CONV} title="Squad" onClose={onClose} />);

    await waitFor(() => expect(screen.getByText(/Not a participant/)).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText("Close whiteboards"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

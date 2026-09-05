import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Whiteboard, WhiteboardSummary } from "../../services/whiteboard/whiteboardClient";

// The real editor pulls in tldraw (canvas/WebGL, no jsdom) — stub it with a marker so the
// panel's list → create/open → editor handoff can be asserted without a canvas.
vi.mock("./WhiteboardEditor", () => ({
  default: ({ board }: { board: Whiteboard }) => <div data-testid="editor">editor:{board.title}:v{board.version}</div>,
}));

const listWhiteboards = vi.fn<(id: string) => Promise<WhiteboardSummary[]>>();
const createWhiteboard = vi.fn<(id: string, title: string) => Promise<Whiteboard>>();
const getWhiteboard = vi.fn<(id: string) => Promise<Whiteboard>>();

vi.mock("../../services/whiteboard/whiteboardClient", () => ({
  listWhiteboards: (id: string) => listWhiteboards(id),
  createWhiteboard: (id: string, title: string) => createWhiteboard(id, title),
  getWhiteboard: (id: string) => getWhiteboard(id),
}));

import { WhiteboardPanel } from "./WhiteboardPanel";

const summary: WhiteboardSummary = {
  id: "b1",
  conversationId: "c1",
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
    render(<WhiteboardPanel conversationId="c1" title="Squad" onClose={() => {}} />);

    await waitFor(() => expect(screen.getByText("Sprint plan")).toBeInTheDocument());
    expect(listWhiteboards).toHaveBeenCalledWith("c1");

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
    render(<WhiteboardPanel conversationId="c1" title="Squad" onClose={() => {}} />);

    await waitFor(() => expect(screen.getByText(/No whiteboards yet/)).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("New whiteboard title"), { target: { value: "  Retro " } });
    fireEvent.click(screen.getByText("Create"));

    await waitFor(() => expect(screen.getByTestId("editor")).toHaveTextContent("editor:Retro:v1"));
    expect(createWhiteboard).toHaveBeenCalledWith("c1", "Retro");
  });

  it("shows the server's error (e.g. 403) instead of a list, and closes via the × button", async () => {
    listWhiteboards.mockRejectedValue(new Error("Not a participant in this conversation"));
    const onClose = vi.fn();
    render(<WhiteboardPanel conversationId="c1" title="Squad" onClose={onClose} />);

    await waitFor(() => expect(screen.getByText(/Not a participant/)).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText("Close whiteboards"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

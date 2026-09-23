import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The network seam, mocked once. Every case here is about what the Studio does with an ANSWER.
const apiFetch = vi.fn();
// THE TRANSPORT SEAM. experienceCatalog talks to the VO backend directly (VITE_CHAT_SOCKET_URL),
// like every other VO-backend client — not through apiFetch, which targets Atlas. So global fetch is
// what these cases stub, and getAuthToken supplies the identity that makes the module willing to ask.
vi.stubGlobal("fetch", (...args: unknown[]) => apiFetch(...args));
vi.mock("../../services/api/client", () => ({ getAuthToken: () => "a-token" }));
vi.stubEnv("VITE_CHAT_SOCKET_URL", "http://vo-backend.test");

import { CreatorStudioPanel } from "./CreatorStudioPanel";
import { __resetExperienceCatalogForTests } from "../../services/office/experienceCatalogStore";

type Answer = {
  available: string[];
  previewable: string[];
  default: string;
  creator: boolean;
  publications: {
    experience: string;
    published: boolean;
    implemented: boolean;
    updatedBy: string | null;
    updatedAt: string | null;
  }[];
};

const UNBUILT = {
  experience: "halloween",
  published: false,
  implemented: false,
  updatedBy: null,
  updatedAt: null,
};
const READY = { ...UNBUILT, implemented: true };
const PUBLISHED = { ...READY, published: true, updatedBy: "creator@example.com" };

function answer(overrides: Partial<Answer> = {}): Answer {
  return {
    available: ["v2", "classic"],
    previewable: [],
    default: "v2",
    creator: true,
    publications: [UNBUILT],
    ...overrides,
  };
}

function ok(body: unknown) {
  return { ok: true, status: 200, json: async () => body };
}

beforeEach(() => {
  apiFetch.mockReset();
  __resetExperienceCatalogForTests();
});

async function mount(first: Answer) {
  apiFetch.mockResolvedValueOnce(ok(first));
  render(<CreatorStudioPanel />);
  // The first render is the fallback catalog (not a Creator), so the section is absent until the
  // server's answer lands. That is the gate working, not a loading state.
  return screen.findByTestId("creator-studio");
}

describe("who sees the Creator Studio", () => {
  it("renders nothing for an employee the server did not call a Creator", async () => {
    apiFetch.mockResolvedValue(ok(answer({ creator: false })));
    render(<CreatorStudioPanel />);
    await waitFor(() => expect(apiFetch).toHaveBeenCalled());
    expect(screen.queryByTestId("creator-studio")).toBeNull();
  });

  it("renders nothing while the catalog is the offline fallback", async () => {
    // An unreachable backend must not open the Studio — the fallback is never a Creator.
    apiFetch.mockRejectedValue(new Error("offline"));
    render(<CreatorStudioPanel />);
    await waitFor(() => expect(apiFetch).toHaveBeenCalled());
    expect(screen.queryByTestId("creator-studio")).toBeNull();
  });

  it("renders for a Creator", async () => {
    await mount(answer());
    expect(screen.getByTestId("creator-studio")).toBeInTheDocument();
  });
});

describe("what a season's row says", () => {
  it("shows an unbuilt season as not built yet, with publishing disabled", async () => {
    await mount(answer());
    expect(screen.getByTestId("creator-season-state-halloween")).toHaveTextContent("Not built yet");
    expect(screen.getByRole("button", { name: "Publish" })).toBeDisabled();
  });

  it("shows a built, unpublished season as the Creator's own preview", async () => {
    await mount(answer({ publications: [READY], previewable: ["halloween"] }));
    expect(screen.getByTestId("creator-season-state-halloween")).toHaveTextContent("only you");
    expect(screen.getByRole("button", { name: "Publish" })).toBeEnabled();
  });

  it("shows a published season with who last changed it", async () => {
    await mount(answer({ publications: [PUBLISHED], available: ["v2", "classic", "halloween"] }));
    const state = screen.getByTestId("creator-season-state-halloween");
    expect(state).toHaveTextContent("Published to everyone");
    expect(state).toHaveTextContent("creator@example.com");
    expect(screen.getByRole("button", { name: "Unpublish" })).toBeEnabled();
  });
});

describe("publishing", () => {
  it("sends the change and adopts the catalog the server answered with", async () => {
    await mount(answer({ publications: [READY], previewable: ["halloween"] }));
    apiFetch.mockResolvedValueOnce(
      ok(answer({ publications: [PUBLISHED], available: ["v2", "classic", "halloween"] })),
    );
    fireEvent.click(screen.getByRole("button", { name: "Publish" }));

    await waitFor(() =>
      expect(screen.getByTestId("creator-season-state-halloween")).toHaveTextContent("Published"),
    );
    expect(apiFetch).toHaveBeenLastCalledWith(
      "http://vo-backend.test/office/experience/halloween/publication",
      expect.objectContaining({ method: "PUT", body: JSON.stringify({ published: true }) }),
    );
    expect(screen.getByTestId("creator-studio-done")).toHaveTextContent("published");
  });

  it("shows the server's refusal verbatim and changes nothing", async () => {
    await mount(answer({ publications: [READY] }));
    apiFetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: async () => ({ error: "'halloween' has no decoration layer in this build." }),
    });
    fireEvent.click(screen.getByRole("button", { name: "Publish" }));

    expect(await screen.findByTestId("creator-studio-error")).toHaveTextContent("no decoration layer");
    expect(screen.queryByTestId("creator-studio-done")).toBeNull();
    expect(screen.getByTestId("creator-season-state-halloween")).toHaveTextContent("only you");
  });

  it("adopts a default the server moved when the current default was unpublished", async () => {
    // The atomic restore, as the Studio sees it: one call, and the default line moves with the row.
    await mount(
      answer({
        publications: [PUBLISHED],
        available: ["v2", "classic", "halloween"],
        default: "halloween",
      }),
    );
    expect(screen.getByTestId("creator-default-state")).toHaveTextContent("Halloween");

    apiFetch.mockResolvedValueOnce(ok(answer({ publications: [READY], default: "v2" })));
    fireEvent.click(screen.getByRole("button", { name: "Unpublish" }));

    await waitFor(() =>
      expect(screen.getByTestId("creator-default-state")).toHaveTextContent("3D Office"),
    );
  });
});

describe("the company default", () => {
  it("offers only what is available, and not the one already selected", async () => {
    await mount(answer());
    expect(screen.getByTestId("creator-default-v2")).toBeDisabled(); // it is the current default
    expect(screen.getByTestId("creator-default-classic")).toBeEnabled();
    expect(screen.queryByTestId("creator-default-halloween")).toBeNull();
  });

  it("sets a new default", async () => {
    await mount(answer());
    apiFetch.mockResolvedValueOnce(ok(answer({ default: "classic" })));
    fireEvent.click(screen.getByTestId("creator-default-classic"));

    await waitFor(() =>
      expect(screen.getByTestId("creator-default-state")).toHaveTextContent("Classic Office"),
    );
    expect(apiFetch).toHaveBeenLastCalledWith(
      "http://vo-backend.test/office/experience/default",
      expect.objectContaining({ body: JSON.stringify({ experience: "classic" }) }),
    );
  });

  it("restores the 3D office", async () => {
    await mount(answer({ default: "classic" }));
    apiFetch.mockResolvedValueOnce(ok(answer({ default: "v2" })));
    fireEvent.click(screen.getByTestId("creator-default-v2"));

    expect(await screen.findByTestId("creator-studio-done")).toHaveTextContent(
      "3D Office is the company default again",
    );
  });
});

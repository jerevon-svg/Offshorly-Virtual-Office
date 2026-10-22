import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CharacterStatus } from "../../services/humanbase/characterStudio";

// CHARACTER STUDIO MODES on the Profile's character panel. WebGL is absent in jsdom: both 3D stages are stood in.
vi.mock("../../render3d/CharacterCanvas", () => ({ CharacterCanvas: () => <div data-testid="character-canvas" /> }));
vi.mock("./CharacterStudio/HumanBasePreview", () => ({
  HumanBasePreview: (p: { subject: { kind: string; personId?: string } }) => <div data-testid="humanbase-preview" data-subject={p.subject.kind} data-person={p.subject.personId ?? ""} />,
}));
// promotion is an admin act that writes humanMounts.generated.json (empty today) — a test promotes by stubbing hasHumanBody
const hb = vi.hoisted(() => ({ promoted: new Set<string>() }));
vi.mock("../../dev/vo3d/avatar/humanBody", async (orig) => {
  const real = await orig<typeof import("../../dev/vo3d/avatar/humanBody")>();
  return { ...real, hasHumanBody: (id: string | null | undefined, search?: string) => (!!id && hb.promoted.has(id)) || real.hasHumanBody(id, search) };
});
const api = vi.hoisted(() => ({ getCharacterStatus: vi.fn(), fetchPhotoTraceUrl: vi.fn(async () => null) }));
vi.mock("../../services/avatar/wardrobeClient", () => ({ getMyWardrobe: vi.fn(async () => ({ nickname: null, outfit: {} })), saveMyWardrobe: vi.fn() }));
vi.mock("../../services/humanbase/characterStudio", async (orig) => ({ ...(await orig<typeof import("../../services/humanbase/characterStudio")>()), ...api }));

import { ProfileCharacter } from "./ProfileCharacter";
import { registerRuntimeAvatars, resetCharacterRuntimeForTests } from "../../dev/vo3d/avatar/characterRuntime";

const BON = "jerevon@offshorly.com";
const NEW = "new.hire@offshorly.com";
const status = (over: Partial<CharacterStatus> = {}): CharacterStatus => ({
  personId: "newhire", email: NEW, approvedAvatar: false, records: false,
  photo: null, photoTrace: null, photoTraceJob: null, pipeline: null, plan: null, simulated: [], gate: null, candidate: null, ...over,
});

beforeEach(() => { api.getCharacterStatus.mockReset(); hb.promoted.clear(); vi.stubEnv("VITE_CHARACTER_STUDIO", "1"); });
afterEach(() => vi.unstubAllEnvs());

describe("ProfileCharacter — Character Studio modes", () => {
  it("switched off, VIEW is exactly the production panel and the Studio is never asked", () => {
    vi.stubEnv("VITE_CHARACTER_STUDIO", "");
    render(<ProfileCharacter email={BON} fallbackSrc="/p.png" name="Bon" isSelf />);
    expect(screen.getByTestId("character-canvas")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
    expect(api.getCharacterStatus).not.toHaveBeenCalled();
  });

  it("someone else's profile never asks the Studio", () => {
    render(<ProfileCharacter email={NEW} fallbackSrc="/p.png" name="New Hire" />);
    expect(api.getCharacterStatus).not.toHaveBeenCalled();
    expect(screen.getByTestId("profile-character")).toBeInTheDocument();
  });

  it("a first-time person (no character anywhere) lands in CREATE", async () => {
    api.getCharacterStatus.mockResolvedValue(status());
    render(<ProfileCharacter email={NEW} fallbackSrc="/p.png" name="New Hire" isSelf />);
    expect(await screen.findByTestId("character-create")).toBeInTheDocument();
  });

  it("a Studio answer for a DIFFERENT person is ignored — the panel stays on VIEW", async () => {
    api.getCharacterStatus.mockResolvedValue(status({ email: "someone.else@offshorly.com", personId: "someoneelse" }));
    render(<ProfileCharacter email={NEW} fallbackSrc="/p.png" name="New Hire" isSelf />);
    await waitFor(() => expect(api.getCharacterStatus).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByTestId("character-create")).toBeNull();
    expect(screen.queryByRole("button", { name: /edit|create/i })).toBeNull();
  });

  it("an approved person keeps VIEW, with Edit opening EDIT on their own approved character", async () => {
    api.getCharacterStatus.mockResolvedValue(status({ personId: "bon", email: BON, approvedAvatar: true, records: true }));
    render(<ProfileCharacter email={BON} fallbackSrc="/p.png" name="Bon" isSelf />);
    expect(screen.getByTestId("character-canvas")).toBeInTheDocument();
    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    expect(screen.getByTestId("character-edit")).toBeInTheDocument();
    expect(screen.getByTestId("humanbase-preview")).toHaveAttribute("data-subject", "approved");
    expect(screen.getByTestId("humanbase-preview")).toHaveAttribute("data-person", "bon");
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(screen.getByTestId("character-canvas")).toBeInTheDocument();
  });

  it("a HumanBase-only employee shows their approved HumanBase character in VIEW instead of the 2D portrait", () => {
    hb.promoted.add("lui");
    render(<ProfileCharacter email="louiejie@offshorly.com" fallbackSrc="/p.png" name="Lui" />);
    expect(screen.getByTestId("humanbase-preview")).toHaveAttribute("data-person", "lui");
    expect(screen.getByRole("group", { name: "Character pose" })).toBeInTheDocument();
  });
});

describe("ProfileCharacter — approved at runtime (not promoted)", () => {
  it("a new employee whose head was signed off is shown as their own HumanBase character in VIEW, never a placeholder", async () => {
    vi.stubEnv("VITE_CHARACTER_STUDIO", "1");
    registerRuntimeAvatars([{ castId: "newhire", email: NEW, url: "/x/newhire-v1.glb", head: { artifactHash: "a", pipelineVersion: "p", mount: { scale: 0.9, pitchDeg: 0 }, bindingHash: "b", validatedAt: "t" } }], () => false);
    api.getCharacterStatus.mockResolvedValue(status({ approvedAvatar: true, records: true }));
    render(<ProfileCharacter email={NEW} fallbackSrc="/p.png" name="New Hire" isSelf />);
    expect(await screen.findByTestId("humanbase-preview")).toHaveAttribute("data-person", "newhire");
    expect(screen.queryByTestId("character-create")).toBeNull();
    resetCharacterRuntimeForTests();
  });
});

describe("ProfileCharacter — not yet promoted", () => {
  it("a HumanBase-only employee who is not promoted keeps the 2D portrait (nothing unapproved is shown)", () => {
    vi.stubEnv("VITE_CHARACTER_STUDIO", "1");
    render(<ProfileCharacter email="esson@offshorly.com" fallbackSrc="/p.png" name="Esson" />);
    expect(screen.queryByTestId("humanbase-preview")).toBeNull();
    expect(screen.getByAltText("Esson's character")).toBeInTheDocument();
  });
});

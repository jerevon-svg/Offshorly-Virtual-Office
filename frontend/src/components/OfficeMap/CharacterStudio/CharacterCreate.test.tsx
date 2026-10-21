import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { CharacterStatus, StudioCandidate } from "../../../services/humanbase/characterStudio";

// the 3D stage is WebGL (absent in jsdom): stand it in with what it was asked to show
vi.mock("./HumanBasePreview", () => ({
  HumanBasePreview: (p: { subject: { kind: string }; reveal?: boolean }) => <div data-testid="preview" data-subject={p.subject.kind} data-reveal={String(!!p.reveal)} />,
}));
const api = vi.hoisted(() => ({ getCharacterStatus: vi.fn(), uploadCharacterPhoto: vi.fn(), startCharacterPipeline: vi.fn(), fetchPhotoTraceUrl: vi.fn(async () => null) }));
vi.mock("../../../services/humanbase/characterStudio", async (orig) => ({ ...(await orig<typeof import("../../../services/humanbase/characterStudio")>()), ...api }));

const gen = vi.hoisted(() => ({ recordPhotoConsent: vi.fn(), sha256Hex: vi.fn(async () => "f".repeat(64)) }));
vi.mock("../../../services/avatar/generationClient", () => gen);

import { CharacterCreate, stepStates } from "./CharacterCreate";

const status = (over: Partial<CharacterStatus> = {}): CharacterStatus => ({
  personId: "newhire", email: "new.hire@offshorly.com", approvedAvatar: false, records: true,
  photo: null, photoTrace: null, photoTraceJob: null, pipeline: null, plan: null, simulated: [], gate: null, candidate: null, ...over,
});
const candidate: StudioCandidate = {
  file: "scripts/x/newhire-v1.glb", tag: "corr-v1", mount: { scale: 1, pitchDeg: 0 }, bodyPreset: "standard", automatedPass: true,
  artifactHash: "a", pipelineVersion: "p", bindingHash: "b", builtAt: "2026-10-13T00:00:00Z",
};
const reviewed = (over: Partial<CharacterStatus> = {}) =>
  status({ photo: "u.jpg", pipeline: { status: "complete", error: null }, plan: { stage: null, action: "complete", reason: "" }, candidate, gate: { automatedPass: true, failed: [], signoff: ["FC-EAR-BOUNDARY"] }, ...over });

beforeEach(() => { for (const f of Object.values(api)) f.mockReset(); api.fetchPhotoTraceUrl.mockResolvedValue(null); gen.recordPhotoConsent.mockReset().mockResolvedValue({}); });

describe("CREATE", () => {
  it("starts with a photo, over the BASE character that is labelled as not the person", async () => {
    api.getCharacterStatus.mockResolvedValue(status());
    api.uploadCharacterPhoto.mockResolvedValue(status({ photo: "u.jpg", photoTraceJob: "running" }));
    render(<CharacterCreate name="Lee Park" onApproved={() => {}} />);
    expect(await screen.findByText("Start with a photo")).toBeInTheDocument();
    expect(screen.getByTestId("preview")).toHaveAttribute("data-subject", "base");
    expect(screen.getByText("Base character — not you yet")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Body"), { target: { value: "feminine" } });
    expect(screen.getByRole("button", { name: "Choose photo" })).toBeDisabled();       // no consent, no photo
    fireEvent.click(screen.getByRole("checkbox", { name: /this is a photo of me/i }));
    expect(screen.getByRole("button", { name: "Choose photo" })).toBeEnabled();
    const photo = new File([new Uint8Array(2048)], "me.jpg", { type: "image/jpeg" });
    fireEvent.change(screen.getByLabelText("Photo"), { target: { files: [photo] } });
    await waitFor(() => expect(api.uploadCharacterPhoto).toHaveBeenCalledWith(photo, { hair: "natural", body: "feminine" }));
    expect(gen.recordPhotoConsent).toHaveBeenCalledWith("f".repeat(64));               // recorded against the exact bytes, first
    expect(gen.recordPhotoConsent.mock.invocationCallOrder[0]).toBeLessThan(api.uploadCharacterPhoto.mock.invocationCallOrder[0]);
    expect(await screen.findByText("Reading your face…")).toBeInTheDocument();
  });

  it("a consent the office could not record means the photo is not sent", async () => {
    api.getCharacterStatus.mockResolvedValue(status());
    gen.recordPhotoConsent.mockRejectedValue(new Error("The office backend did not answer (503)."));
    render(<CharacterCreate name="Lee Park" onApproved={() => {}} />);
    await screen.findByText("Start with a photo");
    fireEvent.click(screen.getByRole("checkbox", { name: /this is a photo of me/i }));
    fireEvent.change(screen.getByLabelText("Photo"), { target: { files: [new File([new Uint8Array(2048)], "me.jpg", { type: "image/jpeg" })] } });
    expect(await screen.findByText(/your consent could not be recorded/i)).toBeInTheDocument();
    expect(api.uploadCharacterPhoto).not.toHaveBeenCalled();
  });

  it("never spends credits: a paid stage shows who approves it and offers no way to run it", async () => {
    api.getCharacterStatus.mockResolvedValue(
      status({ photo: "u.jpg", photoTrace: "t.png", pipeline: { status: "awaiting-approval:meshy", error: null }, plan: { stage: "meshy", action: "needs-approval", reason: "", cost: "≈30 Meshy credits" } }),
    );
    render(<CharacterCreate name="Lee Park" onApproved={() => {}} />);
    expect(await screen.findByText("Waiting for approval")).toBeInTheDocument();
    expect(screen.getByText(/nothing is spent until then/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /generate|continue|try again/i })).toBeNull();
  });

  it("a failed step says why and resumes from that step", async () => {
    api.getCharacterStatus.mockResolvedValue(status({ photo: "u.jpg", pipeline: { status: "failed:build", error: "gate failed closed" }, plan: { stage: "build", action: "run", reason: "" } }));
    api.startCharacterPipeline.mockResolvedValue(status({ photo: "u.jpg", pipeline: { status: "running", error: null }, plan: { stage: "build", action: "run", reason: "" } }));
    render(<CharacterCreate name="Lee Park" onApproved={() => {}} />);
    expect(await screen.findByText("gate failed closed")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(api.startCharacterPipeline).toHaveBeenCalledTimes(1));
    expect(await screen.findByText("Creating your character")).toBeInTheDocument();
  });

  it("reveals the person's own generated character, labelled as awaiting sign-off", async () => {
    api.getCharacterStatus.mockResolvedValue(reviewed());
    render(<CharacterCreate name="Lee Park" onApproved={() => {}} />);
    expect(await screen.findByText("Your character passed the automatic checks")).toBeInTheDocument();
    expect(screen.getByTestId("preview")).toHaveAttribute("data-subject", "candidate");
    expect(screen.getByTestId("preview")).toHaveAttribute("data-reveal", "true");
    expect(screen.getByText("Lee · awaiting sign-off")).toBeInTheDocument();
    expect(screen.getByText(/signs off the ears/)).toBeInTheDocument();
  });

  it("a run with simulated stages is never presented as the person's face", async () => {
    api.getCharacterStatus.mockResolvedValue(reviewed({ simulated: ["illustrate", "meshy"] }));
    render(<CharacterCreate name="Lee Park" onApproved={() => {}} />);
    expect(await screen.findByText("Test run — not your face (illustrate, meshy simulated)")).toBeInTheDocument();
    expect(screen.queryByText("Lee · awaiting sign-off")).toBeNull();
  });

  it("hands over to VIEW once the character is approved", async () => {
    api.getCharacterStatus.mockResolvedValue(status({ approvedAvatar: true }));
    const onApproved = vi.fn();
    render(<CharacterCreate name="Lee Park" onApproved={onApproved} />);
    await waitFor(() => expect(onApproved).toHaveBeenCalled());
  });

  it("an unreachable Studio is a safe, retryable failure", async () => {
    api.getCharacterStatus.mockRejectedValueOnce(new Error("Character Studio answered 502")).mockResolvedValue(status());
    render(<CharacterCreate name="Lee Park" onApproved={() => {}} />);
    expect(await screen.findByText("Character Studio isn't reachable")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("Start with a photo")).toBeInTheDocument();
  });
});

describe("progress steps", () => {
  it("are read from real status fields", () => {
    expect(stepStates(status({ photo: "u.jpg", photoTraceJob: "running" }), "reading-photo")).toEqual(["done", "active", "todo", "todo"]);
    const waiting = status({ photo: "u.jpg", photoTrace: "t.png", pipeline: { status: "awaiting-approval:illustrate", error: null }, plan: { stage: "illustrate", action: "needs-approval", reason: "" } });
    expect(stepStates(waiting, "awaiting-approval")).toEqual(["done", "done", "wait", "todo"]);
    const building = status({ photo: "u.jpg", photoTrace: "t.png", pipeline: { status: "running", error: null }, plan: { stage: "build", action: "run", reason: "" } });
    expect(stepStates(building, "generating")).toEqual(["done", "done", "done", "active"]);
    expect(stepStates(reviewed(), "review")).toEqual(["done", "done", "done", "done"]);
  });
});

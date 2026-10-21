import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { CharacterStatus, StudioCandidate } from "../../../services/humanbase/characterStudio";
import { PROOF_CATALOGUE } from "../../../dev/vo3d/human/humanCatalogue";

const previews: Array<{ subject: { kind: string }; outfit?: Record<string, { assetId: string; colorway: string }> }> = [];
vi.mock("./HumanBasePreview", () => ({
  HumanBasePreview: (p: { subject: { kind: string }; outfit?: Record<string, { assetId: string; colorway: string }> }) => {
    previews.push(p);
    return <div data-testid="preview" data-subject={p.subject.kind} data-top={p.outfit?.top ? `${p.outfit.top.assetId}/${p.outfit.top.colorway}` : ""} />;
  },
}));
const api = vi.hoisted(() => ({ getMyWardrobe: vi.fn(), saveMyWardrobe: vi.fn() }));
vi.mock("../../../services/avatar/wardrobeClient", () => api);

import { CharacterEdit, editSubject, garmentsFor } from "./CharacterEdit";
import { outfitFor, resetCharacterRuntimeForTests } from "../../../dev/vo3d/avatar/characterRuntime";

const status = (over: Partial<CharacterStatus> = {}): CharacterStatus => ({
  personId: "bon", email: "jerevon@offshorly.com", approvedAvatar: true, records: true,
  photo: null, photoTrace: null, photoTraceJob: null, pipeline: null, plan: null, simulated: [], gate: null, candidate: null, ...over,
});
const candidate: StudioCandidate = {
  file: "scripts/x/newhire-v1.glb", tag: "corr-v1", mount: { scale: 1, pitchDeg: 0 }, bodyPreset: "standard", automatedPass: true,
  artifactHash: "a", pipelineVersion: "p", bindingHash: "b", builtAt: "2026-10-13T00:00:00Z",
};

beforeEach(() => { api.getMyWardrobe.mockReset().mockResolvedValue({ nickname: null, outfit: {} }); api.saveMyWardrobe.mockReset(); previews.length = 0; resetCharacterRuntimeForTests(); });

describe("EDIT", () => {
  it("offers exactly the catalogue's wearable garments — no list kept in the UI", () => {
    for (const slot of ["top", "bottom", "shoes"] as const)
      expect(garmentsFor(slot).map((g) => g.id)).toEqual(PROOF_CATALOGUE.filter((a) => a.slot === slot && a.colorways).map((a) => a.id));
    expect(garmentsFor("top").length).toBeGreaterThan(0);
  });

  it("dresses the approved character; a candidate only when real; otherwise the labelled base — never someone else", () => {
    expect(editSubject(status())).toEqual({ kind: "approved", personId: "bon" });
    const fresh = status({ personId: "newhire", email: "new.hire@offshorly.com", approvedAvatar: false, candidate });
    expect(editSubject(fresh).kind).toBe("candidate");
    expect(editSubject({ ...fresh, simulated: ["meshy"] }).kind).toBe("base");
    expect(editSubject({ ...fresh, candidate: null }).kind).toBe("base");
  });

  it("previews a change live, saves only on Save, and never touches the head", async () => {
    api.saveMyWardrobe.mockImplementation(async (w) => ({ ...w, savedAt: "2026-10-13T00:00:00Z" }));
    render(<CharacterEdit status={status()} name="Bon" onClose={() => {}} />);
    await waitFor(() => expect(screen.getByLabelText("Top garment")).toBeEnabled());
    const save = screen.getByRole("button", { name: "Save" });
    expect(save).toBeDisabled();
    const tops = garmentsFor("top");
    const tee = tops.find((g) => g.id === "tee-offshorly") ?? tops[0];
    fireEvent.change(screen.getByLabelText("Top garment"), { target: { value: tee.id } });
    const colour = Object.keys(tee.colorways!).at(-1)!;
    fireEvent.click(screen.getByRole("radio", { name: colour }));
    expect(screen.getByTestId("preview")).toHaveAttribute("data-top", `${tee.id}/${colour}`);
    expect(screen.getByText("Previewing — not saved yet.")).toBeInTheDocument();
    expect(api.saveMyWardrobe).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Nickname"), { target: { value: "  Bonbon  " } });
    fireEvent.click(save);
    await waitFor(() => expect(api.saveMyWardrobe).toHaveBeenCalledTimes(1));
    const sent = api.saveMyWardrobe.mock.calls[0][0];
    expect(sent.nickname).toBe("Bonbon");
    expect(sent.outfit.top).toEqual({ assetId: tee.id, colorway: colour });
    expect(Object.keys(sent)).toEqual(["nickname", "outfit"]);
    expect(await screen.findByText(/^Saved/)).toBeInTheDocument();
  });

  it("a save dresses the office's own character (and only it) and re-dresses the live body", async () => {
    api.saveMyWardrobe.mockImplementation(async (w) => ({ ...w, updatedAt: "2026-10-13T00:00:00Z" }));
    const seen: Array<{ castId: string }> = []; const on = (e: Event) => seen.push((e as CustomEvent).detail); window.addEventListener("vo:character-outfit", on);
    render(<CharacterEdit status={status()} name="Bon" onClose={() => {}} />);
    await waitFor(() => expect(screen.getByLabelText("Top garment")).toBeEnabled());
    const hoodie = garmentsFor("top").find((g) => g.id === "hoodie-crrn")!;
    fireEvent.change(screen.getByLabelText("Top garment"), { target: { value: hoodie.id } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(outfitFor("bon")?.top?.assetId).toBe("hoodie-crrn"));
    expect(seen.map((d) => d.castId)).toEqual(["bon"]);
    expect(outfitFor("micah")).toBeNull();
    window.removeEventListener("vo:character-outfit", on);
  });

  it("Done without Save is a cancel: nothing is written and the office is not re-dressed", async () => {
    const onClose = vi.fn(); const seen: unknown[] = []; const on = (e: Event) => seen.push(e); window.addEventListener("vo:character-outfit", on);
    render(<CharacterEdit status={status()} name="Bon" onClose={onClose} />);
    await waitFor(() => expect(screen.getByLabelText("Top garment")).toBeEnabled());
    fireEvent.change(screen.getByLabelText("Top garment"), { target: { value: "hoodie-crrn" } });
    fireEvent.change(screen.getByLabelText("Nickname"), { target: { value: "Changed" } });
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(api.saveMyWardrobe).not.toHaveBeenCalled(); expect(seen).toEqual([]); expect(outfitFor("bon")).toBeNull();
    window.removeEventListener("vo:character-outfit", on);
  });

  it("a failed save says why and leaves the office untouched", async () => {
    api.saveMyWardrobe.mockRejectedValue(new Error("Saving your character failed (503)."));
    render(<CharacterEdit status={status()} name="Bon" onClose={() => {}} />);
    await waitFor(() => expect(screen.getByLabelText("Top garment")).toBeEnabled());
    fireEvent.change(screen.getByLabelText("Top garment"), { target: { value: "hoodie-crrn" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Saving your character failed (503).")).toBeInTheDocument();
    expect(outfitFor("bon")).toBeNull();
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
  });

  it("keeps the controls disabled until the saved wardrobe has loaded, so a late answer never overwrites an edit", async () => {
    let resolve!: (w: unknown) => void; api.getMyWardrobe.mockReturnValue(new Promise((r) => { resolve = r; }));
    render(<CharacterEdit status={status()} name="Bon" onClose={() => {}} />);
    expect(screen.getByLabelText("Top garment")).toBeDisabled();
    resolve({ nickname: "B", outfit: {} });
    await waitFor(() => expect(screen.getByLabelText("Top garment")).toBeEnabled());
    expect(screen.getByLabelText("Nickname")).toHaveValue("B");
  });

  it("loads the saved wardrobe, ignoring anything the catalogue does not carry", async () => {
    const tee = garmentsFor("top").find((g) => g.id === "tee-offshorly") ?? garmentsFor("top")[0];
    const cw = Object.keys(tee.colorways!)[1];
    api.getMyWardrobe.mockResolvedValue({ nickname: "B", outfit: { top: { assetId: tee.id, colorway: cw }, shoes: { assetId: "rocket-boots", colorway: "red" } } });
    render(<CharacterEdit status={status()} name="Bon" onClose={() => {}} />);
    await waitFor(() => expect(screen.getByTestId("preview")).toHaveAttribute("data-top", `${tee.id}/${cw}`));
    expect(screen.getByLabelText("Nickname")).toHaveValue("B");
    expect(previews.at(-1)?.outfit?.shoes?.assetId).not.toBe("rocket-boots");
  });
});

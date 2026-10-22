// HR SERVICES — honest by default (every capability pending, nothing invented, nothing callable), the panel
// owns the keyboard while open, the backdrop takes the mouse, and with a live service a request is only
// ever "sent" once the service confirms it.
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Vo3dHrServices } from "./Vo3dHrServices";
import { PendingHrLeaveService, type HrLeaveService, type LeaveRequest } from "../../../services/hr";

afterEach(cleanup);

function pendingSpy() {
  const s = new PendingHrLeaveService();
  return {
    service: s,
    calls: [vi.spyOn(s, "listLeaveTypes"), vi.spyOn(s, "getLeaveBalance"), vi.spyOn(s, "listLeaveRequests"), vi.spyOn(s, "submitLeaveRequest")],
  };
}

const REQUEST: LeaveRequest = { id: "r1", leaveTypeName: "Annual", startDate: "2026-11-02", endDate: "2026-11-03", status: "pending", submittedAt: "2026-10-22T09:00:00Z" };

function liveService(overrides: Partial<HrLeaveService> = {}): HrLeaveService {
  return {
    availability: () => ({ state: "available" }),
    listLeaveTypes: vi.fn().mockResolvedValue([{ id: "t1", name: "Annual", unit: "day" }]),
    getLeaveBalance: vi.fn().mockResolvedValue([]),
    listLeaveRequests: vi.fn().mockResolvedValue([REQUEST]),
    submitLeaveRequest: vi.fn().mockResolvedValue(REQUEST),
    ...overrides,
  };
}

describe("Vo3dHrServices — integration pending (today's only state)", () => {
  it("home lists the three services, each marked pending, under an honest source chip", () => {
    const { service } = pendingSpy();
    render(<Vo3dHrServices service={service} onClose={() => {}} />);
    expect(screen.getByRole("dialog", { name: "HR Services" })).toBeTruthy();
    for (const v of ["apply", "requests", "balance"]) expect(screen.getByTestId(`hr-tile-${v}`).textContent).toContain("Pending");
    expect(screen.getByTestId("hr-source").textContent).toContain("Connection pending");
    expect(screen.queryByText("Request Early Out")).toBeNull(); // unsupported services are not offered
  });

  it("every section shows its pending state and never calls the service", () => {
    const { service, calls } = pendingSpy();
    render(<Vo3dHrServices service={service} onClose={() => {}} />);
    for (const v of ["requests", "balance", "apply"]) {
      fireEvent.click(screen.getByTestId(`hr-tile-${v}`));
      expect(screen.getByTestId("hr-pending")).toBeTruthy();
      fireEvent.click(screen.getByLabelText("Back to HR Services"));
    }
    for (const c of calls) expect(c).not.toHaveBeenCalled();
  });

  it("Apply for Leave: no invented leave types and a Submit that cannot be pressed", () => {
    const { service, calls } = pendingSpy();
    render(<Vo3dHrServices service={service} onClose={() => {}} />);
    fireEvent.click(screen.getByTestId("hr-tile-apply"));
    const select = screen.getByLabelText("Leave type") as HTMLSelectElement;
    expect(select.options).toHaveLength(1);
    expect(select.options[0].value).toBe("");
    const submit = screen.getByTestId("hr-submit") as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    expect(submit.textContent).toBe("Submission unavailable");
    fireEvent.click(submit);
    expect(calls[3]).not.toHaveBeenCalled();
    expect(screen.queryByTestId("hr-submitted")).toBeNull();
  });
});

describe("Vo3dHrServices — keyboard, mouse and focus", () => {
  it("Escape steps back from a section, then closes from home", () => {
    const onClose = vi.fn();
    render(<Vo3dHrServices service={new PendingHrLeaveService()} onClose={onClose} />);
    fireEvent.click(screen.getByTestId("hr-tile-balance"));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.getByTestId("hr-tile-balance")).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("keys never reach the world while it is open (movement, jump, E)", () => {
    const world = vi.fn();
    window.addEventListener("keydown", world);
    render(<Vo3dHrServices service={new PendingHrLeaveService()} onClose={() => {}} />);
    for (const key of ["w", "ArrowUp", " ", "e", "Shift"]) fireEvent.keyDown(window, { key });
    fireEvent.keyDown(screen.getByTestId("hr-tile-apply"), { key: "d" });
    expect(world).not.toHaveBeenCalled();
    cleanup();
    fireEvent.keyDown(window, { key: "w" });
    expect(world).toHaveBeenCalledTimes(1); // released on close
    window.removeEventListener("keydown", world);
  });

  it("a press on the backdrop closes it; a press inside the card does not", () => {
    const onClose = vi.fn();
    render(<Vo3dHrServices service={new PendingHrLeaveService()} onClose={onClose} />);
    fireEvent.pointerDown(screen.getByTestId("hr-services"));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.pointerDown(screen.getByTestId("hr-services-backdrop"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("focus starts inside the card and Tab wraps within it", () => {
    render(<Vo3dHrServices service={new PendingHrLeaveService()} onClose={() => {}} />);
    const card = screen.getByTestId("hr-services");
    expect(card.contains(document.activeElement)).toBe(true);
    const last = screen.getByTestId("hr-tile-balance");
    last.focus();
    fireEvent.keyDown(window, { key: "Tab" });
    expect(document.activeElement).toBe(screen.getByLabelText("Close HR Services"));
    fireEvent.keyDown(window, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(last);
  });
});

describe("Vo3dHrServices — once a capability is live", () => {
  const fill = async () => {
    fireEvent.click(screen.getByTestId("hr-tile-apply"));
    await waitFor(() => expect((screen.getByLabelText("Leave type") as HTMLSelectElement).options).toHaveLength(2));
    fireEvent.change(screen.getByLabelText("Leave type"), { target: { value: "t1" } });
  };

  it("validates before sending: an end date before the start is refused locally", async () => {
    const service = liveService();
    render(<Vo3dHrServices service={service} onClose={() => {}} />);
    await fill();
    fireEvent.change(screen.getByLabelText("Start date"), { target: { value: "2026-11-05" } });
    fireEvent.change(screen.getByLabelText("End date"), { target: { value: "2026-11-02" } });
    fireEvent.click(screen.getByTestId("hr-submit"));
    expect(screen.getByRole("alert").textContent).toContain("can't be before");
    expect(service.submitLeaveRequest).not.toHaveBeenCalled();
  });

  it("says 'sent' only after the service confirms, and a failed send is never shown as success", async () => {
    let reject!: (e: Error) => void;
    const submitLeaveRequest = vi.fn()
      .mockImplementationOnce(() => new Promise((_, r) => { reject = r; }))
      .mockResolvedValueOnce(REQUEST);
    const service = liveService({ submitLeaveRequest });
    render(<Vo3dHrServices service={service} onClose={() => {}} />);
    await fill();
    fireEvent.change(screen.getByLabelText("Start date"), { target: { value: "2026-11-02" } });
    fireEvent.change(screen.getByLabelText("End date"), { target: { value: "2026-11-03" } });
    fireEvent.click(screen.getByTestId("hr-submit"));
    expect(screen.getByTestId("hr-submit").textContent).toBe("Submitting…");
    expect(screen.queryByTestId("hr-submitted")).toBeNull();
    await act(async () => reject(new Error("503")));
    expect(screen.queryByTestId("hr-submitted")).toBeNull();
    expect(screen.getByRole("alert").textContent).toContain("wasn't filed");
    fireEvent.click(screen.getByTestId("hr-submit"));
    await waitFor(() => expect(screen.getByTestId("hr-submitted")).toBeTruthy());
    // the retry re-sent the SAME idempotency key, so a lost response cannot file the leave twice
    const [a, b] = submitLeaveRequest.mock.calls.map((c) => c[0].idempotencyKey);
    expect(a).toBeTruthy();
    expect(b).toBe(a);
    expect(submitLeaveRequest.mock.calls[0][0]).not.toHaveProperty("employeeId");
  });

  it("a failed read shows an error with retry, not empty data", async () => {
    const listLeaveRequests = vi.fn().mockRejectedValueOnce(new Error("503")).mockResolvedValueOnce([REQUEST]);
    render(<Vo3dHrServices service={liveService({ listLeaveRequests })} onClose={() => {}} />);
    fireEvent.click(screen.getByTestId("hr-tile-requests"));
    await waitFor(() => expect(screen.getByTestId("hr-error")).toBeTruthy());
    fireEvent.click(screen.getByText("Try again"));
    await waitFor(() => expect(screen.getByTestId("hr-requests").textContent).toContain("Pending"));
  });
});

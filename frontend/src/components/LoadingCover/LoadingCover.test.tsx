import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LoadingCover, LOADING_COVER_MAX_WAIT_MS, LOADING_COVER_TIPS } from "./LoadingCover";
import {
  __resetStartupSignalsForTest,
  setStartupSignal,
  STARTUP_STAGES,
} from "../../startup/startupReadiness";

vi.mock("../../assets/office/floor.png", () => ({ default: "floor.png" }));
vi.mock("../../assets/office/rooms/reception-room.png", () => ({ default: "reception.png" }));

function markAllReady() {
  act(() => {
    for (const stage of STARTUP_STAGES) setStartupSignal(stage.signal, true);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  __resetStartupSignalsForTest();
  vi.useRealTimers();
});

describe("LoadingCover", () => {
  it("shows the cover with real startup status while signals are pending", () => {
    render(<LoadingCover />);
    const cover = screen.getByTestId("loading-cover");
    expect(cover).toHaveAttribute("data-state", "loading");
    expect(screen.getByTestId("loading-cover-status")).toHaveTextContent(STARTUP_STAGES[0].status);
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "0");

    act(() => setStartupSignal("auth", true));
    expect(screen.getByTestId("loading-cover-status")).toHaveTextContent(STARTUP_STAGES[1].status);
    expect(Number(screen.getByRole("progressbar").getAttribute("aria-valuenow"))).toBeGreaterThan(0);
  });

  it("stays visible until every critical signal is ready, then fades and unmounts", () => {
    render(<LoadingCover />);
    act(() => {
      setStartupSignal("auth", true);
      setStartupSignal("roster", true);
      setStartupSignal("attendance", true);
      setStartupSignal("transform", true);
    });
    // selfPlaced still pending → cover stays.
    act(() => vi.advanceTimersByTime(5_000));
    expect(screen.getByTestId("loading-cover")).toHaveAttribute("data-state", "loading");

    act(() => setStartupSignal("selfPlaced", true));
    expect(screen.getByTestId("loading-cover")).toHaveAttribute("data-state", "done");
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "100");

    act(() => vi.advanceTimersByTime(1_000));
    expect(screen.queryByTestId("loading-cover")).toBeNull();
  });

  it("does not add a delay once ready (no artificial minimum display time)", () => {
    markAllReady();
    render(<LoadingCover />);
    expect(screen.getByTestId("loading-cover")).toHaveAttribute("data-state", "done");
    act(() => vi.advanceTimersByTime(1_000));
    expect(screen.queryByTestId("loading-cover")).toBeNull();
  });

  it("falls back to showing the office after the safety cap if a signal never resolves", () => {
    render(<LoadingCover />);
    act(() => setStartupSignal("auth", true));
    act(() => vi.advanceTimersByTime(LOADING_COVER_MAX_WAIT_MS - 1));
    expect(screen.getByTestId("loading-cover")).toHaveAttribute("data-state", "loading");
    act(() => vi.advanceTimersByTime(1));
    expect(screen.getByTestId("loading-cover")).toHaveAttribute("data-state", "done");
  });

  it("does not start the safety cap before the auth gate opens", () => {
    render(<LoadingCover />);
    act(() => vi.advanceTimersByTime(LOADING_COVER_MAX_WAIT_MS * 2));
    expect(screen.getByTestId("loading-cover")).toHaveAttribute("data-state", "loading");
  });

  it("rotates tips while loading", () => {
    render(<LoadingCover />);
    expect(screen.getByTestId("loading-cover-tip")).toHaveTextContent(LOADING_COVER_TIPS[0]);
    act(() => vi.advanceTimersByTime(4_000));
    expect(screen.getByTestId("loading-cover-tip")).toHaveTextContent(LOADING_COVER_TIPS[1]);
  });
});

import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { ErrorBoundary } from "./ErrorBoundary";

function Bomb(): never {
  throw new Error("boom");
}

function Safe() {
  return <div>all good</div>;
}

describe("ErrorBoundary", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders children normally when no error occurs", () => {
    render(
      <ErrorBoundary>
        <Safe />
      </ErrorBoundary>,
    );

    expect(screen.getByText("all good")).toBeInTheDocument();
  });

  it("renders the fallback UI (not the crashed children) when a child throws", () => {
    // React logs the caught error to console.error itself (dev warning) in
    // addition to our own componentDidCatch logging — suppress noise here
    // and assert on the call below instead.
    vi.spyOn(console, "error").mockImplementation(() => {});

    render(
      <ErrorBoundary>
        <Bomb />
      </ErrorBoundary>,
    );

    expect(screen.getByText("Something went wrong. Please refresh the page.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reload" })).toBeInTheDocument();
    expect(screen.queryByText("all good")).not.toBeInTheDocument();
  });

  it("catches a throw from a checkout-panel-shaped child instead of white-screening the app (App.tsx wraps the whole tree in this same boundary)", () => {
    // No checkout component is scoped to its own boundary today — the
    // checkout flow relies on App.tsx's top-level ErrorBoundary (see
    // App.tsx) to avoid a white screen, same mechanism the PiP camera's
    // dedicated boundary in OfficeMap.tsx uses. This proves that shared
    // mechanism catches an error thrown deep in a checkout-shaped subtree.
    vi.spyOn(console, "error").mockImplementation(() => {});

    function CheckoutPanelBomb(): never {
      throw new Error("submitTimeLogs threw unexpectedly mid-render");
    }

    render(
      <ErrorBoundary>
        <div>
          <CheckoutPanelBomb />
        </div>
      </ErrorBoundary>,
    );

    expect(screen.getByText("Something went wrong. Please refresh the page.")).toBeInTheDocument();
  });

  it("logs the error via console.error for diagnosability", () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    render(
      <ErrorBoundary>
        <Bomb />
      </ErrorBoundary>,
    );

    const loggedOurMessage = consoleErrorSpy.mock.calls.some((call) =>
      call.some((arg) => typeof arg === "string" && arg.includes("ErrorBoundary caught an error")),
    );
    expect(loggedOurMessage).toBe(true);
  });
});

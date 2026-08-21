import { Component, type ErrorInfo, type ReactNode } from "react";

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
}

// Generic, reusable error boundary. React only supports error boundaries as
// class components (no hook equivalent exists) — this is intentionally not
// specific to any one subtree so it can be reused elsewhere if another catch
// point is ever needed.
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: unknown, errorInfo: ErrorInfo): void {
    // Main goal: give us a real stack trace to diagnose future crashes —
    // right now an uncaught render/effect error just blanks the whole page
    // with zero visibility into what threw.
    console.error("ErrorBoundary caught an error:", error, errorInfo.componentStack);
  }

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            height: "100vh",
            textAlign: "center",
            fontFamily: "sans-serif",
          }}
        >
          <p>Something went wrong. Please refresh the page.</p>
          <button onClick={() => window.location.reload()}>Reload</button>
        </div>
      );
    }

    return this.props.children;
  }
}

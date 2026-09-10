import { Component, type ErrorInfo, type ReactNode } from "react";

interface ErrorBoundaryProps {
  children: ReactNode;
  // Optional local fallback. Without it the boundary renders the full-page "refresh" panel
  // (App.tsx root). With it, the boundary is scoped to its subtree: the fallback gets a `retry`
  // that clears the error and re-renders the children, so one crashed feature (e.g. a lazy chunk
  // that failed to load) is contained instead of blanking the whole office.
  fallback?: (retry: () => void) => ReactNode;
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

  retry = (): void => {
    this.setState({ hasError: false });
  };

  render(): ReactNode {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback(this.retry);
      }
      return (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            height: "100vh",
            textAlign: "center",
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

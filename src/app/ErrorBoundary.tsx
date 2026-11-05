import { Component, type ErrorInfo, type ReactNode } from "react";

type State = { error: Error | null };

/**
 * Keeps a rendering bug from leaving a blank window. Notes are saved to disk as
 * you go, so reloading the window loses nothing that was already saved.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Engineer's Notebook hit an error", error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="empty-state" role="alert" style={{ height: "100%" }}>
        <div>
          <h2>Something went wrong</h2>
          <p>
            The notebook hit an unexpected error. Your pages are saved as you go, so reloading is
            safe.
            <br />
            <code>{this.state.error.message}</code>
          </p>
          <div className="actions">
            <button className="pill primary" onClick={() => window.location.reload()}>
              Reload
            </button>
          </div>
        </div>
      </div>
    );
  }
}

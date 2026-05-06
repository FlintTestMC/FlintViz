import { Component, type ErrorInfo, type ReactNode } from "react";

// Per-pane error boundary so a render-time failure in one part of the UI
// (3D, editor, sidebar) doesn't blank out the whole app (#0033). Renders a
// compact error card by default; pass a `fallback` to customise.

interface Props {
  label?: string;
  fallback?: (err: Error, reset: () => void) => ReactNode;
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: unknown): State {
    return {
      error: error instanceof Error ? error : new Error(String(error)),
    };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Surface stack to the console for debugging — toast channel is for
    // user-facing recoverable errors only.
    console.error(`ErrorBoundary[${this.props.label ?? "?"}]`, error, info);
  }

  reset = () => this.setState({ error: null });

  render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;
    if (this.props.fallback) return this.props.fallback(error, this.reset);
    return (
      <div className="flex h-full w-full items-center justify-center p-4">
        <div className="max-w-md rounded-md bg-red-950/40 p-4 text-xs text-red-200 ring-1 ring-red-800/60">
          <div className="mb-1 font-semibold">
            {this.props.label ? `${this.props.label} — ` : ""}Something broke.
          </div>
          <div className="mb-2 whitespace-pre-wrap font-mono text-[11px] text-red-300">
            {error.message}
          </div>
          <button
            type="button"
            onClick={this.reset}
            className="rounded bg-red-900/60 px-2 py-1 text-[11px] text-red-100 hover:bg-red-900"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }
}

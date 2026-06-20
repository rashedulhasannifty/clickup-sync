import React from 'react';
import { AlertOctagon, RotateCcw } from 'lucide-react';

interface FallbackProps {
  error: Error;
  /** Clears the boundary's error state and re-renders children. */
  reset: () => void;
}

interface ErrorBoundaryProps {
  children: React.ReactNode;
  /**
   * Custom fallback. Receives the caught error and a `reset` callback. When
   * omitted, a design-system default card is rendered.
   */
  fallback?: (props: FallbackProps) => React.ReactNode;
  /** Optional hook for logging the error to an external sink. */
  onError?: (error: Error, info: React.ErrorInfo) => void;
}

interface ErrorBoundaryState {
  error: Error | null;
}

/**
 * Catches render/lifecycle errors in its subtree so a single broken component
 * can't white-screen the whole app. There was no boundary anywhere before this
 * — any thrown error in a page or chart took down the entire SPA.
 *
 * Wrap the whole app once (catches layout/shell crashes) and each routed page
 * (so a crash there keeps the sidebar/topbar usable and is scoped + resettable).
 * The default fallback navigates via a plain <a href> and uses
 * window.location.reload(), so it's safe whether the boundary sits inside or
 * outside the Router.
 */
export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // Surface in the console for local debugging; defer to an injected sink in
    // production if the host wires one up.
    console.error('Unhandled UI error:', error, info.componentStack);
    this.props.onError?.(error, info);
  }

  reset = () => this.setState({ error: null });

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    if (this.props.fallback) return this.props.fallback({ error, reset: this.reset });
    return <DefaultErrorFallback error={error} reset={this.reset} />;
  }
}

function DefaultErrorFallback({ error, reset }: FallbackProps) {
  const isDev = import.meta.env.DEV;
  return (
    <div
      role="alert"
      style={{
        minHeight: '50vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
      }}
    >
      <div
        style={{
          maxWidth: 440,
          width: '100%',
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 12,
          padding: 24,
          textAlign: 'center',
        }}
      >
        <div
          style={{
            width: 44,
            height: 44,
            borderRadius: 11,
            margin: '0 auto 14px',
            background: 'var(--pill-red-bg)',
            color: 'var(--pill-red-text)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <AlertOctagon size={22} strokeWidth={1.75} />
        </div>
        <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--text)', marginBottom: 6 }}>
          Something broke on this screen
        </div>
        <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 18, lineHeight: 1.5 }}>
          An unexpected error stopped this view from rendering. Your data is safe — try again, or
          reload the app.
        </div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={reset}
            className="btn-3d"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              height: 34,
              padding: '0 14px',
              borderRadius: 9,
              border: 0,
              cursor: 'pointer',
              fontSize: 13,
              fontWeight: 600,
              fontFamily: 'inherit',
              background: 'var(--accent)',
              color: '#fff',
              ['--b-edge' as string]: 'var(--accent-strong)',
              ['--b-glow' as string]: 'rgba(123,104,238,.32)',
              ['--b-glow-strong' as string]: 'rgba(123,104,238,.46)',
            }}
          >
            <RotateCcw size={14} strokeWidth={2} /> Try again
          </button>
          <a
            href="/overview"
            className="btn-3d"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              height: 34,
              padding: '0 14px',
              borderRadius: 9,
              border: '1px solid var(--border)',
              cursor: 'pointer',
              fontSize: 13,
              fontWeight: 600,
              fontFamily: 'inherit',
              background: 'var(--surface)',
              color: 'var(--text)',
              textDecoration: 'none',
              ['--b-edge' as string]: 'var(--border-strong)',
              ['--b-glow' as string]: 'var(--btn-neutral-glow)',
              ['--b-glow-strong' as string]: 'var(--btn-neutral-glow-strong)',
            }}
          >
            Reload app
          </a>
        </div>
        {isDev && (
          <pre
            style={{
              marginTop: 18,
              textAlign: 'left',
              fontSize: 11,
              fontFamily: 'var(--font-mono)',
              color: 'var(--pill-red-text)',
              background: 'var(--muted-bg)',
              border: '1px solid var(--border)',
              borderRadius: 8,
              padding: 12,
              overflow: 'auto',
              maxHeight: 200,
              whiteSpace: 'pre-wrap',
            }}
          >
            {error.message}
            {error.stack ? `\n\n${error.stack}` : ''}
          </pre>
        )}
      </div>
    </div>
  );
}

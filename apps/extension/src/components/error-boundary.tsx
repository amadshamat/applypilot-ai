import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Alert } from './ui/alert';
import { Button } from './ui/button';

interface State {
  error: Error | null;
}

/** Contains rendering failures to one view instead of blanking the whole panel. */
export class ErrorBoundary extends Component<{ children: ReactNode; resetKey?: unknown }, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidUpdate(prev: { resetKey?: unknown }) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null });
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ApplyPilot] view crashed', error, info.componentStack);
  }

  override render() {
    if (!this.state.error) return this.props.children;
    return (
      <Alert
        tone="error"
        title="Something went wrong in this view"
        action={
          <Button size="sm" variant="secondary" onClick={() => this.setState({ error: null })}>
            Try again
          </Button>
        }
      >
        {this.state.error.message}
      </Alert>
    );
  }
}

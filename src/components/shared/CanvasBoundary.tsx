'use client';

import { Component, type ErrorInfo, type ReactNode } from 'react';

type Props = { children: ReactNode; fallback?: ReactNode; onError?: (error: Error) => void };
type State = { failed: boolean };

/**
 * WebGL is the least reliable thing on the page: blocked contexts, driver
 * quirks, a texture that will not fetch. None of that should take the site
 * down, so a failed canvas renders its fallback (or nothing) instead.
 */
export class CanvasBoundary extends Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    this.props.onError?.(error);
    if (process.env.NODE_ENV !== 'production') {
      console.warn('[canvas] disabled after error:', error.message, info.componentStack);
    }
  }

  render() {
    if (this.state.failed) return <>{this.props.fallback ?? null}</>;
    return <>{this.props.children}</>;
  }
}

export default CanvasBoundary;

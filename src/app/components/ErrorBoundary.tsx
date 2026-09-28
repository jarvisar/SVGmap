import { Component, type ReactNode } from 'react';
import { useApp } from '../store.ts';

// Anything that throws while rendering ends up here instead of a blank page.
// Saved settings are the most likely cause that survives a reload, so there's a
// button to clear them.
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  override state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  override render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="crash">
        <p>
          <strong>Something went wrong.</strong> {error.message}
        </p>
        <p>Resetting clears the settings saved in this browser.</p>
        <div className="crash-buttons">
          <button type="button" className="btn" onClick={() => location.reload()}>
            Reload
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => {
              useApp.persist.clearStorage();
              location.reload();
            }}
          >
            Reset settings and reload
          </button>
        </div>
      </div>
    );
  }
}

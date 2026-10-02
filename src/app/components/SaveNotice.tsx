import { useState } from 'react';
import { shareUrl } from '../share.ts';
import { selectSettings, useApp, useSaveFailed } from '../store.ts';

// A share link is the one way to keep the settings when the browser won't save them.
export function SaveNotice() {
  const { failed, hidden } = useSaveFailed();
  const [button, setButton] = useState('Copy link');
  if (!failed || hidden) return null;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl(selectSettings(useApp.getState())));
      setButton('Copied');
    } catch {
      setButton("Couldn't copy");
    }
  };

  return (
    <div className="toast" role="alert">
      <span>Your settings couldn't be saved, so they will be lost when the page reloads. The browser's storage may be full. Copy a share link to keep them.</span>
      <button type="button" className="btn btn-small btn-primary" onClick={() => void copy()}>
        {button}
      </button>
      <button type="button" className="btn btn-small" onClick={() => useSaveFailed.setState({ hidden: true })}>
        Close
      </button>
    </div>
  );
}

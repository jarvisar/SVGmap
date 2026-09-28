import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App.tsx';
import { ErrorBoundary } from './app/components/ErrorBoundary.tsx';
import { InstallPrompt } from './app/components/InstallPrompt.tsx';
import { UpdateNotice } from './app/components/UpdateNotice.tsx';
import './app/styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
    {/* Outside the boundary so a fixed version can still be loaded after a crash. */}
    <div className="toasts">
      <UpdateNotice />
      <InstallPrompt />
    </div>
  </StrictMode>,
);

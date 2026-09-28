import { useEffect, useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { toSvg } from '../engine/svg/writer.ts';
import { CUSTOM_FONT_ID } from '../engine/text/fonts.ts';
import { getCustomFont, loadStoredFont } from './customFont.ts';
import { MapView } from './map/MapView.tsx';
import { CleanupPanel } from './panels/CleanupPanel.tsx';
import { DataPanel } from './panels/DataPanel.tsx';
import { LayersPanel } from './panels/LayersPanel.tsx';
import { LocationPanel } from './panels/LocationPanel.tsx';
import { OutputPanel } from './panels/OutputPanel.tsx';
import { SizePanel } from './panels/SizePanel.tsx';
import { TitlePanel } from './panels/TitlePanel.tsx';
import { Preview } from './preview/Preview.tsx';
import { requestRender, settingsKey, useRender } from './render.ts';
import { settingsFromUrl, shareUrl } from './share.ts';
import { selectSettings, toRenderSettings, useApp } from './store.ts';

function slug(text: string) {
  return (
    text
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'map'
  );
}

function download(name: string, content: string) {
  const url = URL.createObjectURL(new Blob([content], { type: 'image/svg+xml' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function useStartup() {
  useEffect(() => {
    const shared = settingsFromUrl();
    if (shared) {
      useApp.getState().set(shared);
      history.replaceState(null, '', window.location.pathname + window.location.search);
    }
    void loadStoredFont().then((font) => {
      const app = useApp.getState();
      app.setCustomFontName(font?.name ?? null);
      if (!font && (app.label.font === CUSTOM_FONT_ID || app.label.subtitleFont === CUSTOM_FONT_ID)) {
        app.setLabel({ font: 'montserrat', subtitleFont: '' });
      }
    });
  }, []);
}

export function App() {
  useStartup();
  const view = useApp((s) => s.view);
  const setView = useApp((s) => s.setView);
  const settings = useApp(useShallow(selectSettings));
  const customFontName = useApp((s) => s.customFontName);
  const renderSettings = useMemo(() => toRenderSettings(settings), [settings]);
  const customFont = customFontName ? getCustomFont() : null;
  const key = useMemo(() => settingsKey(renderSettings, customFont), [renderSettings, customFont]);
  const status = useRender((s) => s.status);
  const progress = useRender((s) => s.progress);
  const result = useRender((s) => s.result);
  const renderedKey = useRender((s) => s.renderedKey);
  const [menuOpen, setMenuOpen] = useState(false);
  const [flash, setFlash] = useState('');

  // The preview follows the settings while it is on screen.
  useEffect(() => {
    if (view !== 'preview' || key === renderedKey) return;
    const timer = setTimeout(() => requestRender(renderSettings, customFont), 350);
    return () => clearTimeout(timer);
  }, [view, key, renderedKey, renderSettings, customFont]);

  const generate = () => {
    setView('preview');
    setMenuOpen(false);
    if (key !== renderedKey || status === 'error') requestRender(renderSettings, customFont);
  };

  const save = () => {
    if (!result) return;
    download(`${slug(settings.label.text || 'map')}-${result.mode}.svg`, toSvg(result));
  };

  const share = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl(settings));
      setFlash('Link copied');
    } catch {
      setFlash('Could not copy the link');
    }
    setTimeout(() => setFlash(''), 2000);
  };

  let statusText = flash;
  let barWidth = 0;
  if (!statusText && status === 'working' && progress) {
    const counted = progress.total ? ` ${progress.done} of ${progress.total}` : '';
    statusText = `${progress.message}${counted}`;
    barWidth =
      progress.stage === 'tiles' ? 10 + 55 * ((progress.done ?? 0) / Math.max(progress.total ?? 1, 1)) : progress.stage === 'geometry' ? 75 : 90;
  } else if (!statusText && status === 'error') {
    statusText = 'Failed';
  } else if (!statusText && result && view === 'preview') {
    statusText = key === renderedKey ? 'Up to date' : 'Updating';
  }

  return (
    <div className={menuOpen ? 'app menu-open' : 'app'}>
      <header className="topbar">
        <button type="button" className="btn btn-small menu-toggle" onClick={() => setMenuOpen(!menuOpen)}>
          Settings
        </button>
        <div className="brand">SVGmap</div>
        <nav className="tabs">
          <button type="button" className={view === 'map' ? 'tab active' : 'tab'} onClick={() => setView('map')}>
            Map
          </button>
          <button type="button" className={view === 'preview' ? 'tab active' : 'tab'} onClick={generate}>
            Preview
          </button>
        </nav>
        <div className="spacer" />
        <div className="status" aria-live="polite">
          {statusText}
        </div>
        <button type="button" className="btn share-button" onClick={share}>
          Share
        </button>
        {view === 'map' ? (
          <button type="button" className="btn btn-primary" onClick={generate}>
            Generate
          </button>
        ) : (
          <button type="button" className="btn btn-primary" onClick={save} disabled={!result || status !== 'done'}>
            Download SVG
          </button>
        )}
      </header>
      <aside className="sidebar">
        <LocationPanel />
        <SizePanel />
        <OutputPanel />
        <LayersPanel />
        <TitlePanel />
        <CleanupPanel />
        <DataPanel />
        <div className="sidebar-footer">
          Map data © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, tiles by{' '}
          <a href="https://openfreemap.org">OpenFreeMap</a> and <a href="https://openmaptiles.org">OpenMapTiles</a>, search by{' '}
          <a href="https://photon.komoot.io">Photon</a>. Credit OpenStreetMap on anything you publish or sell.
          <br />
          <a href="https://github.com/jarvisar/SVGmap">Source on GitHub</a>
        </div>
      </aside>
      <main className="main">
        {status === 'working' ? <div className="progress" style={{ width: `${barWidth}%` }} /> : null}
        <div style={{ position: 'absolute', inset: 0, display: view === 'map' ? 'block' : 'none' }}>
          <MapView />
        </div>
        {view === 'preview' ? <Preview onGenerate={generate} /> : null}
      </main>
    </div>
  );
}

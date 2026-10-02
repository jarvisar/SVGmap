import { memo, useEffect, useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { toSvg } from '../engine/svg/writer.ts';
import { CUSTOM_FONT_ID } from '../engine/text/fonts.ts';
import { DEFAULT_LABEL } from '../engine/text/label.ts';
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
import { toRenderSettings } from './settings.ts';
import { settingsFromUrl, shareUrl } from './share.ts';
import { selectSettings, useApp } from './store.ts';

function slug(text: string) {
  return (
    text
      .normalize('NFKD')
      .replace(/\p{M}/gu, '')
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
      app.setCustomFont(font);
      if (font) return;
      // No stored font (cleared storage or someone else's share link), so fall back.
      if (app.label.font === CUSTOM_FONT_ID) app.setLabel({ font: DEFAULT_LABEL.font });
      if (app.label.subtitleFont === CUSTOM_FONT_ID) app.setLabel({ subtitleFont: '' });
    });
  }, []);
}

function resetSettings() {
  if (confirm('Reset all settings to the defaults? The location and title are kept.')) useApp.getState().reset();
}

// Memoised because the map updates the area on every frame while it's dragged.
// Each panel subscribes to what it shows.
const Sidebar = memo(function Sidebar() {
  return (
    <aside className="sidebar">
      <LocationPanel />
      <SizePanel />
      <OutputPanel />
      <LayersPanel />
      <TitlePanel />
      <CleanupPanel />
      <DataPanel />
      <div className="sidebar-footer">
        <p className="sidebar-about">
          SVGmap makes SVG maps of any city from OpenStreetMap data, for laser engraving, pen plotters and print.
          Everything runs in your browser.
        </p>
        Map data © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, tiles by{' '}
        <a href="https://openfreemap.org">OpenFreeMap</a> and <a href="https://openmaptiles.org">OpenMapTiles</a>, search by{' '}
        <a href="https://photon.komoot.io">Photon</a>. Credit OpenStreetMap on anything you publish or sell.
        <div className="sidebar-links">
          <a href="about">About</a>
          <a href="https://github.com/jarvisar/SVGmap">Source on GitHub</a>
          <button type="button" className="link-button" onClick={resetSettings}>
            Reset settings
          </button>
        </div>
      </div>
    </aside>
  );
});

export function App() {
  useStartup();
  const view = useApp((s) => s.view);
  const setView = useApp((s) => s.setView);
  const settings = useApp(useShallow(selectSettings));
  const customFontId = useApp((s) => s.customFontId);
  const renderSettings = useMemo(() => toRenderSettings(settings), [settings]);
  const customFont = customFontId ? getCustomFont() : null;
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
    // A map with tiles missing is rendered again, which tries those tiles.
    if (key !== renderedKey || status === 'error' || result?.stats.missingTiles) requestRender(renderSettings, customFont);
  };

  const save = () => {
    if (result) download(`${slug(result.meta.title)}-${result.mode}.svg`, toSvg(result));
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
        <button
          type="button"
          className={menuOpen ? 'btn btn-small menu-toggle active' : 'btn btn-small menu-toggle'}
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen(!menuOpen)}
        >
          Settings
        </button>
        <h1 className="brand">
          <img className="logo" src="favicon.svg" width="20" height="20" alt="" />
          SVGmap
        </h1>
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
      <Sidebar />
      {menuOpen ? <div className="backdrop" onClick={() => setMenuOpen(false)} /> : null}
      <main className="main">
        {status === 'working' ? <div className="progress" style={{ width: `${barWidth}%` }} /> : null}
        <div className={view === 'map' ? 'map-holder' : 'map-holder hidden'}>
          <MapView />
        </div>
        {view === 'preview' ? <Preview onGenerate={generate} /> : null}
      </main>
    </div>
  );
}

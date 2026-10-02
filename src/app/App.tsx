import { type DragEvent, memo, useEffect, useMemo, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { toSvg } from '../engine/svg/writer.ts';
import { CUSTOM_FONT_ID } from '../engine/text/fonts.ts';
import { DEFAULT_LABEL } from '../engine/text/label.ts';
import { ExportMenu } from './components/ExportMenu.tsx';
import { getCustomFont, loadStoredFont } from './customFont.ts';
import { defaultFileName, download } from './files.ts';
import { flash, useFlash } from './flash.ts';
import { MapView } from './map/MapView.tsx';
import { CleanupPanel } from './panels/CleanupPanel.tsx';
import { DataPanel } from './panels/DataPanel.tsx';
import { LayersPanel } from './panels/LayersPanel.tsx';
import { LocationPanel } from './panels/LocationPanel.tsx';
import { MarksPanel } from './panels/MarksPanel.tsx';
import { OutputPanel } from './panels/OutputPanel.tsx';
import { RoutesPanel } from './panels/RoutesPanel.tsx';
import { SizePanel } from './panels/SizePanel.tsx';
import { TitlePanel } from './panels/TitlePanel.tsx';
import { Preview } from './preview/Preview.tsx';
import { renderFraction, requestRender, settingsKey, useRender } from './render.ts';
import { importRouteFiles, useImportNotice } from './routes.ts';
import { toRenderSettings } from './settings.ts';
import { settingsFromUrl, shareUrl } from './share.ts';
import { selectSettings, useApp } from './store.ts';
import { asChange, quietly, redoChange, startUndo, undoChange, useUndoLabels } from './undo.ts';

function openSharedLink() {
  const shared = settingsFromUrl();
  if (!shared) return;
  // Undo goes back to the settings from before the link.
  asChange('Open link', () => useApp.getState().set(shared));
  history.replaceState(null, '', window.location.pathname + window.location.search);
}

// No stored font (cleared storage or someone else's share link), so fall back.
function dropMissingFont() {
  if (getCustomFont()) return;
  const app = useApp.getState();
  quietly(() => {
    if (app.label.font === CUSTOM_FONT_ID) app.setLabel({ font: DEFAULT_LABEL.font });
    if (useApp.getState().label.subtitleFont === CUSTOM_FONT_ID) app.setLabel({ subtitleFont: '' });
    const marks = useApp.getState().marks;
    if (marks.some((m) => m.font === CUSTOM_FONT_ID)) app.set({ marks: marks.map((m) => (m.font === CUSTOM_FONT_ID ? { ...m, font: '' } : m)) });
  });
}

function useStartup() {
  useEffect(() => {
    startUndo();
    openSharedLink();
    const fontLoaded = loadStoredFont().then((font) => {
      useApp.getState().setCustomFont(font);
      dropMissingFont();
    });
    // A link opened in a tab that already has the app open doesn't load the page again.
    const onHashChange = () => {
      openSharedLink();
      void fontLoaded.then(dropMissingFont);
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);
}

async function copyShareLink() {
  try {
    await navigator.clipboard.writeText(shareUrl(selectSettings(useApp.getState())));
    flash('Link copied');
  } catch {
    flash('Could not copy the link');
  }
}

function resetSettings() {
  if (confirm('Reset all settings to the defaults? The location, title, routes, picked roads, pins and text are kept.')) asChange('Reset settings', () => useApp.getState().reset());
}

const lower = (text: string) => text.charAt(0).toLowerCase() + text.slice(1);
const MOD = /Mac|iPhone|iPad/.test(navigator.platform) ? 'Cmd' : 'Ctrl';

function UndoButtons() {
  const { undo, redo } = useUndoLabels();
  return (
    <div className="button-group undo-buttons" role="group" aria-label="Undo and redo">
      <button type="button" className="btn" aria-label={undo ? `Undo ${lower(undo)}` : 'Undo'} title={undo ? `Undo ${lower(undo)} (${MOD}+Z)` : 'Nothing to undo'} disabled={!undo} onClick={() => undoChange()}>
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M4.5 2.5 2 5l2.5 2.5" />
          <path d="M2 5h6.5a3.5 3.5 0 0 1 0 7H6" />
        </svg>
      </button>
      <button type="button" className="btn" aria-label={redo ? `Redo ${lower(redo)}` : 'Redo'} title={redo ? `Redo ${lower(redo)} (${MOD}+Y)` : 'Nothing to redo'} disabled={!redo} onClick={() => redoChange()}>
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M9.5 2.5 12 5 9.5 7.5" />
          <path d="M12 5H5.5a3.5 3.5 0 0 0 0 7H8" />
        </svg>
      </button>
    </div>
  );
}

// Memoised because the map updates the area on every frame while it's dragged.
// Each panel subscribes to what it shows.
const Sidebar = memo(function Sidebar() {
  return (
    <aside className="sidebar">
      {/* Phones have no room for these in the top bar. */}
      <div className="sidebar-actions">
        <UndoButtons />
        <button type="button" className="btn" onClick={() => void copyShareLink()}>
          Share link
        </button>
      </div>
      <LocationPanel />
      <RoutesPanel />
      <SizePanel />
      <OutputPanel />
      <LayersPanel />
      <TitlePanel />
      <MarksPanel />
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
        <p className="made-by">Made by Team Jarvis.</p>
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
  const flashText = useFlash((s) => s.text);
  const [dropping, setDropping] = useState(false);
  const dropTimer = useRef(0);

  // A route file dropped anywhere on the page. dragleave fires for every child
  // the pointer crosses, so the overlay goes when dragover stops coming instead.
  const isFileDrag = (e: DragEvent) => Array.from(e.dataTransfer.types).includes('Files');
  const onDragOver = (e: DragEvent) => {
    if (!isFileDrag(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    setDropping(true);
    clearTimeout(dropTimer.current);
    dropTimer.current = window.setTimeout(() => setDropping(false), 200);
  };
  const onDrop = async (e: DragEvent) => {
    if (!isFileDrag(e)) return;
    e.preventDefault();
    clearTimeout(dropTimer.current);
    setDropping(false);
    // The browser empties the list once the event is over.
    const files = Array.from(e.dataTransfer.files);
    const { added, errors } = await importRouteFiles(files);
    useImportNotice.setState({ errors });
    if (added.length) flash(added.length === 1 ? `Added ${added[0]}` : `Added ${added.length} routes`);
  };

  // The preview follows the settings while it is on screen.
  useEffect(() => {
    if (view !== 'preview' || key === renderedKey) return;
    const timer = setTimeout(() => requestRender(renderSettings, customFont), 350);
    return () => clearTimeout(timer);
  }, [view, key, renderedKey, renderSettings, customFont]);

  const generate = () => {
    setView('preview');
    setMenuOpen(false);
    // A map with tiles or Overture's buildings missing is rendered again, which
    // tries those again. Overture is only asked again a minute after it failed.
    const incomplete = result?.stats.missingTiles || result?.stats.overtureFailed;
    if (key !== renderedKey || status === 'error' || incomplete) requestRender(renderSettings, customFont);
  };

  const save = () => {
    if (result) download(`${defaultFileName(result)}.svg`, new Blob([toSvg(result)], { type: 'image/svg+xml' }));
  };
  const ready = Boolean(result) && status === 'done' && key === renderedKey;

  let statusText = flashText;
  let barWidth = 0;
  if (!statusText && status === 'working' && progress) {
    const counted = progress.total
      ? ` ${progress.done} of ${progress.total}`
      : progress.fraction !== undefined
        ? ` ${Math.round(progress.fraction * 100)}%`
        : '';
    statusText = `${progress.message}${counted}`;
    barWidth = renderFraction(progress) * 100;
  } else if (!statusText && status === 'error') {
    statusText = 'Failed';
  } else if (!statusText && result && view === 'preview') {
    statusText = key === renderedKey ? 'Up to date' : 'Updating';
  }

  return (
    <div className={menuOpen ? 'app menu-open' : 'app'} onDragOver={onDragOver} onDrop={(e) => void onDrop(e)}>
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
        <UndoButtons />
        <button type="button" className="btn share-button" onClick={() => void copyShareLink()}>
          Share
        </button>
        {view === 'map' ? (
          <button type="button" className="btn btn-primary" onClick={generate}>
            Generate
          </button>
        ) : (
          <>
            <ExportMenu result={result} ready={ready} />
            <button
              type="button"
              className="btn btn-primary"
              aria-label="Download SVG"
              onClick={save}
              disabled={!ready}
            >
              <span className="wide-only">Download</span> SVG
            </button>
          </>
        )}
      </header>
      <Sidebar />
      {menuOpen ? <div className="backdrop" onClick={() => setMenuOpen(false)} /> : null}
      <main className="main">
        {status === 'working' ? <div className="progress" style={{ width: `${barWidth}%` }} /> : null}
        <div className={view === 'map' ? 'map-holder' : 'map-holder hidden'}>
          <MapView />
        </div>
        {view === 'preview' ? <Preview onGenerate={generate} upToDate={key === renderedKey} /> : null}
      </main>
      {dropping ? (
        <div className="drop-overlay">
          <div>Drop GPX, KML, KMZ, TCX or GeoJSON files to add them as routes</div>
        </div>
      ) : null}
    </div>
  );
}

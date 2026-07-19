import { useEffect, useRef } from 'react';
import { useStore, PERF_GATES_OFF } from './stores/useStore';
import { TitleBar } from './components/TitleBar';
import { Sidebar } from './components/Sidebar';
import { MainView } from './components/MainView';
import { SettingsView } from './components/SettingsView';
import { HistoryView } from './components/HistoryView';
import { StatusBar } from './components/StatusBar';
import { CompactView } from './components/CompactView';
import { UpdateBanner } from './components/UpdateBanner';
import { applyTheme } from './lib/theme';
import { getTheme, DEFAULT_EFFECTS } from '../shared/themes';

export default function App() {
  const { view, settings, setView, loadSettings, loadHistory, setSettingsFromBroadcast } = useStore();

  useEffect(() => {
    loadSettings();
    loadHistory();
    // Signal to the main process that we've committed our first render.
    // Double rAF guarantees the commit has actually been painted before
    // main is allowed to swap the window into view.
    const ready = () => {
      try { window.parlys?.rendererReady?.(); } catch { /* no-op */ }
    };
    requestAnimationFrame(() => requestAnimationFrame(ready));
  }, [loadSettings, loadHistory]);

  // Live-sync settings across windows (and from global-accelerator
  // flips). Without this, pressing the interpreter hotkey flips
  // `interpreterEnabled` in main but the emerald chip in this
  // renderer still looks grey because it reads its own stale state.
  useEffect(() => {
    const unsub = window.parlys?.onSettingsChanged?.((next: any) => {
      setSettingsFromBroadcast(next);
    });
    return () => { try { unsub?.(); } catch { /* ignore */ } };
  }, [setSettingsFromBroadcast]);

  // Flag the html/body so index.css can make everything transparent in pill
  // mode without affecting comfortable mode. The attribute is already set by
  // the inline bootstrap script in index.html from the URL hash, so this is
  // essentially a no-op on first paint — but we re-assert it here in case
  // density changes at runtime (in-app switch, though all switches go
  // through window recreation). No cleanup: we never want the attribute
  // momentarily absent between two runs of this effect.
  useEffect(() => {
    const density = settings.density || 'comfortable';
    document.documentElement.dataset.density = density;
    document.body.dataset.density = density;
  }, [settings.density]);

  // Apply the active theme + effects at mount and whenever they change.
  // This rewrites CSS variables on :root so every existing component
  // repaints with the new palette, zero reload.
  //
  // Signature gate: every settings save round-trip produces a FRESH
  // themeEffects object identity (IPC echo), so without it this effect
  // re-ran — rewriting ~30 CSS custom properties and re-toggling the
  // aura classes — on every keystroke in any Settings input and every
  // slider tick. Skip when nothing visual actually changed.
  const themeSigRef = useRef('');
  useEffect(() => {
    const theme = getTheme(settings.themeId);
    const effects = settings.themeEffects || DEFAULT_EFFECTS;
    const sig = theme.id + JSON.stringify(effects);
    if (!PERF_GATES_OFF && sig === themeSigRef.current) return;
    themeSigRef.current = sig;
    applyTheme(theme, effects);
  }, [settings.themeId, settings.themeEffects]);

  // Main can push us to the Settings view after expanding from the pill.
  useEffect(() => {
    const unsub = window.parlys.onOpenSettings?.(() => setView('settings'));
    return () => unsub?.();
  }, [setView]);

  // Density swap choreography — when main is about to destroy THIS
  // window, it fires `densitySwapOut`. We stamp `is-leaving` on
  // <html> to trigger the CSS fade-out defined in index.css. Main
  // waits ~130 ms after sending the signal before actually swapping
  // windows, giving the 120 ms CSS transition time to play.
  useEffect(() => {
    const unsub = window.parlys?.onDensitySwapOut?.(() => {
      document.documentElement.classList.add('is-leaving');
    });
    return () => { try { unsub?.(); } catch { /* ignore */ } };
  }, []);

  // Stamp the pill zoom. Uniform proportional model: --pill-scale IS the
  // slider value, applied to the whole single-face pill. Nothing here (or
  // anywhere) resizes the window at runtime; only slider changes do.
  const stampPillScale = (rest: number) => {
    const r = Math.min(1.5, Math.max(0.3, rest));
    document.documentElement.style.setProperty('--pill-scale', String(r));
    document.documentElement.setAttribute('data-window', 'pill');
  };

  // Live-apply the pill scale broadcast by main when the slider moves.
  // The bootstrap already stamps the initial values from the URL hash;
  // this hook keeps them in sync afterward.
  const lastMainScaleRef = useRef<number | null>(null);
  useEffect(() => {
    const unsub = (window.parlys as any)?.onPillScaleChanged?.((rest: number) => {
      if (Number.isFinite(rest) && rest >= 0.3 && rest <= 1.5) {
        lastMainScaleRef.current = rest;
        stampPillScale(rest);
      }
    });
    return () => { try { unsub?.(); } catch { /* ignore */ } };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep the rendered vars in lockstep regardless of which path delivered
  // a change (dedicated IPC above, settings broadcast, or loadSettings).
  useEffect(() => {
    if (document.documentElement.dataset.density !== 'compact') return;
    stampPillScale(lastMainScaleRef.current ?? (settings.pillScale ?? 1));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.pillScale]);

  const compact = settings.density === 'compact';

  // Pill mode: just the floating widget, no frame/titlebar/sidebar/aurora.
  if (compact) {
    return (
      <div className="density-compact h-full w-full">
        <CompactView />
      </div>
    );
  }

  // Comfortable (main window) layout.
  return (
    <div className="density-comfortable relative h-full w-full flex flex-col">
      <div className="bg-aurora"><div className="spot-3" /></div>
      <div className="relative z-10 flex flex-col h-full">
        {/* [EXPERIMENT:refonte-v1] a11y skip link — invisible until Tab focus */}
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only fixed top-2 left-2 z-50 px-3 py-2 rounded bg-violet-500 text-white text-sm focus:outline-none focus:ring-2 focus:ring-white"
        >
          Aller au contenu principal
        </a>
        <TitleBar />
        <div className="flex-1 flex min-h-0">
          <Sidebar />
          <main id="main-content" className="flex-1 min-w-0 min-h-0 overflow-auto">
            <div key={view} className="h-full">
              {view === 'main' && <MainView />}
              {view === 'settings' && <SettingsView />}
              {view === 'history' && <HistoryView />}
            </div>
          </main>
        </div>
        <StatusBar />
      </div>
      {/* Auto-updater toast. Owns its own subscription + visibility —
          renders nothing in `idle` phase, floats bottom-right when
          there's state to show. Never blocks the UI. */}
      <UpdateBanner />
    </div>
  );
}

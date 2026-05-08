/**
 * Floating toast at the bottom-right of the main window that surfaces
 * the auto-updater state machine to the user.
 *
 * The component is intentionally small (< 150 LOC) and self-contained:
 * it owns its subscription to `window.voiceink.onUpdaterState` and
 * hydrates once on mount via `updaterGetState()`. No Zustand coupling
 * — the updater is a sidecar concern that doesn't need to live in the
 * main app state.
 *
 * UX rules (informed by JetBrains/VSCode/Signal patterns):
 * - NEVER interrupt the user mid-dictation. All interaction is
 *   optional; dismissing the banner is one click.
 * - "Up-to-date" confirmation only appears for 4s (user asked, they
 *   just want feedback, not a sticker).
 * - Download is automatic once an update is available — waiting for
 *   the user to click Download first is a waste (download while
 *   they read the changelog).
 * - When "ready", we show a persistent banner with "Install & restart".
 *   One click quits VoiceInk cleanly, NSIS swaps the binaries,
 *   relaunches, user's back to work.
 * - Errors are shown once with an "Ignore" action — most updater
 *   errors are network-transient and will recover on the next 4h
 *   heartbeat.
 */
import { useEffect, useState } from 'react';
import { Download, RefreshCw, X, AlertTriangle, Check, RotateCw } from 'lucide-react';
import type { UpdaterState } from '../../shared/types';
import { useT } from '../lib/i18n';

export function UpdateBanner() {
  const t = useT();
  const [state, setState] = useState<UpdaterState>({ phase: 'idle' });
  const [dismissed, setDismissed] = useState(false);

  // Hydrate on mount + subscribe to transitions.
  useEffect(() => {
    const api = (window as any).voiceink;
    if (!api) return;
    let alive = true;

    api.updaterGetState?.().then((s: UpdaterState) => {
      if (alive && s) setState(s);
    }).catch(() => { /* ignore */ });

    const unsub = api.onUpdaterState?.((s: UpdaterState) => {
      if (!alive) return;
      setState(s);
      // New transition = user should see it, even if they'd dismissed
      // a previous state. Reset dismiss flag on phase change.
      setDismissed(false);
    });

    return () => {
      alive = false;
      try { unsub?.(); } catch { /* ignore */ }
    };
  }, []);

  // Auto-hide the "up-to-date" confirmation after 4s.
  useEffect(() => {
    if (state.phase !== 'up-to-date') return;
    const h = setTimeout(() => setDismissed(true), 4000);
    return () => clearTimeout(h);
  }, [state.phase]);

  // Phase → visible? Idle is always hidden. Everything else visible
  // until the user dismisses (or the timer fires for up-to-date).
  if (dismissed) return null;
  if (state.phase === 'idle') return null;

  const baseClasses = 'fixed bottom-4 right-4 max-w-sm z-50 glass rounded-xl px-4 py-3 shadow-xl border';

  if (state.phase === 'checking') {
    return (
      <div className={`${baseClasses} border-white/10`} role="status">
        <div className="flex items-center gap-3">
          <RotateCw size={14} className="text-white/60 animate-spin" />
          <span className="text-sm text-white/80">{t('updater.checking')}</span>
        </div>
      </div>
    );
  }

  if (state.phase === 'up-to-date') {
    return (
      <div className={`${baseClasses} border-emerald-500/30`} role="status">
        <div className="flex items-center gap-3">
          <Check size={14} className="text-emerald-400" />
          <span className="text-sm text-white/90">
            {t('updater.upToDate', { version: state.version || '' })}
          </span>
          <button onClick={() => setDismissed(true)} className="ml-auto text-white/40 hover:text-white/80">
            <X size={14} />
          </button>
        </div>
      </div>
    );
  }

  if (state.phase === 'available' || state.phase === 'downloading') {
    const pct = Math.max(0, Math.min(100, state.progress ?? 0));
    return (
      <div className={`${baseClasses} border-fuchsia-500/30`} role="status">
        <div className="flex items-center gap-3 mb-2">
          <Download size={14} className="text-fuchsia-300" />
          <div className="text-sm font-medium text-white/90">
            {t('updater.downloading', { version: state.version || '' })}
          </div>
        </div>
        {/* Progress bar — only while actually downloading (-1 on
            'available' before the first progress tick looks weird). */}
        <div className="h-1 bg-white/10 rounded-full overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-fuchsia-400 to-purple-400 transition-all duration-200"
            style={{ width: `${pct}%` }}
          />
        </div>
        <div className="text-[11px] text-white/50 mt-1.5">
          {pct}% {state.total ? ` — ${formatBytes(state.transferred)}/${formatBytes(state.total)}` : ''}
        </div>
      </div>
    );
  }

  if (state.phase === 'ready') {
    return (
      <div className={`${baseClasses} border-emerald-500/40`} role="alert">
        <div className="flex items-start gap-3">
          <RefreshCw size={14} className="text-emerald-300 mt-0.5 shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold text-white/95">
              {t('updater.readyTitle', { version: state.version || '' })}
            </div>
            <div className="text-[11px] text-white/60 mt-0.5">{t('updater.readyDesc')}</div>
            <div className="flex items-center gap-2 mt-2.5">
              <button
                className="btn btn-sm btn-primary"
                onClick={() => (window as any).voiceink?.updaterInstall?.()}
              >
                {t('updater.installNow')}
              </button>
              <button
                className="btn btn-sm btn-ghost"
                onClick={() => setDismissed(true)}
              >
                {t('updater.later')}
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (state.phase === 'error') {
    return (
      <div className={`${baseClasses} border-amber-500/40`} role="alert">
        <div className="flex items-start gap-3">
          <AlertTriangle size={14} className="text-amber-400 mt-0.5 shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium text-white/90">{t('updater.errorTitle')}</div>
            <div className="text-[11px] text-white/50 mt-0.5 truncate" title={state.error}>
              {state.error || t('updater.errorGeneric')}
            </div>
          </div>
          <button onClick={() => setDismissed(true)} className="text-white/40 hover:text-white/80">
            <X size={14} />
          </button>
        </div>
      </div>
    );
  }

  return null;
}

function formatBytes(n?: number): string {
  if (!n || n < 1024) return `${n ?? 0}B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)}KB`;
  return `${(n / (1024 * 1024)).toFixed(1)}MB`;
}

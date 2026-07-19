import { create } from 'zustand';
import { Settings, DEFAULT_SETTINGS, HistoryEntry, ThemeId, ThemeEffects, THEME_ORDER, DEFAULT_EFFECTS } from '../../shared/types';

export type View = 'main' | 'history' | 'settings';
export type RecState = 'idle' | 'recording' | 'processing' | 'error';

/**
 * Read the density the main process baked into the URL hash when it
 * created this window (`#compact` or `#comfortable`). Returning it here
 * lets the very first React render pick the right layout, so there is no
 * one-frame flash of the comfortable UI inside a 176x42 pill window
 * during a comfortable → compact swap.
 */
function initialDensity(): Settings['density'] {
  if (typeof location === 'undefined') return DEFAULT_SETTINGS.density;
  const raw = (location.hash || '').replace('#', '');
  // The hash carries multiple `;`-separated segments — density is always
  // the FIRST segment. Subsequent segments may be `;theme=…`, `;fx=…`,
  // `;view=…`, `;palette=…`, `;effects=…` (added by main/loadRenderer).
  // The previous parser only stripped `-sampler` and `;view=…$`, leaving
  // any `;theme=…;fx=…` suffix intact — so the equality check below
  // failed and pill windows fell back to 'comfortable', causing the
  // CompactView to never mount in a 176×42 pill window.
  const head = raw.split(';')[0].replace(/-sampler/, '');
  if (head === 'compact' || head === 'comfortable') return head as Settings['density'];
  return DEFAULT_SETTINGS.density;
}

/**
 * Smoke-test hook: if the main process put `;view=settings` (or
 * `history`) into the URL hash — driven by the `PARLYS_START_VIEW`
 * env var — land the renderer directly on that view instead of the
 * default 'main'. Lets external test scripts verify the view mounts
 * cleanly without needing to simulate a sidebar click.
 *
 * Never used in normal operation — the suffix is only ever emitted
 * when the env var is set.
 */
function initialView(): View {
  if (typeof location === 'undefined') return 'main';
  const m = (location.hash || '').match(/;view=(main|history|settings)/);
  return (m ? m[1] : 'main') as View;
}

/**
 * Pull a `key=value` segment out of the URL hash main process baked in
 * via `loadRenderer()`. Returns the URL-decoded value or null when absent.
 * Mirrors the parser used by the inline bootstrap in `index.html` so the
 * store seed values are guaranteed to match what's already painted on screen.
 */
function pickHashSegment(key: string): string | null {
  if (typeof location === 'undefined') return null;
  const raw = (location.hash || '').replace('#', '');
  const seg = raw.split(';').find((s) => s.startsWith(`${key}=`));
  if (!seg) return null;
  try { return decodeURIComponent(seg.slice(key.length + 1)); }
  catch { return seg.slice(key.length + 1); }
}

/**
 * Seed `themeId` from the URL hash so React's very first render holds the
 * user's actual theme, not DEFAULT_SETTINGS.midnight. Without this hook,
 * the App.tsx `useEffect[settings.themeId]` would fire on mount with
 * 'midnight', overwrite the cyberpunk CSS vars the inline bootstrap
 * already stamped, then loadSettings would resolve ~10 ms later and the
 * effect would re-fire with 'cyberpunk' — visible as a one-frame flash
 * of the default theme on every cold start and every density swap.
 */
function initialThemeId(): ThemeId {
  const id = pickHashSegment('theme');
  if (id && (THEME_ORDER as readonly string[]).includes(id)) return id as ThemeId;
  return DEFAULT_SETTINGS.themeId;
}

/** Seed themeEffects from the URL hash (same anti-flash motivation). */
function initialThemeEffects(): ThemeEffects {
  const json = pickHashSegment('effects');
  if (!json) return DEFAULT_SETTINGS.themeEffects;
  try {
    const parsed = JSON.parse(json) as Partial<ThemeEffects>;
    return { ...DEFAULT_EFFECTS, ...parsed };
  } catch { return DEFAULT_SETTINGS.themeEffects; }
}

/** Seed pillScale from `;pillscale=<n>`. */
function initialPillScale(): number {
  const v = pickHashSegment('pillscale');
  if (!v) return DEFAULT_SETTINGS.pillScale;
  const n = parseFloat(v);
  if (!Number.isFinite(n)) return DEFAULT_SETTINGS.pillScale;
  return Math.min(1.5, Math.max(0.3, n));
}

/**
 * Seed settings with everything the URL hash carries so the very first
 * render produces a frame that already matches the user's persisted
 * theme + pill scale. loadSettings() later returns the same values
 * (they were the source for the hash), so the applyTheme useEffect
 * is a no-op repaint — no theme flash on first render or density swap.
 */
const INITIAL_SETTINGS: Settings = {
  ...DEFAULT_SETTINGS,
  density: initialDensity(),
  themeId: initialThemeId(),
  themeEffects: initialThemeEffects(),
  pillScale: initialPillScale(),
};

/** Timestamp of the last audioLevel update that was actually committed. */
let lastLevelTs = 0;

/**
 * Bench-only kill-switch (PARLYS_PERF_OFF=1 → `;perfoff=1` in the URL hash,
 * same idiom as `;spec=0`): disables the v1.10 fluidity gates so an A/B
 * measurement can compare both behaviours on the SAME binary. Inert in
 * normal launches.
 */
export const PERF_GATES_OFF =
  typeof location !== 'undefined' && /;perfoff=1/.test(location.hash || '');

interface State {
  view: View;
  setView: (v: View) => void;

  settings: Settings;
  loadSettings: () => Promise<void>;
  updateSettings: (patch: Partial<Settings>) => Promise<void>;
  /**
   * Overwrite the entire settings slice with a value pushed by main
   * (global-accelerator flip, ON_SETTINGS_CHANGED broadcast, etc.).
   * Preserves the URL-hash density so a live settings push from
   * another window never re-paints this one with the wrong layout.
   */
  setSettingsFromBroadcast: (next: Settings) => void;

  history: HistoryEntry[];
  loadHistory: () => Promise<void>;
  removeHistory: (id: string) => Promise<void>;
  clearHistory: () => Promise<void>;

  recState: RecState;
  setRecState: (s: RecState) => void;
  lastTranscript: string;
  setLastTranscript: (t: string) => void;
  lastLatencyMs: number;
  setLastLatencyMs: (n: number) => void;
  lastError: string;
  setLastError: (e: string) => void;

  audioLevel: number; // 0..1 live RMS
  setAudioLevel: (n: number) => void;
}

declare global { interface Window { parlys: any } }

export const useStore = create<State>()((set, get) => ({
  view: initialView(),
  setView: (v) => set({ view: v }),

  settings: INITIAL_SETTINGS,
  loadSettings: async () => {
    const s = await window.parlys.getSettings();
    // Preserve the URL-hash-derived density — it is the single source
    // of truth for which window this renderer is running in. If we let
    // a persisted 'comfortable' / 'compact' leak in here, React will
    // re-render the wrong component tree inside a window that was
    // sized for the other density (invisible MainView crammed into a
    // 176×55 pill, or the opposite), and every subsequent hover /
    // click lands on the wrong element. Density changes go through
    // swapDensity() in main, which recreates the window and reloads
    // the renderer with a fresh hash, so this never needs to update
    // in-flight.
    set({ settings: { ...s, density: initialDensity() } });
  },
  updateSettings: async (patch) => {
    const next = await window.parlys.setSettings(patch);
    // Same contract as loadSettings — never let density flip under
    // a live renderer.
    set({ settings: { ...next, density: initialDensity() } });
  },
  setSettingsFromBroadcast: (next) => {
    // Trust main's payload but keep the density locked to this
    // window's URL hash — see loadSettings() comment for why.
    const merged = { ...next, density: initialDensity() };
    // Bail if nothing actually changed. Every broadcast otherwise creates a
    // fresh settings object (and fresh themeEffects identity), re-running the
    // applyTheme effect and re-rendering every useStore() subscriber even for
    // an unrelated flip (e.g. the interpreter hotkey). A cheap deep-equal
    // (settings is small + JSON-serialisable) skips that churn.
    const cur = get().settings;
    try {
      if (JSON.stringify(cur) === JSON.stringify(merged)) return;
    } catch { /* fall through to set on any serialise hiccup */ }
    set({ settings: merged });
  },

  history: [],
  loadHistory: async () => {
    const h = await window.parlys.getHistory();
    set({ history: h });
  },
  removeHistory: async (id) => {
    await window.parlys.deleteHistory(id);
    await get().loadHistory();
  },
  clearHistory: async () => {
    await window.parlys.clearHistory();
    set({ history: [] });
  },

  recState: 'idle',
  setRecState: (s) => set({ recState: s }),
  lastTranscript: '',
  setLastTranscript: (t) => set({ lastTranscript: t }),
  lastLatencyMs: 0,
  setLastLatencyMs: (n) => set({ lastLatencyMs: n }),
  lastError: '',
  setLastError: (e) => set({ lastError: e }),

  audioLevel: 0,
  setAudioLevel: (n) => {
    if (PERF_GATES_OFF) { set({ audioLevel: n }); return; }
    // Audio callbacks arrive every ~43 ms (2048 frames @ 48 kHz) and every
    // set() here re-renders EVERY whole-store subscriber (all mounted views)
    // — ~23 full re-renders/s while recording. The two waveforms only
    // SAMPLE the level on their own 60/70 ms interval (through a ref), so
    // store updates faster than that are invisible. Gate: always accept a
    // reset to rest and genuine attacks (|Δ| ≥ 0.1, keeps the meter snappy),
    // otherwise commit at most every 70 ms. Halves recording-time renders
    // with zero visual difference.
    const prev = get().audioLevel;
    if (n === 0) {
      if (prev === 0) return; // already at rest
    } else {
      const now = performance.now();
      if (now - lastLevelTs < 70 && Math.abs(n - prev) < 0.1) return;
      lastLevelTs = now;
    }
    set({ audioLevel: n });
  },
}));

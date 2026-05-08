import { create } from 'zustand';
import { Settings, DEFAULT_SETTINGS, HistoryEntry } from '../../shared/types';

export type View = 'main' | 'history' | 'settings';
export type RecState = 'idle' | 'recording' | 'processing' | 'error';

/**
 * Read the density the main process baked into the URL hash when it
 * created this window (`#compact` or `#comfortable`). Returning it here
 * lets the very first React render pick the right layout, so there is no
 * one-frame flash of the comfortable UI inside a 176x52 pill window
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
  // CompactView to never mount in a 176×52 pill window.
  const head = raw.split(';')[0].replace(/-sampler/, '');
  if (head === 'compact' || head === 'comfortable') return head as Settings['density'];
  return DEFAULT_SETTINGS.density;
}

/**
 * Smoke-test hook: if the main process put `;view=settings` (or
 * `history`) into the URL hash — driven by the `VOICEINK_START_VIEW`
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
 * Seed settings with the URL-hash density so the initial render matches
 * the window's actual size. Everything else stays at defaults until
 * `loadSettings()` finishes (~1 IPC round-trip, <10 ms).
 */
const INITIAL_SETTINGS: Settings = {
  ...DEFAULT_SETTINGS,
  density: initialDensity(),
};

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

declare global { interface Window { voiceink: any } }

export const useStore = create<State>()((set, get) => ({
  view: initialView(),
  setView: (v) => set({ view: v }),

  settings: INITIAL_SETTINGS,
  loadSettings: async () => {
    const s = await window.voiceink.getSettings();
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
    const next = await window.voiceink.setSettings(patch);
    // Same contract as loadSettings — never let density flip under
    // a live renderer.
    set({ settings: { ...next, density: initialDensity() } });
  },
  setSettingsFromBroadcast: (next) => {
    // Trust main's payload but keep the density locked to this
    // window's URL hash — see loadSettings() comment for why.
    set({ settings: { ...next, density: initialDensity() } });
  },

  history: [],
  loadHistory: async () => {
    const h = await window.voiceink.getHistory();
    set({ history: h });
  },
  removeHistory: async (id) => {
    await window.voiceink.deleteHistory(id);
    await get().loadHistory();
  },
  clearHistory: async () => {
    await window.voiceink.clearHistory();
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
  setAudioLevel: (n) => set({ audioLevel: n }),
}));

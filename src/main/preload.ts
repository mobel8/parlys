import { contextBridge, ipcRenderer } from 'electron';
// Sandboxed preloads cannot `require()` arbitrary modules — only the
// electron / events / timers / url whitelist. Everything we need from
// `src/shared/types` must therefore either be a TYPE (erased at compile
// time via `import type`) or be inlined here as a literal.
import type {
  Settings,
  TranscribeRequest,
  TranscribeResponse,
  InterpretRequest,
  InterpretResponse,
  InterpretChunkEvent,
  HistoryEntry,
  UsageStats,
  VoiceInfo,
} from '../shared/types';

type ExportFormat = 'json' | 'markdown' | 'txt' | 'csv';

/**
 * IPC channel names. Must stay in sync with `src/shared/types.ts::IPC`.
 * We duplicate them here because the preload runs in a sandbox that
 * cannot resolve local modules.
 */
const IPC = {
  TRANSCRIBE: 'parlys:transcribe',
  INTERPRET: 'parlys:interpret',
  ON_INTERPRET_CHUNK: 'parlys:interpretChunk',
  LIST_VOICES: 'parlys:listVoices',
  LISTENER_TRANSCRIBE: 'parlys:listenerTranscribe',
  SPEAK: 'parlys:speak',
  PREWARM: 'parlys:prewarm',
  GET_SETTINGS: 'parlys:getSettings',
  SET_SETTINGS: 'parlys:setSettings',
  GET_HISTORY: 'parlys:getHistory',
  ADD_HISTORY: 'parlys:addHistory',
  DELETE_HISTORY: 'parlys:deleteHistory',
  CLEAR_HISTORY: 'parlys:clearHistory',
  INJECT_TEXT: 'parlys:injectText',
  COPY_TEXT: 'parlys:copyText',
  EXPORT: 'parlys:export',
  ON_TOGGLE_RECORDING: 'parlys:onToggleRecording',
  ON_SETTINGS_OPEN: 'parlys:onSettingsOpen',
  ON_SETTINGS_CHANGED: 'parlys:onSettingsChanged',
  WINDOW_MINIMIZE: 'parlys:windowMinimize',
  WINDOW_CLOSE: 'parlys:windowClose',
  WINDOW_MAXIMIZE: 'parlys:windowMaximize',
  WINDOW_SET_ALWAYS_ON_TOP: 'parlys:windowSetAlwaysOnTop',
  WINDOW_RESIZE_FOR_DENSITY: 'parlys:windowResizeForDensity',
  WIDGET_CONTEXT_MENU: 'parlys:widgetContextMenu',
  TOGGLE_PIN_HISTORY: 'parlys:togglePinHistory',
  EXPORT_HISTORY: 'parlys:exportHistory',
  GET_USAGE_STATS: 'parlys:getUsageStats',
  SET_AUTO_START: 'parlys:setAutoStart',
  ON_PTT_DOWN: 'parlys:onPttDown',
  ON_PTT_UP: 'parlys:onPttUp',
  LOG: 'parlys:log',
  UPDATER_CHECK: 'parlys:updaterCheck',
  UPDATER_INSTALL: 'parlys:updaterInstall',
  UPDATER_GET_STATE: 'parlys:updaterGetState',
  ON_UPDATER_STATE: 'parlys:onUpdaterState',
} as const;

const api = {
  getSettings: (): Promise<Settings> => ipcRenderer.invoke(IPC.GET_SETTINGS),
  setSettings: (patch: Partial<Settings>): Promise<Settings> =>
    ipcRenderer.invoke(IPC.SET_SETTINGS, patch),

  transcribe: (req: TranscribeRequest): Promise<TranscribeResponse> =>
    ipcRenderer.invoke(IPC.TRANSCRIBE, req),

  /**
   * Voice interpreter — streams translated audio back over
   * `onInterpretChunk`. The returned Promise resolves with the final
   * metadata (latency, detected language…) once the last MP3 chunk
   * has been pushed. The renderer is expected to subscribe to chunks
   * BEFORE calling this (see `src/renderer/lib/interpret-player.ts`).
   */
  interpret: (req: InterpretRequest): Promise<InterpretResponse> =>
    ipcRenderer.invoke(IPC.INTERPRET, req),

  onInterpretChunk: (cb: (chunk: InterpretChunkEvent) => void) => {
    const listener = (_e: unknown, chunk: InterpretChunkEvent) => cb(chunk);
    ipcRenderer.on(IPC.ON_INTERPRET_CHUNK, listener);
    return () => ipcRenderer.removeListener(IPC.ON_INTERPRET_CHUNK, listener);
  },

  /** Fetch the full voice catalog for the given provider. */
  listVoices: (provider: 'cartesia' | 'elevenlabs' | 'openai'): Promise<VoiceInfo[]> =>
    ipcRenderer.invoke(IPC.LIST_VOICES, provider),

  /** Listener — transcribe a single audio segment + optional translate. */
  listenerTranscribe: (req: { audioBase64: string; mimeType: string; targetLang: string; sourceLang?: string }): Promise<{
    ok: boolean; text: string; translated?: string; sourceLang?: string; error?: string; translateFailed?: boolean;
  }> => ipcRenderer.invoke(IPC.LISTENER_TRANSCRIBE, req),

  /** Text-to-speech only — streams MP3 chunks via onInterpretChunk. */
  speak: (req: { requestId: string; text: string; language?: string }): Promise<{ ok: boolean; ttfbMs?: number; error?: string; requestId: string }> =>
    ipcRenderer.invoke(IPC.SPEAK, req),

  /** Fire-and-forget TLS warm-up for Groq + TTS origin. Call this the
   *  moment the user starts recording so sockets are hot by the time
   *  the audio is ready to upload. */
  prewarm: () => ipcRenderer.send(IPC.PREWARM),

  getHistory: (): Promise<HistoryEntry[]> => ipcRenderer.invoke(IPC.GET_HISTORY),
  deleteHistory: (id: string): Promise<void> => ipcRenderer.invoke(IPC.DELETE_HISTORY, id),
  clearHistory: (): Promise<void> => ipcRenderer.invoke(IPC.CLEAR_HISTORY),
  togglePinHistory: (id: string): Promise<boolean> => ipcRenderer.invoke(IPC.TOGGLE_PIN_HISTORY, id),
  exportHistory: (format: ExportFormat): Promise<{ ok: boolean; path?: string; canceled?: boolean; error?: string }> =>
    ipcRenderer.invoke(IPC.EXPORT_HISTORY, format),
  getUsageStats: (): Promise<UsageStats> => ipcRenderer.invoke(IPC.GET_USAGE_STATS),

  setAutoStart: (enabled: boolean): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke(IPC.SET_AUTO_START, enabled),

  copyText: (text: string): Promise<void> => ipcRenderer.invoke(IPC.COPY_TEXT, text),
  injectText: (text: string): Promise<void> => ipcRenderer.invoke(IPC.INJECT_TEXT, text),

  onToggleRecording: (cb: () => void) => {
    const listener = () => cb();
    ipcRenderer.on(IPC.ON_TOGGLE_RECORDING, listener);
    return () => ipcRenderer.removeListener(IPC.ON_TOGGLE_RECORDING, listener);
  },
  onPttDown: (cb: () => void) => {
    const listener = () => cb();
    ipcRenderer.on(IPC.ON_PTT_DOWN, listener);
    return () => ipcRenderer.removeListener(IPC.ON_PTT_DOWN, listener);
  },
  onPttUp: (cb: () => void) => {
    const listener = () => cb();
    ipcRenderer.on(IPC.ON_PTT_UP, listener);
    return () => ipcRenderer.removeListener(IPC.ON_PTT_UP, listener);
  },

  windowMinimize: () => ipcRenderer.invoke(IPC.WINDOW_MINIMIZE),
  windowMaximize: () => ipcRenderer.invoke(IPC.WINDOW_MAXIMIZE),
  windowClose: () => ipcRenderer.invoke(IPC.WINDOW_CLOSE),
  windowSetAlwaysOnTop: (enabled: boolean) =>
    ipcRenderer.invoke(IPC.WINDOW_SET_ALWAYS_ON_TOP, enabled),
  windowResizeForDensity: (density: 'comfortable' | 'compact') =>
    ipcRenderer.invoke(IPC.WINDOW_RESIZE_FOR_DENSITY, density),
  showWidgetContextMenu: () => ipcRenderer.invoke(IPC.WIDGET_CONTEXT_MENU),

  onOpenSettings: (cb: () => void) => {
    const listener = () => cb();
    ipcRenderer.on('parlys:openSettings', listener);
    return () => ipcRenderer.removeListener('parlys:openSettings', listener);
  },

  /**
   * Subscribe to settings changes broadcast by main after any UI
   * round-trip OR any global-accelerator flip (e.g. the interpreter
   * hotkey). The callback receives the FULL new Settings so the
   * renderer can `set({ settings: next })` in one shot, no extra IPC.
   */
  onSettingsChanged: (cb: (settings: Settings) => void) => {
    const listener = (_e: unknown, s: Settings) => cb(s);
    ipcRenderer.on(IPC.ON_SETTINGS_CHANGED, listener);
    return () => ipcRenderer.removeListener(IPC.ON_SETTINGS_CHANGED, listener);
  },

  log: (...args: unknown[]) => ipcRenderer.invoke(IPC.LOG, ...args),

  /**
   * Fire-and-forget "renderer has rendered its first real frame" signal.
   * Main process uses this to gate window-visibility swaps during a
   * density hot-swap, so the new window never appears while it's still
   * painting the (possibly wrong-for-its-size) shell frame.
   */
  rendererReady: () => ipcRenderer.send('parlys:renderer-ready'),

  /**
   * Main fires this signal on the OUTGOING renderer just before it
   * hides + destroys the old window during a density swap. The
   * renderer adds `is-leaving` to <html> so the CSS fade-out plays
   * while the new window finishes painting off-screen. See the
   * "Density swap" CSS block in `index.css` for the transition rules.
   */
  onDensitySwapOut: (cb: () => void) => {
    const listener = () => cb();
    ipcRenderer.on('parlys:densitySwapOut', listener);
    return () => ipcRenderer.removeListener('parlys:densitySwapOut', listener);
  },

  // Main process broadcasts this whenever the user moves the pill-scale
  // slider, so the compact renderer can re-stamp `--pill-scale` +
  // `data-window` in the same frame as the native setBounds.
  onPillScaleChanged: (cb: (scale: number) => void) => {
    const listener = (_e: unknown, scale: number) => cb(scale);
    ipcRenderer.on('parlys:pillScaleChanged', listener);
    return () => ipcRenderer.removeListener('parlys:pillScaleChanged', listener);
  },

  /**
   * Auto-updater API. See `src/main/updater.ts` for the state machine.
   * - `updaterCheck()` : fire a manual check (user clicked "Check for updates")
   * - `updaterInstall()` : quit & install a downloaded update
   * - `updaterGetState()` : hydrate the UI on mount (returns current phase)
   * - `onUpdaterState(cb)` : subscribe to state transitions
   */
  updaterCheck: (): Promise<void> => ipcRenderer.invoke(IPC.UPDATER_CHECK),
  updaterInstall: (): Promise<void> => ipcRenderer.invoke(IPC.UPDATER_INSTALL),
  updaterGetState: (): Promise<unknown> => ipcRenderer.invoke(IPC.UPDATER_GET_STATE),
  onUpdaterState: (cb: (state: unknown) => void) => {
    const listener = (_e: unknown, s: unknown) => cb(s);
    ipcRenderer.on(IPC.ON_UPDATER_STATE, listener);
    return () => ipcRenderer.removeListener(IPC.ON_UPDATER_STATE, listener);
  },
};

contextBridge.exposeInMainWorld('parlys', api);

export type ParlysAPI = typeof api;

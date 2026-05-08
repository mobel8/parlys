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
  TRANSCRIBE: 'voiceink:transcribe',
  INTERPRET: 'voiceink:interpret',
  ON_INTERPRET_CHUNK: 'voiceink:interpretChunk',
  LIST_VOICES: 'voiceink:listVoices',
  LISTENER_TRANSCRIBE: 'voiceink:listenerTranscribe',
  SPEAK: 'voiceink:speak',
  PREWARM: 'voiceink:prewarm',
  GET_SETTINGS: 'voiceink:getSettings',
  SET_SETTINGS: 'voiceink:setSettings',
  GET_HISTORY: 'voiceink:getHistory',
  ADD_HISTORY: 'voiceink:addHistory',
  DELETE_HISTORY: 'voiceink:deleteHistory',
  CLEAR_HISTORY: 'voiceink:clearHistory',
  INJECT_TEXT: 'voiceink:injectText',
  COPY_TEXT: 'voiceink:copyText',
  EXPORT: 'voiceink:export',
  ON_TOGGLE_RECORDING: 'voiceink:onToggleRecording',
  ON_SETTINGS_OPEN: 'voiceink:onSettingsOpen',
  ON_SETTINGS_CHANGED: 'voiceink:onSettingsChanged',
  WINDOW_MINIMIZE: 'voiceink:windowMinimize',
  WINDOW_CLOSE: 'voiceink:windowClose',
  WINDOW_MAXIMIZE: 'voiceink:windowMaximize',
  WINDOW_SET_ALWAYS_ON_TOP: 'voiceink:windowSetAlwaysOnTop',
  WINDOW_RESIZE_FOR_DENSITY: 'voiceink:windowResizeForDensity',
  WIDGET_CONTEXT_MENU: 'voiceink:widgetContextMenu',
  TOGGLE_PIN_HISTORY: 'voiceink:togglePinHistory',
  EXPORT_HISTORY: 'voiceink:exportHistory',
  GET_USAGE_STATS: 'voiceink:getUsageStats',
  SET_AUTO_START: 'voiceink:setAutoStart',
  ON_PTT_DOWN: 'voiceink:onPttDown',
  ON_PTT_UP: 'voiceink:onPttUp',
  LOG: 'voiceink:log',
  UPDATER_CHECK: 'voiceink:updaterCheck',
  UPDATER_INSTALL: 'voiceink:updaterInstall',
  UPDATER_GET_STATE: 'voiceink:updaterGetState',
  ON_UPDATER_STATE: 'voiceink:onUpdaterState',
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
    ok: boolean; text: string; translated?: string; sourceLang?: string; error?: string;
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
    ipcRenderer.on('voiceink:openSettings', listener);
    return () => ipcRenderer.removeListener('voiceink:openSettings', listener);
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
  rendererReady: () => ipcRenderer.send('voiceink:renderer-ready'),

  /**
   * Main fires this signal on the OUTGOING renderer just before it
   * hides + destroys the old window during a density swap. The
   * renderer adds `is-leaving` to <html> so the CSS fade-out plays
   * while the new window finishes painting off-screen. See the
   * "Density swap" CSS block in `index.css` for the transition rules.
   */
  onDensitySwapOut: (cb: () => void) => {
    const listener = () => cb();
    ipcRenderer.on('voiceink:densitySwapOut', listener);
    return () => ipcRenderer.removeListener('voiceink:densitySwapOut', listener);
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

contextBridge.exposeInMainWorld('voiceink', api);

export type VoiceInkAPI = typeof api;

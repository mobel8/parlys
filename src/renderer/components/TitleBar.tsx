import { Minus, Square, X, Mic, Minimize2, Pin, PinOff } from 'lucide-react';
import { useStore } from '../stores/useStore';

export function TitleBar() {
  const api = (window as any).voiceink;
  const { settings, updateSettings } = useStore();
  // This titlebar only renders in comfortable mode; the pill has no titlebar.
  const compact = false;

  /**
   * Switching to the pill triggers a full window recreation in the main
   * process. We do NOT update the local store first — doing so would
   * re-render this window with the pill UI for a frame before the window
   * gets destroyed, which flashes. Main persists the density setting, then
   * destroys and recreates the window transparently.
   */
  const goPill = async () => {
    await api?.windowResizeForDensity?.('compact');
  };

  const toggleOnTop = async () => {
    const next = !settings.alwaysOnTop;
    await updateSettings({ alwaysOnTop: next });
    await api?.windowSetAlwaysOnTop?.(next);
  };

  return (
    <div className={`drag flex items-center justify-between border-b border-white/5 bg-black/25 select-none ${compact ? 'h-8 px-2' : 'h-10 px-4'}`}>
      <div className="flex items-center gap-2 text-sm">
        <div className={`rounded-lg bg-gradient-to-br from-violet-500 to-fuchsia-500 grid place-items-center shadow-lg shadow-violet-500/40 ${compact ? 'w-5 h-5' : 'w-6 h-6'}`}>
          <Mic size={compact ? 11 : 13} className="text-white" />
        </div>
        <span className={`font-semibold tracking-tight ${compact ? 'text-[12px]' : ''}`}>VoiceInk</span>
        {!compact && <span className="text-[11px] text-white/30 ml-1">· Dictée IA</span>}
      </div>
      <div className={`no-drag flex items-center ${compact ? 'gap-0.5' : 'gap-1'}`}>
        <button
          className={`grid place-items-center rounded hover:bg-white/10 ${settings.alwaysOnTop ? 'text-fuchsia-300' : 'text-white/60 hover:text-white'} ${compact ? 'w-7 h-6' : 'w-8 h-7'}`}
          onClick={toggleOnTop}
          title={settings.alwaysOnTop ? 'Ne plus épingler au premier plan' : 'Épingler au premier plan'}
        >
          {settings.alwaysOnTop ? <Pin size={12} /> : <PinOff size={12} />}
        </button>
        <button
          className={`grid place-items-center rounded hover:bg-white/10 text-white/60 hover:text-white ${compact ? 'w-7 h-6' : 'w-8 h-7'}`}
          onClick={goPill}
          title="Passer en mode pilule flottante"
        >
          <Minimize2 size={12} />
        </button>
        <div className="w-2" />
        <button className={`grid place-items-center rounded hover:bg-white/10 text-white/60 hover:text-white ${compact ? 'w-7 h-6' : 'w-9 h-7'}`} onClick={() => api?.windowMinimize()} title="Réduire">
          <Minus size={compact ? 12 : 14} />
        </button>
        {!compact && (
          <button className="w-9 h-7 grid place-items-center rounded hover:bg-white/10 text-white/60 hover:text-white" onClick={() => api?.windowMaximize()} title="Agrandir">
            <Square size={12} />
          </button>
        )}
        <button className={`grid place-items-center rounded hover:bg-rose-500/80 text-white/60 hover:text-white ${compact ? 'w-7 h-6' : 'w-9 h-7'}`} onClick={() => api?.windowClose()} title="Fermer">
          <X size={compact ? 12 : 14} />
        </button>
      </div>
    </div>
  );
}

import React, { useEffect, useRef, useState } from 'react';
import { Settings2, X } from 'lucide-react';
import { useStore } from '../stores/useStore';
import { TTS_PROVIDERS } from '../lib/constants';
import { VoicePicker } from './VoicePicker';
import { SpeedSlider } from './SpeedSlider';
import type { TTSProvider } from '../../shared/types';

/**
 * Compact popover that lets the user swap voice + speed directly from
 * the dictation view without jumping into Settings.
 *
 * Design:
 *   - Trigger is a tiny gear icon rendered next to the active
 *     interpreter chip.
 *   - Popover anchors below the trigger (absolute positioning), backed
 *     by a glass panel. Closes on outside-click and on Escape so it
 *     doesn't trap the user.
 *   - Contents reuse `VoicePicker` + `SpeedSlider` exactly as Settings
 *     does, so the UX feels consistent and we avoid duplicating the
 *     voice-cache or speed-bucket logic here.
 *   - Reads and writes directly through `useStore().updateSettings`,
 *     so changes persist and are picked up by the continuous hook on
 *     the next phrase (both `ttsVoiceId[provider]` and `ttsSpeed` are
 *     read per-phrase in the main-process pipeline).
 */
export function VoiceQuickPopover() {
  const { settings, updateSettings } = useStore();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const providerId: TTSProvider = (settings.ttsProvider as TTSProvider) || 'cartesia';
  const provider = TTS_PROVIDERS.find((p) => p.id === providerId) ?? TTS_PROVIDERS[0];
  const currentVoice = settings.ttsVoiceId?.[providerId] || provider.voices[0]?.id || '';
  const currentApiKey = settings.ttsApiKey?.[providerId] || '';

  // Close on outside-click / Escape.
  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const save = async (patch: Parameters<typeof updateSettings>[0]) => {
    await updateSettings(patch);
  };

  // Build a fallback list from the curated catalog so the picker
  // still renders something useful if the user hasn't typed an API
  // key yet (or the catalog IPC is still warming up).
  const fallback = provider.voices.map((v) => ({
    id: v.id, name: v.name, language: (v.langs.split(',')[0] || '').trim() || 'multi',
  }));

  return (
    <div ref={containerRef} className="relative inline-flex items-center">
      <button
        type="button"
        onClick={(e) => { e.preventDefault(); setOpen((o) => !o); }}
        title="Changer la voix et la vitesse"
        className="inline-flex items-center justify-center w-5 h-5 rounded hover:bg-white/10 text-white/55 hover:text-white transition"
      >
        <Settings2 size={12} />
      </button>

      {open && (
        <div
          className="absolute right-0 top-full mt-2 z-50 w-[360px] rounded-2xl border border-white/10 bg-[var(--bg-1)] shadow-2xl p-3 space-y-3 slide-up"
          // Prevent a click inside from bubbling to the chip <label>
          // which would re-toggle whatever the label is bound to.
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between">
            <div className="text-xs font-semibold text-white/80">
              Voix · {provider.label.split(' ')[0]}
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="w-5 h-5 rounded hover:bg-white/10 text-white/55 hover:text-white flex items-center justify-center"
              title="Fermer"
            >
              <X size={11} />
            </button>
          </div>

          <VoicePicker
            provider={providerId}
            apiKey={currentApiKey}
            value={currentVoice}
            onChange={(id) => save({
              ttsVoiceId: { ...(settings.ttsVoiceId || {}), [providerId]: id },
            })}
            fallback={fallback}
            extraControls={
              <SpeedSlider
                value={settings.ttsSpeed ?? 1.0}
                onChange={(next) => save({ ttsSpeed: next })}
                provider={providerId}
                density="compact"
              />
            }
          />
        </div>
      )}
    </div>
  );
}

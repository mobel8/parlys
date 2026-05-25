import React, { useEffect, useState } from 'react';
import { Speaker, Mic, Headphones, RefreshCw, Check } from 'lucide-react';

/**
 * Audio device picker — wraps navigator.mediaDevices.enumerateDevices()
 * and lets the user pick an input (microphone) or output (speakers /
 * virtual-mic) device by deviceId.
 *
 * Why this matters for VoiceInk:
 *
 *   - **TTS output routing** (`kind: audiooutput`) — route the
 *     interpreter's synthesized voice to a virtual microphone (VB-Cable,
 *     VoiceMeeter, Krisp, OBS Virtual Audio) so the translation comes
 *     out on Discord / Zoom / Meet as if it were coming from your mic.
 *   - **Listener input selection** (`kind: audioinput`) — pick a
 *     loopback device ("Stereo Mix", virtual cable output) to capture
 *     what the remote caller is saying, rather than your own mic.
 *
 * Notes on the Chromium API quirks:
 *   - Before the user grants mic permission, the `label` field is
 *     empty for all devices. We trigger a silent `getUserMedia({ audio: true })`
 *     on mount so labels populate.
 *   - Device list changes over time (plugging headsets, enabling virtual
 *     cables) — we listen to `devicechange` to refresh live.
 *   - `deviceId === ''` means "system default", which is what we show
 *     when no preference is set.
 */

type Kind = 'audioinput' | 'audiooutput';

interface Props {
  kind: Kind;
  value: string;
  onChange: (deviceId: string) => void;
  placeholder?: string;
  hint?: string;
}

export function AudioDevicePicker({ kind, value, onChange, placeholder, hint }: Props) {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [permGranted, setPermGranted] = useState(false);
  const [loading, setLoading] = useState(false);

  const refresh = async () => {
    setLoading(true);
    try {
      const list = await navigator.mediaDevices.enumerateDevices();
      setDevices(list.filter((d) => d.kind === kind));
    } finally {
      setLoading(false);
    }
  };

  // Trigger mic permission once so labels become available.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach((t) => t.stop());
        if (!cancelled) setPermGranted(true);
      } catch {
        /* user denied — we still show IDs without labels */
      }
      if (!cancelled) await refresh();
    })();
    return () => { cancelled = true; };
  }, []);

  // Live updates when user plugs / unplugs devices.
  useEffect(() => {
    const handler = () => refresh();
    navigator.mediaDevices.addEventListener('devicechange', handler);
    return () => navigator.mediaDevices.removeEventListener('devicechange', handler);
  }, []);

  const icon = kind === 'audioinput' ? Mic : Speaker;
  const Icon = icon;
  const selected = devices.find((d) => d.deviceId === value);

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        <select
          className="select flex-1"
          value={value || ''}
          onChange={(e) => onChange(e.target.value)}
        >
          <option value="">
            {kind === 'audiooutput' ? 'Sortie par défaut (haut-parleurs)' : 'Micro par défaut'}
          </option>
          {devices.map((d) => (
            <option key={d.deviceId} value={d.deviceId}>
              {d.label || `${kind === 'audiooutput' ? 'Sortie' : 'Micro'} ${d.deviceId.slice(0, 8)}…`}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={refresh}
          className="btn btn-ghost"
          title="Rafraîchir la liste"
          disabled={loading}
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>
      {!permGranted && (
        <p className="text-[11px] text-amber-300/80">
          Autorisez l'accès micro pour voir les noms des périphériques.
        </p>
      )}
      {hint && (
        <p className="text-[11px] text-white/40">{hint}</p>
      )}
      {selected && (
        <div className="text-[11px] text-white/50 flex items-center gap-1.5">
          <Icon size={11} /> Actuel : {selected.label || selected.deviceId.slice(0, 12)}
        </div>
      )}
    </div>
  );
}

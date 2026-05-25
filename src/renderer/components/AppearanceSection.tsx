import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Palette, Sparkles, Sun, Moon, Check, Zap, Droplets, Waves, Film } from 'lucide-react';
import { useStore } from '../stores/useStore';
import { THEMES, THEME_ORDER, ThemeId, DEFAULT_EFFECTS, ThemeEffects, getTheme } from '../../shared/themes';
import { applyTheme } from '../lib/theme';

/**
 * Settings subsection: visual theme + effect tunables.
 *
 * Performance model for the sliders (glow / blur):
 *   1. A local `ThemeEffects` state drives the UI — updates are synchronous
 *      and trigger an immediate `applyTheme` so CSS vars on :root change
 *      right away (no IPC, no store round-trip, no re-render of App.tsx).
 *   2. Actual persistence (Zustand store + disk via IPC) is debounced so it
 *      only fires ~200ms after the user stops dragging.
 *   3. `onPointerUp` / `onKeyUp` flush the pending patch immediately so the
 *      store is consistent as soon as the interaction ends.
 *
 * This pattern eliminates the per-tick IPC cost that was causing jitter
 * and keeps the full repaint cost (backdrop blur) on the GPU only.
 */
export function AppearanceSection() {
  const settings = useStore((s) => s.settings);
  const updateSettings = useStore((s) => s.updateSettings);

  const currentId = (settings.themeId || 'midnight') as ThemeId;
  const storedEffects: ThemeEffects = useMemo(
    () => settings.themeEffects || DEFAULT_EFFECTS,
    [settings.themeEffects],
  );

  // Local state is the interactive source of truth.
  const [localEffects, setLocalEffects] = useState<ThemeEffects>(storedEffects);
  // Keep `localEffects` in sync if the store changes from elsewhere
  // (e.g. first hydration, reset via another UI path). While the user
  // drags, store changes originate from our own debounced commit, so the
  // resulting value is already equal to `localEffects` and this is a no-op.
  useEffect(() => {
    setLocalEffects(storedEffects);
  }, [storedEffects]);

  // Debounced persistence. We keep the latest pending patch in a ref and
  // flush it on a timer, on unmount, or on commit (pointer up / key up).
  const persistTimerRef = useRef<number | null>(null);
  const pendingPatchRef = useRef<Partial<ThemeEffects>>({});
  const latestEffectsRef = useRef<ThemeEffects>(storedEffects);
  latestEffectsRef.current = localEffects;

  const flush = useCallback(() => {
    if (persistTimerRef.current != null) {
      clearTimeout(persistTimerRef.current);
      persistTimerRef.current = null;
    }
    const patch = pendingPatchRef.current;
    if (Object.keys(patch).length === 0) return;
    pendingPatchRef.current = {};
    // Commit the full, merged effects — avoids partial writes clobbering
    // concurrent changes on other fields.
    updateSettings({ themeEffects: { ...latestEffectsRef.current } });
  }, [updateSettings]);

  const schedulePersist = useCallback(
    (patch: Partial<ThemeEffects>) => {
      pendingPatchRef.current = { ...pendingPatchRef.current, ...patch };
      if (persistTimerRef.current != null) clearTimeout(persistTimerRef.current);
      persistTimerRef.current = window.setTimeout(flush, 220);
    },
    [flush],
  );

  // Flush on unmount so nothing is lost.
  useEffect(() => {
    return () => {
      flush();
    };
  }, [flush]);

  /**
   * Live slider update path — synchronous, no IPC.
   * - Updates local state (triggers minimal re-render of the slider label).
   * - Writes CSS vars directly to :root via applyTheme.
   * - Schedules a debounced persistence.
   */
  const liveUpdate = useCallback(
    (patch: Partial<ThemeEffects>) => {
      setLocalEffects((prev) => {
        const next: ThemeEffects = { ...prev, ...patch };
        applyTheme(getTheme(currentId), next);
        return next;
      });
      schedulePersist(patch);
    },
    [currentId, schedulePersist],
  );

  /** Called on pointer up / key up — flush the debounced write right away. */
  const commitNow = useCallback(() => {
    flush();
  }, [flush]);

  /** Instant commit path for toggles & palette picks (infrequent, cheap). */
  const immediateUpdate = useCallback(
    (patch: Partial<ThemeEffects>) => {
      // Cancel any pending slider debounce first so we don't race with it.
      if (persistTimerRef.current != null) {
        clearTimeout(persistTimerRef.current);
        persistTimerRef.current = null;
      }
      pendingPatchRef.current = {};
      const next: ThemeEffects = { ...latestEffectsRef.current, ...patch };
      setLocalEffects(next);
      applyTheme(getTheme(currentId), next);
      updateSettings({ themeEffects: next });
    },
    [currentId, updateSettings],
  );

  const setTheme = useCallback(
    (id: ThemeId) => {
      // Apply the new palette immediately with the CURRENT effects so the
      // change is instantaneous, then persist.
      applyTheme(getTheme(id), latestEffectsRef.current);
      updateSettings({ themeId: id });
    },
    [updateSettings],
  );

  const resetEffects = useCallback(() => {
    if (persistTimerRef.current != null) {
      clearTimeout(persistTimerRef.current);
      persistTimerRef.current = null;
    }
    pendingPatchRef.current = {};
    setLocalEffects(DEFAULT_EFFECTS);
    applyTheme(getTheme(currentId), DEFAULT_EFFECTS);
    updateSettings({ themeEffects: DEFAULT_EFFECTS });
  }, [currentId, updateSettings]);

  return (
    <section className="glass rounded-2xl p-6 space-y-5">
      <div className="flex items-center gap-2">
        <Palette size={16} className="accent-text" />
        <h2 className="font-semibold text-lg">Apparence</h2>
      </div>

      <div>
        <div className="label mb-3">Thème de couleurs</div>
        <div className="grid gap-2.5" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(11rem, 1fr))' }}>
          {THEME_ORDER.map((id) => (
            <ThemeCard
              key={id}
              id={id}
              active={currentId === id}
              onPick={setTheme}
            />
          ))}
        </div>
      </div>

      {/* Effects */}
      <div className="pt-2 space-y-4">
        <div className="flex items-center gap-2">
          <Sparkles size={14} className="text-white/70" />
          <div className="label !mb-0">Effets visuels</div>
        </div>

        <SliderRow
          icon={<Zap size={13} />}
          label="Intensité du glow"
          value={localEffects.glowIntensity}
          min={0}
          max={100}
          step={1}
          onInput={(v) => liveUpdate({ glowIntensity: v })}
          onCommit={commitNow}
          format={(v) => `${v}%`}
        />
        <SliderRow
          icon={<Droplets size={13} />}
          label="Flou des surfaces de verre"
          value={localEffects.blurStrength}
          min={0}
          max={30}
          step={1}
          onInput={(v) => liveUpdate({ blurStrength: v })}
          onCommit={commitNow}
          format={(v) => `${v}px`}
        />

        <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(16rem, 1fr))' }}>
          <ToggleChip
            icon={<Waves size={13} />}
            label="Aurora animée"
            desc="Dégradés qui flottent lentement en arrière-plan."
            value={localEffects.animateAura}
            onChange={(v) => immediateUpdate({ animateAura: v })}
          />
          <ToggleChip
            icon={<Sun size={13} />}
            label="Aurora visible"
            desc="Afficher le halo coloré d'ambiance."
            value={localEffects.auraEnabled}
            onChange={(v) => immediateUpdate({ auraEnabled: v })}
          />
          <ToggleChip
            icon={<Sparkles size={13} />}
            label="Reflet au survol"
            desc="Shimmer diagonal sur les panneaux au passage de la souris."
            value={localEffects.shimmer}
            onChange={(v) => immediateUpdate({ shimmer: v })}
          />
          <ToggleChip
            icon={<Film size={13} />}
            label="Grain cinématique"
            desc="Fin bruit d'ambiance superposé (look premium)."
            value={localEffects.grain}
            onChange={(v) => immediateUpdate({ grain: v })}
          />
        </div>

        <button
          className="btn btn-ghost !text-xs !py-1"
          onClick={resetEffects}
          title="Réinitialiser les effets"
        >
          <Moon size={12} /> Réinitialiser aux valeurs par défaut
        </button>
      </div>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/*  Sub-components                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Memoised palette card — prevents re-render when the user drags a slider,
 * since the palette list never changes while interacting with effects.
 */
const ThemeCard = memo(function ThemeCard({
  id,
  active,
  onPick,
}: {
  id: ThemeId;
  active: boolean;
  onPick: (id: ThemeId) => void;
}) {
  const t = THEMES[id];
  return (
    <button
      onClick={() => onPick(id)}
      className={`theme-card group relative text-left rounded-xl p-3 border ${
        active ? 'border-white/30 ring-2 ring-white/20' : 'border-white/8 hover:border-white/20'
      }`}
      style={{
        background: `linear-gradient(135deg, ${t.palette.bg1}, ${t.palette.bg0})`,
      }}
    >
      <div className="flex items-center justify-between mb-2">
        <div className="text-sm font-semibold" style={{ color: t.palette.text }}>
          {t.name}
        </div>
        {active && (
          <div
            className="w-5 h-5 rounded-full grid place-items-center"
            style={{ background: t.palette.accent1, boxShadow: `0 0 12px ${t.palette.accent1}` }}
          >
            <Check size={11} color="white" />
          </div>
        )}
      </div>

      {/* Palette dots */}
      <div className="flex items-center gap-1 mb-2">
        {[t.palette.accent1, t.palette.accent2, t.palette.accent3].map((c, i) => (
          <div
            key={i}
            className="w-4 h-4 rounded-full"
            style={{
              background: c,
              boxShadow: `0 0 10px ${c}80, inset 0 1px 2px rgba(255,255,255,0.2)`,
            }}
          />
        ))}
      </div>

      {/* Preview strip with gradient */}
      <div
        className="h-6 rounded-md opacity-80"
        style={{
          background: `linear-gradient(90deg, ${t.palette.accent1}, ${t.palette.accent2}, ${t.palette.accent3})`,
        }}
      />

      <div className="text-[10px] mt-2 leading-tight" style={{ color: t.palette.textDim }}>
        {t.description}
      </div>
    </button>
  );
});

/**
 * Range slider row with a correctly-filled track.
 *
 * The `.range-input` class in index.css draws the track as a two-stop
 * gradient using the custom properties `--val`, `--min`, `--max`. We set
 * them inline per-input so the fill matches the current value (this is
 * what was missing before — the track always appeared filled at 50%).
 */
function SliderRow({
  icon,
  label,
  value,
  min,
  max,
  step = 1,
  onInput,
  onCommit,
  format,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onInput: (v: number) => void;
  onCommit: () => void;
  format?: (v: number) => string;
}) {
  // Inline percentage drives the filled-track gradient defined in index.css.
  // Computing it here (instead of with calc() on unregistered custom props)
  // avoids any parsing edge case and stays a pure string/percentage value.
  const clamped = Math.max(min, Math.min(max, value));
  const pct = max > min ? ((clamped - min) / (max - min)) * 100 : 0;
  const style = {
    ['--pct' as any]: `${pct}%`,
  } as React.CSSProperties;

  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-1.5 text-[13px] text-white/80">
          <span className="text-white/60">{icon}</span>
          {label}
        </div>
        <span className="text-[11px] font-mono text-white/60 tabular-nums">
          {format ? format(value) : value}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onInput(Number(e.currentTarget.value))}
        onPointerUp={onCommit}
        onKeyUp={onCommit}
        onBlur={onCommit}
        className="range-input"
        style={style}
      />
    </div>
  );
}

function ToggleChip({ icon, label, desc, value, onChange }: {
  icon: React.ReactNode;
  label: string;
  desc: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!value)}
      className={`text-left px-3 py-2.5 rounded-xl border transition-colors ${
        value ? 'border-white/25 bg-white/[0.04]' : 'border-white/8 bg-transparent hover:bg-white/[0.02]'
      }`}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-[13px] font-medium">
          <span className={value ? 'accent-text' : 'text-white/50'}>{icon}</span>
          {label}
        </div>
        <div className={`switch !w-9 !h-5 ${value ? 'on' : ''}`} />
      </div>
      <div className="text-[11px] text-white/45 mt-0.5">{desc}</div>
    </button>
  );
}

import React, { useEffect, useState } from 'react';
import { Eye, EyeOff, ExternalLink, Check, Layout, Languages, Pin, Keyboard, Power, Volume2, Zap, Palette, Book, Workflow as WorkflowIcon, Brain, Mic, Headphones, Speaker, Globe } from 'lucide-react';
import { useStore } from '../stores/useStore';
import { GROQ_STT_MODELS, SUPPORTED_LANGUAGES, TRANSLATE_TARGETS, TTS_PROVIDERS, INTERPRETER_LANGUAGES } from '../lib/constants';
import { Settings, TTSProvider } from '../../shared/types';
import { AppearanceSection } from './AppearanceSection';
import { ReplacementsSection } from './ReplacementsSection';
import { VoicePicker } from './VoicePicker';
import { AudioDevicePicker } from './AudioDevicePicker';
import { SpeedSlider } from './SpeedSlider';
import { useT } from '../lib/i18n';
import { SUPPORTED_UI_LANGUAGES, type UILanguage } from '../../shared/i18n';

export function SettingsView() {
  const { settings, updateSettings } = useStore();
  const t = useT();
  const [showKey, setShowKey] = useState(false);
  const [showLlmKey, setShowLlmKey] = useState(false);
  const [savedPulse, setSavedPulse] = useState(false);

  const api = (window as any).voiceink;

  const save = async (patch: Partial<Settings>) => {
    await updateSettings(patch);
    setSavedPulse(true);
    setTimeout(() => setSavedPulse(false), 1200);
  };

  const setDensity = async (next: 'comfortable' | 'compact') => {
    if (settings.density === next) return;
    // Don't save via store first — the main process will persist the density
    // and recreate the window (required for transparency toggling). Saving
    // locally before recreation would cause a visible UI flash in the
    // current window.
    await api?.windowResizeForDensity?.(next);
  };

  const setAlwaysOnTop = async (next: boolean) => {
    await save({ alwaysOnTop: next });
    await api?.windowSetAlwaysOnTop?.(next);
  };

  const setAutoStart = async (next: boolean) => {
    // Round-trips to main so it can also call app.setLoginItemSettings().
    const res = await api?.setAutoStart?.(next);
    if (res?.ok) {
      await updateSettings({ autoStart: next });
      setSavedPulse(true);
      setTimeout(() => setSavedPulse(false), 1200);
    } else if (res?.error) {
      alert('Impossible d\'activer le démarrage automatique : ' + res.error);
    }
  };

  return (
    <div className="px-8 py-8 max-w-3xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight"><span className="gradient-text">Paramètres</span></h1>
          <p className="text-white/50 text-sm mt-1">Configurez votre moteur et votre expérience.</p>
        </div>
        {savedPulse && (
          <span className="badge badge-green fade-in"><Check size={10} /> Sauvegardé</span>
        )}
      </div>

      <SettingsNav />

      {/* Appearance (theme + effects) */}
      <div id="sec-appearance" className="scroll-mt-20">
        <AppearanceSection />
      </div>

      {/* Interface */}
      <section id="sec-interface" className="glass rounded-2xl p-6 space-y-4 scroll-mt-20">
        <div className="flex items-center gap-2">
          <Layout size={16} className="accent-text" />
          <h2 className="font-semibold text-lg">{t('settings.section.interface')}</h2>
        </div>

        {/* App language (i18n) — placed at the TOP of the Interface section
            so an English-speaking user who accidentally launched in French
            can find the switch without reading any other French label. */}
        <div>
          <div className="label mb-2 flex items-center gap-2">
            <Globe size={12} className="accent-text" />
            {t('settings.uiLanguage.label')}
          </div>
          <select
            className="select"
            value={settings.uiLanguage || 'auto'}
            onChange={(e) => save({ uiLanguage: e.target.value as UILanguage })}
          >
            {SUPPORTED_UI_LANGUAGES.map((l) => (
              <option key={l.code} value={l.code}>
                {l.code === 'auto' ? `${l.native} (${l.englishName})` : `${l.native} — ${l.englishName}`}
              </option>
            ))}
          </select>
          <p className="text-[11px] text-white/40 mt-2">{t('settings.uiLanguage.hint')}</p>
        </div>

        <div>
          <div className="label mb-2">{t('settings.density.label')}</div>
          <div className="seg">
            <button
              className={settings.density === 'comfortable' ? 'active' : ''}
              onClick={() => setDensity('comfortable')}
            >
              {t('settings.density.comfortable')}
            </button>
            <button
              className={settings.density === 'compact' ? 'active' : ''}
              onClick={() => setDensity('compact')}
            >
              {t('settings.density.compact')}
            </button>
          </div>
          <p className="text-[11px] text-white/40 mt-2">{t('settings.density.hint')}</p>
        </div>

        <ToggleRow
          label={t('settings.alwaysOnTop')}
          desc={t('settings.alwaysOnTop.desc')}
          icon={<Pin size={14} />}
          value={settings.alwaysOnTop}
          onChange={setAlwaysOnTop}
        />
      </section>

      {/* Replacements / custom dictionary */}
      <div id="sec-replacements" className="scroll-mt-20">
        <ReplacementsSection />
      </div>

      {/* Voice Interpreter */}
      <div id="sec-interpreter" className="scroll-mt-20">
        <InterpreterSection />
      </div>

      {/* Translation */}
      <section id="sec-translation" className="glass rounded-2xl p-6 space-y-4 scroll-mt-20">
        <div className="flex items-center gap-2">
          <Languages size={16} className="text-fuchsia-300" />
          <h2 className="font-semibold text-lg">Traduction automatique</h2>
        </div>
        <p className="text-white/50 text-sm">
          Traduisez votre dictée à la volée vers la langue de votre choix.
          La traduction s'applique après la transcription et avant l'injection
          dans l'application cible.
        </p>

        <div>
          <div className="label mb-2">Traduire vers</div>
          <select
            className="select"
            value={settings.translateTo}
            onChange={(e) => save({ translateTo: e.target.value })}
          >
            {TRANSLATE_TARGETS.map((t) => (
              <option key={t.code || 'none'} value={t.code}>
                {t.code ? `→ ${t.native}` : 'Aucune (garder la langue d\'origine)'}
              </option>
            ))}
          </select>
          <p className="text-[11px] text-white/40 mt-2">
            Utilise le modèle Groq llama-3.3-70b (≈300-600 ms). Nécessite la clé Groq.
          </p>
        </div>

        {settings.translateTo && (
          <div className="slide-up">
            <div className="label mb-2">Modèle de traduction</div>
            <select
              className="select"
              value={settings.translateModel}
              onChange={(e) => save({ translateModel: e.target.value })}
            >
              <option value="llama-3.3-70b-versatile">llama-3.3-70b-versatile (recommandé)</option>
              <option value="llama-3.1-8b-instant">llama-3.1-8b-instant (plus rapide)</option>
              <option value="llama-3.3-70b-specdec">llama-3.3-70b-specdec (speculative decoding)</option>
            </select>
          </div>
        )}
      </section>

      {/* Groq API */}
      <section id="sec-transcription" className="glass rounded-2xl p-6 space-y-4 scroll-mt-20">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-lg">Moteur de transcription</h2>
          <a href="https://console.groq.com/keys" target="_blank" rel="noreferrer" className="text-xs text-violet-300 hover:text-violet-200 inline-flex items-center gap-1">
            Obtenir une clé <ExternalLink size={12} />
          </a>
        </div>

        <div>
          <div className="label mb-2">Clé API Groq</div>
          <div className="flex gap-2">
            <input
              type={showKey ? 'text' : 'password'}
              className="input font-mono"
              placeholder="gsk_..."
              value={settings.groqApiKey}
              onChange={(e) => save({ groqApiKey: e.target.value.trim() })}
            />
            <button className="btn btn-ghost" onClick={() => setShowKey(!showKey)}>
              {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
          </div>
          <p className="text-[11px] text-white/40 mt-2">Stockée localement. Jamais envoyée ailleurs que vers l'API Groq.</p>
        </div>

        <div>
          <div className="label mb-2">Modèle Whisper</div>
          <select className="select" value={settings.sttModel} onChange={(e) => save({ sttModel: e.target.value })}>
            {GROQ_STT_MODELS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
          </select>
        </div>

        <div>
          <div className="label mb-2">Langue par défaut</div>
          <select className="select" value={settings.language} onChange={(e) => save({ language: e.target.value })}>
            {SUPPORTED_LANGUAGES.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
          </select>
        </div>
      </section>

      {/* Workflow */}
      <section id="sec-workflow" className="glass rounded-2xl p-6 space-y-4 scroll-mt-20">
        <h2 className="font-semibold text-lg">Workflow</h2>
        <ToggleRow
          label="Copie automatique"
          desc="Copier la transcription dans le presse-papier."
          value={settings.autoCopy}
          onChange={(v) => save({ autoCopy: v })}
        />
        <ToggleRow
          label="Injection automatique"
          desc="Coller automatiquement dans l'application active (Ctrl+V)."
          value={settings.autoInject}
          onChange={(v) => save({ autoInject: v })}
        />
      </section>

      {/* LLM */}
      <section id="sec-llm" className="glass rounded-2xl p-6 space-y-4 scroll-mt-20">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-lg">Post-traitement LLM</h2>
          <Switch value={settings.llmEnabled} onChange={(v) => save({ llmEnabled: v })} />
        </div>
        <p className="text-white/50 text-sm">Nettoie / reformule automatiquement selon le mode choisi. Désactivé en mode "Brut".</p>

        {settings.llmEnabled && (
          <div className="space-y-4 slide-up">
            <div>
              <div className="label mb-2">Fournisseur</div>
              <select className="select" value={settings.llmProvider} onChange={(e) => save({ llmProvider: e.target.value as Settings['llmProvider'] })}>
                <option value="groq">Groq (rapide, utilise la même clé)</option>
                <option value="openai">OpenAI</option>
                <option value="anthropic">Anthropic (Claude)</option>
                <option value="ollama">Ollama (local)</option>
              </select>
            </div>
            <div>
              <div className="label mb-2">Modèle</div>
              <input className="input font-mono" value={settings.llmModel} onChange={(e) => save({ llmModel: e.target.value })} />
            </div>
            {(settings.llmProvider === 'openai' || settings.llmProvider === 'anthropic') && (
              <div>
                <div className="label mb-2">Clé API</div>
                <div className="flex gap-2">
                  <input
                    type={showLlmKey ? 'text' : 'password'}
                    className="input font-mono"
                    value={settings.llmApiKey}
                    onChange={(e) => save({ llmApiKey: e.target.value.trim() })}
                  />
                  <button className="btn btn-ghost" onClick={() => setShowLlmKey(!showLlmKey)}>
                    {showLlmKey ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </section>

      {/* Shortcuts */}
      <section id="sec-shortcuts" className="glass rounded-2xl p-6 space-y-4 scroll-mt-20">
        <div className="flex items-center gap-2">
          <Keyboard size={16} className="accent-text" />
          <h2 className="font-semibold text-lg">Raccourcis globaux</h2>
        </div>
        <div>
          <div className="label mb-2">Démarrer / Arrêter (toggle)</div>
          <ShortcutInput
            value={settings.shortcutToggle}
            onCommit={(next) => save({ shortcutToggle: next })}
            placeholder="CommandOrControl+Shift+Space"
          />
          <p className="text-[11px] text-white/40 mt-1">
            Cliquez dans le champ puis appuyez sur la combinaison souhaitée. S'applique instantanément — plus besoin de redémarrer.
          </p>
        </div>

        {/* Voice-translator hotkey — instant flip of interpreterEnabled from anywhere. */}
        <div className="pt-2 border-t border-white/5">
          <div className="label mb-2 flex items-center gap-2">
            <Volume2 size={12} className="text-emerald-300" />
            Activer / désactiver l'interprète vocal
          </div>
          <ShortcutInput
            value={settings.shortcutInterpreter || ''}
            onCommit={(next) => save({ shortcutInterpreter: next })}
            placeholder="CommandOrControl+Shift+I"
          />
          <p className="text-[11px] text-white/40 mt-1">
            Bascule instantanément le traducteur vocal (pastille verte en haut à droite). La prochaine dictée passera
            par Whisper → traduction → voix IA. Laissez vide pour désactiver le raccourci.
          </p>
        </div>

        <div className="pt-2 border-t border-white/5">
          <ToggleRow
            label="Push-to-Talk"
            desc="Maintenir un raccourci pour parler, relâcher pour arrêter. Plus rapide que le toggle pour de courtes dictées."
            icon={<Keyboard size={14} />}
            value={!!settings.pttEnabled}
            onChange={(v) => save({ pttEnabled: v })}
          />
          {settings.pttEnabled && (
            <div className="mt-3 slide-up">
              <div className="label mb-2">Raccourci Push-to-Talk</div>
              <ShortcutInput
                value={settings.shortcutPTT}
                onCommit={(next) => save({ shortcutPTT: next })}
                placeholder="CommandOrControl+Shift+V"
              />
              <p className="text-[11px] text-white/40 mt-1">
                Le mode Push-to-Talk démarre l'enregistrement à la première pression et le stoppe à la suivante.
                Les raccourcis globaux Electron ne reçoivent pas les événements de relâchement sous Windows.
              </p>
            </div>
          )}
        </div>
      </section>

      {/* System */}
      <section id="sec-system" className="glass rounded-2xl p-6 space-y-4 scroll-mt-20">
        <div className="flex items-center gap-2">
          <Power size={16} className="accent-text" />
          <h2 className="font-semibold text-lg">Système</h2>
        </div>
        <ToggleRow
          label="Lancer VoiceInk au démarrage de Windows"
          desc="L'app se lancera automatiquement à chaque ouverture de session."
          icon={<Power size={14} />}
          value={!!settings.autoStart}
          onChange={setAutoStart}
        />
        <ToggleRow
          label="Démarrer en arrière-plan"
          desc="Au lancement, ne pas afficher la fenêtre principale — rester dans le tray / en pilule."
          icon={<Layout size={14} />}
          value={!!settings.startMinimized}
          onChange={(v) => save({ startMinimized: v })}
        />
        <ToggleRow
          label="Sons de notification"
          desc="Joue un bip subtil au début et à la fin de l'enregistrement."
          icon={<Volume2 size={14} />}
          value={!!settings.soundsEnabled}
          onChange={(v) => save({ soundsEnabled: v })}
        />
      </section>
    </div>
  );
}

/**
 * Minimalist sticky navigation bar for the Settings view.
 *
 * Design goals (validated by users on 2026-04-22):
 *   - Glanceable: icons only, no labels by default — tooltip on hover.
 *   - Compact: single pill-shaped row, ~40px tall, self-centering.
 *   - Live: IntersectionObserver highlights the currently visible
 *     section as the user scrolls, so the nav doubles as a progress
 *     indicator.
 *   - Frictionless: one click = smooth scroll to the section's top,
 *     accounting for the sticky nav's own height via `scroll-mt-20`.
 *
 * The ten sections map 1:1 with the <section id="sec-…"> blocks
 * above, in the same top-to-bottom order that greets the user.
 */
const SETTINGS_SECTIONS: Array<{ id: string; icon: React.ComponentType<{ size?: number | string }>; label: string }> = [
  { id: 'sec-appearance',    icon: Palette,       label: 'Apparence' },
  { id: 'sec-interface',     icon: Layout,        label: 'Interface' },
  { id: 'sec-replacements',  icon: Book,          label: 'Dictionnaire' },
  { id: 'sec-interpreter',   icon: Volume2,       label: 'Traducteur vocal' },
  { id: 'sec-translation',   icon: Languages,     label: 'Traduction' },
  { id: 'sec-transcription', icon: Zap,           label: 'Transcription' },
  { id: 'sec-workflow',      icon: WorkflowIcon,  label: 'Workflow' },
  { id: 'sec-llm',           icon: Brain,         label: 'Post-traitement' },
  { id: 'sec-shortcuts',     icon: Keyboard,      label: 'Raccourcis' },
  { id: 'sec-system',        icon: Power,         label: 'Système' },
];

function SettingsNav() {
  const [active, setActive] = useState(SETTINGS_SECTIONS[0].id);

  useEffect(() => {
    // Observer sur les sections. rootMargin aligné pour privilégier
    // la section qui occupe le tiers supérieur du viewport (plus
    // naturel quand on scrolle depuis le haut).
    const observer = new IntersectionObserver(
      (entries) => {
        // Sélectionne la section intersectante la plus haute dans le
        // viewport — évite les sautillements quand deux sections
        // courtes sont visibles en même temps.
        const visibles = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visibles[0]) setActive(visibles[0].target.id);
      },
      { rootMargin: '-80px 0px -60% 0px', threshold: 0 },
    );
    SETTINGS_SECTIONS.forEach(({ id }) => {
      const el = document.getElementById(id);
      if (el) observer.observe(el);
    });
    return () => observer.disconnect();
  }, []);

  const scrollTo = (id: string) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setActive(id);
  };

  return (
    <div className="sticky top-0 z-20 -mx-8 px-8 pt-2 pb-3 pointer-events-none">
      <nav
        className="pointer-events-auto mx-auto flex items-center gap-0.5 rounded-full border border-white/10 bg-black/40 backdrop-blur-xl shadow-[0_8px_24px_-12px_rgba(0,0,0,0.6)] px-1.5 py-1.5 w-fit"
        aria-label="Navigation paramètres"
      >
        {SETTINGS_SECTIONS.map(({ id, icon: Icon, label }) => {
          const isActive = active === id;
          return (
            <button
              key={id}
              type="button"
              onClick={() => scrollTo(id)}
              className={`
                group relative w-8 h-8 rounded-full flex items-center justify-center
                transition-all duration-200 ease-out outline-none
                ${isActive
                  ? 'bg-violet-500/25 text-violet-100 ring-1 ring-violet-400/40 shadow-[0_0_10px_-2px_rgba(167,139,250,0.5)]'
                  : 'text-white/50 hover:text-white hover:bg-white/10'}
              `}
              aria-label={label}
              aria-current={isActive ? 'true' : undefined}
            >
              <Icon size={14} />
              <span
                className="
                  absolute top-full left-1/2 -translate-x-1/2 mt-2
                  px-2 py-1 text-[10px] font-medium whitespace-nowrap
                  bg-black/90 text-white/90 rounded-md border border-white/10
                  opacity-0 group-hover:opacity-100 transition-opacity duration-150
                  pointer-events-none shadow-lg
                "
              >
                {label}
              </span>
            </button>
          );
        })}
      </nav>
    </div>
  );
}

function ToggleRow({ label, desc, value, onChange, icon }: { label: string; desc: string; value: boolean; onChange: (v: boolean) => void; icon?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-6">
      <div className="flex items-start gap-2 min-w-0">
        {icon && <span className="text-white/60 mt-0.5">{icon}</span>}
        <div className="min-w-0">
          <div className="font-medium">{label}</div>
          <div className="text-white/50 text-xs">{desc}</div>
        </div>
      </div>
      <Switch value={value} onChange={onChange} />
    </div>
  );
}

function Switch({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className={`switch ${value ? 'on' : ''}`} onClick={() => onChange(!value)} role="switch" aria-checked={value} />
  );
}

/**
 * Keyboard-capture input that builds a valid Electron accelerator
 * string from a real keypress. Forces the user through the supported
 * format (CommandOrControl+Shift+X) instead of free-form typing where
 * a typo silently unbinds the shortcut.
 *
 * Behaviour:
 *   - Click inside → input enters "recording" mode (placeholder
 *     becomes "Appuyez sur la combinaison…", focus ring turns
 *     emerald).
 *   - Next keypress where at least one modifier is held (Ctrl/
 *     Cmd/Shift/Alt) captures the accelerator, commits it, and
 *     exits recording mode.
 *   - Escape exits recording mode without committing (useful to
 *     bail out mid-capture).
 *   - Backspace/Delete with no modifier → clears the binding
 *     (commits empty string). Lets the user unbind a hotkey
 *     without guessing what to type.
 *
 * The 1:1 mapping from KeyboardEvent to accelerator string mirrors
 * Electron's format so `globalShortcut.register(value)` in main
 * accepts the output verbatim. Every platform-agnostic modifier
 * uses the `CommandOrControl` alias rather than `Control` / `Meta`
 * so a binding made on Windows still works on macOS.
 */
function ShortcutInput({
  value,
  onCommit,
  placeholder,
}: {
  value: string;
  onCommit: (next: string) => void;
  placeholder?: string;
}) {
  const [recording, setRecording] = useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);

  const formatKey = (e: React.KeyboardEvent<HTMLInputElement>): string | null => {
    // Ignore pure-modifier presses — we wait for an actual key to be
    // combined with at least one modifier.
    const mods: string[] = [];
    if (e.ctrlKey || e.metaKey) mods.push('CommandOrControl');
    if (e.altKey) mods.push('Alt');
    if (e.shiftKey) mods.push('Shift');

    const k = e.key;
    // Reject bare modifier keys ("Control", "Shift", "Alt", "Meta")
    // and dead keys — we want a real trailing letter/number/Fn.
    if (['Control', 'Shift', 'Alt', 'Meta', 'OS', 'ContextMenu', 'Dead'].includes(k)) return null;

    // Normalize special keys to the exact names Electron expects.
    // See https://www.electronjs.org/docs/latest/api/accelerator.
    const keyMap: Record<string, string> = {
      ' ': 'Space',
      Escape: 'Esc',
      ArrowUp: 'Up',
      ArrowDown: 'Down',
      ArrowLeft: 'Left',
      ArrowRight: 'Right',
      '+': 'Plus',
    };
    let key = keyMap[k] ?? k;
    // Single-letter printable characters must be uppercased.
    if (key.length === 1) key = key.toUpperCase();

    // Require at least ONE modifier (prevents lone-letter bindings
    // that would swallow the key everywhere on the OS).
    if (mods.length === 0) return null;

    return [...mods, key].join('+');
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!recording) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.key === 'Escape') {
      setRecording(false);
      inputRef.current?.blur();
      return;
    }
    if ((e.key === 'Backspace' || e.key === 'Delete') && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
      onCommit('');
      setRecording(false);
      inputRef.current?.blur();
      return;
    }
    const acc = formatKey(e);
    if (acc) {
      onCommit(acc);
      setRecording(false);
      inputRef.current?.blur();
    }
  };

  return (
    <input
      ref={inputRef}
      type="text"
      readOnly
      className="input font-mono"
      style={recording ? { borderColor: 'rgba(16,185,129,0.5)', boxShadow: '0 0 0 2px rgba(16,185,129,0.15)' } : undefined}
      value={recording ? '' : (value || '')}
      placeholder={recording ? 'Appuyez sur la combinaison… (Échap pour annuler, Retour arrière pour effacer)' : placeholder}
      onFocus={() => setRecording(true)}
      onBlur={() => setRecording(false)}
      onKeyDown={handleKeyDown}
    />
  );
}


/**
 * Voice interpreter configuration — provider + per-provider voice
 * + per-provider API key + target language + continuous mode toggle.
 *
 * Design notes:
 *   - The per-provider voice/key state lets the user flip between
 *     providers without losing their previously-pasted keys. Switching
 *     ttsProvider just changes what the two inputs below address.
 *   - The voice picker is a <select> pre-populated with our curated
 *     shortlist + a "Custom ID…" option that reveals a free-form
 *     input for advanced users (voice cloning, lab voices, etc.).
 *   - The continuous toggle is wired but gated behind a "Beta" badge
 *     because the VAD pipeline ships in the same release and hasn't
 *     had weeks of field-testing yet.
 */
function InterpreterSection() {
  const { settings, updateSettings } = useStore();
  const [showTtsKey, setShowTtsKey] = useState(false);

  const providerId = settings.ttsProvider || 'cartesia';
  const provider = TTS_PROVIDERS.find((p) => p.id === providerId) || TTS_PROVIDERS[0];
  const currentVoiceId = settings.ttsVoiceId?.[providerId] || provider.voices[0]?.id || '';
  const currentApiKey = settings.ttsApiKey?.[providerId] || '';
  const isCurated = provider.voices.some((v) => v.id === currentVoiceId);

  const save = (patch: Partial<Settings>) => updateSettings(patch);
  const setProvider = (id: TTSProvider) => save({ ttsProvider: id });
  const setVoice = (voiceId: string) => save({
    ttsVoiceId: { ...(settings.ttsVoiceId || {}), [providerId]: voiceId },
  });
  const setApiKey = (key: string) => save({
    ttsApiKey: { ...(settings.ttsApiKey || {}), [providerId]: key.trim() },
  });

  return (
    <section className="glass rounded-2xl p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Volume2 size={16} className="text-emerald-300" />
          <h2 className="font-semibold text-lg">Traducteur vocal (interprète)</h2>
          <span className="badge" style={{ borderColor: 'rgba(16,185,129,0.4)', color: '#6ee7b7' }}>
            Nouveau
          </span>
        </div>
        <Switch
          value={!!settings.interpreterEnabled}
          onChange={(v) => save({ interpreterEnabled: v })}
        />
      </div>
      <p className="text-white/50 text-sm">
        Parlez dans votre langue — VoiceInk traduit instantanément et prononce le résultat
        avec une voix IA réaliste. Idéal pour réunions multilingues, appels visio, ou tester
        une tournure dans une autre langue. Indépendant des 4 modes de dictée classiques.
      </p>

      {/* Global master: mute spoken output (affects interpreter + listener). */}
      <div className="pt-2 border-t border-white/5">
        <ToggleRow
          label="Prononcer la traduction à voix haute"
          desc="Quand désactivé, seul le texte traduit est produit : aucun appel TTS n'est fait (Cartesia/ElevenLabs non sollicités, économies de crédits). S'applique aussi au mode « Écouter une conversation »."
          icon={<Volume2 size={14} />}
          value={settings.speakTranslations !== false}
          onChange={(v) => save({ speakTranslations: v })}
        />
      </div>

      {settings.interpreterEnabled && (
        <div className="space-y-4 slide-up">
          {/* Target language */}
          <div>
            <div className="label mb-2">Langue parlée en sortie</div>
            <select
              className="select"
              value={settings.interpretTargetLang || 'en'}
              onChange={(e) => save({ interpretTargetLang: e.target.value })}
            >
              {INTERPRETER_LANGUAGES.map((t) => (
                <option key={t.code} value={t.code}>→ {t.label}</option>
              ))}
            </select>
            <p className="text-[11px] text-white/40 mt-2">
              Si votre dictée est dans une autre langue, Whisper la détecte automatiquement
              avant traduction.
            </p>
          </div>

          {/* Provider picker */}
          <div>
            <div className="label mb-2">Moteur de voix</div>
            <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(12rem, 1fr))' }}>
              {TTS_PROVIDERS.map((p) => {
                const active = p.id === providerId;
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setProvider(p.id)}
                    className="glass rounded-xl p-3 text-left transition"
                    style={{
                      borderColor: active ? 'rgba(16,185,129,0.5)' : 'rgba(255,255,255,0.08)',
                      background: active ? 'rgba(16,185,129,0.08)' : 'transparent',
                    }}
                  >
                    <div className="flex items-center gap-2">
                      <Zap size={12} className={active ? 'text-emerald-300' : 'text-white/40'} />
                      <span className="font-medium text-sm">{p.label}</span>
                      {active && <Check size={12} className="text-emerald-300 ml-auto" />}
                    </div>
                    <p className="text-[11px] text-white/50 mt-1">{p.desc}</p>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Voice picker — full catalog with search + filters */}
          <div>
            <div className="label mb-2">Voix ({provider.label})</div>
            <VoicePicker
              provider={providerId}
              apiKey={currentApiKey}
              value={currentVoiceId}
              onChange={setVoice}
              fallback={provider.voices.map((v) => ({
                id: v.id,
                name: v.name,
                description: v.langs,
              }))}
            />
            <div className="mt-2">
              <input
                className="input font-mono text-xs"
                placeholder="ID personnalisé (voix clonée, lab voice…)"
                value={currentVoiceId}
                onChange={(e) => setVoice(e.target.value.trim())}
              />
              <p className="text-[11px] text-white/40 mt-1">
                Collez ici un UUID si vous utilisez une voix clonée via l'API du fournisseur.
              </p>
            </div>
          </div>

          {/* API key for the selected provider */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <div className="label">Clé API {provider.label}</div>
              <a
                href={provider.keyUrl}
                target="_blank"
                rel="noreferrer"
                className="text-xs text-emerald-300 hover:text-emerald-200 inline-flex items-center gap-1"
              >
                Obtenir une clé <ExternalLink size={12} />
              </a>
            </div>
            <div className="flex gap-2">
              <input
                type={showTtsKey ? 'text' : 'password'}
                className="input font-mono"
                placeholder={providerId === 'cartesia' ? 'sk_car_...' :
                             providerId === 'elevenlabs' ? 'xi-api-key (sk_...)' :
                             'sk-...'}
                value={currentApiKey}
                onChange={(e) => setApiKey(e.target.value)}
              />
              <button className="btn btn-ghost" onClick={() => setShowTtsKey(!showTtsKey)}>
                {showTtsKey ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
            <p className="text-[11px] text-white/40 mt-2">
              Stockée localement, une clé par fournisseur. Basculer de moteur
              conserve les clés déjà saisies.
            </p>
          </div>

          <SpeedSlider
            value={settings.ttsSpeed ?? 1.0}
            onChange={(next) => save({ ttsSpeed: next })}
            provider={providerId}
          />

          {/* Audio output routing — virtual mic for Discord / Zoom / Meet */}
          <div className="pt-2 border-t border-white/5">
            <div className="flex items-center gap-2 mb-2">
              <Speaker size={14} className="text-emerald-300" />
              <div className="label m-0">Sortie audio de la voix traduite</div>
            </div>
            <AudioDevicePicker
              kind="audiooutput"
              value={settings.ttsSinkId || ''}
              onChange={(id: string) => save({ ttsSinkId: id })}
              hint="Pour renvoyer la voix traduite vers Discord/Zoom/Meet comme un micro virtuel, sélectionnez votre périphérique VB-Cable, VoiceMeeter ou OBS Virtual Audio. Laissez sur défaut pour écouter dans vos haut-parleurs."
            />
          </div>

          {/* Continuous / simultaneous interpretation */}
          <div className="pt-2 border-t border-white/5">
            <ToggleRow
              label="Mode interprète simultané (beta)"
              desc="Découpe l'audio par phrases (VAD) : la voix traduite commence à parler pendant que vous êtes encore en train de dicter. Augmente légèrement la consommation d'API."
              icon={<Zap size={14} />}
              value={!!settings.interpreterContinuous}
              onChange={(v) => save({ interpreterContinuous: v })}
            />
          </div>
        </div>
      )}

      {/* ───── Listener (inbound conversation) ───── */}
      <div className="pt-4 border-t border-white/10 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Headphones size={16} className="text-sky-300" />
            <h3 className="font-semibold text-base">Écouter une conversation</h3>
            <span className="badge" style={{ borderColor: 'rgba(125,211,252,0.4)', color: '#7dd3fc' }}>
              Beta
            </span>
          </div>
          <Switch
            value={!!settings.listenerEnabled}
            onChange={(v) => save({ listenerEnabled: v })}
          />
        </div>
        <p className="text-white/50 text-sm">
          Transcrit en temps réel ce que dit une autre personne. Choisissez comme source
          un micro secondaire, ou un périphérique de boucle (VB-Cable Output, Stereo Mix)
          pour capturer la voix de votre interlocuteur dans un appel Discord/Zoom.
        </p>

        {settings.listenerEnabled && (
          <div className="space-y-4 slide-up">
            <div>
              <div className="flex items-center gap-2 mb-2">
                <Mic size={13} className="text-sky-300" />
                <div className="label m-0">Source audio à écouter</div>
              </div>
              <AudioDevicePicker
                kind="audioinput"
                value={settings.listenerInputDeviceId || ''}
                onChange={(id: string) => save({ listenerInputDeviceId: id })}
                hint="Installez VB-Cable (gratuit) et réglez Discord/Zoom pour sortir sur « CABLE Input », puis choisissez ici « CABLE Output » — la voix de votre interlocuteur sera transcrite en direct."
              />
            </div>

            <div>
              <div className="label mb-2">Traduire vers</div>
              <select
                className="select"
                value={settings.listenerTargetLang || 'fr'}
                onChange={(e) => save({ listenerTargetLang: e.target.value })}
              >
                {INTERPRETER_LANGUAGES.map((t) => (
                  <option key={t.code} value={t.code}>→ {t.label}</option>
                ))}
              </select>
              <p className="text-[11px] text-white/40 mt-2">
                Si la langue détectée est déjà celle-ci, la traduction est désactivée
                automatiquement pour économiser Groq.
              </p>
            </div>

            <div>
              <div className="label mb-2">Mode de restitution</div>
              <div className="grid grid-cols-2 gap-2">
                {(['text', 'audio'] as const).map((m) => {
                  const active = (settings.listenerMode || 'text') === m;
                  return (
                    <button
                      key={m}
                      type="button"
                      onClick={() => save({ listenerMode: m })}
                      className="glass rounded-xl p-3 text-left transition"
                      style={{
                        borderColor: active ? 'rgba(125,211,252,0.5)' : 'rgba(255,255,255,0.08)',
                        background: active ? 'rgba(125,211,252,0.08)' : 'transparent',
                      }}
                    >
                      <div className="flex items-center gap-2">
                        {m === 'text' ? <Book size={12} className={active ? 'text-sky-300' : 'text-white/40'} /> :
                                        <Volume2 size={12} className={active ? 'text-sky-300' : 'text-white/40'} />}
                        <span className="font-medium text-sm">
                          {m === 'text' ? 'Texte uniquement' : 'Texte + audio (TTS)'}
                        </span>
                        {active && <Check size={12} className="text-sky-300 ml-auto" />}
                      </div>
                      <p className="text-[11px] text-white/50 mt-1">
                        {m === 'text'
                          ? 'Affiche seulement la transcription + traduction. Le plus rapide et économique.'
                          : 'Synthétise aussi la traduction via le moteur TTS choisi ci-dessus.'}
                      </p>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

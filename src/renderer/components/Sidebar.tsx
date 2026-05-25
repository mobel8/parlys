import { Mic, History, Settings, Sparkles, Languages, Brain } from 'lucide-react';
import { useStore, View } from '../stores/useStore';
import { TRANSLATE_TARGETS } from '../lib/constants';
import { useT } from '../lib/i18n';

const NAV: { id: View; key: string; Icon: any }[] = [
  { id: 'main',     key: 'nav.dictation', Icon: Mic },
  { id: 'history',  key: 'nav.history',   Icon: History },
  { id: 'settings', key: 'nav.settings',  Icon: Settings },
];

export function Sidebar() {
  const { view, setView, settings } = useStore();
  const t = useT();
  const hasKey = !!settings.groqApiKey;
  const translateLabel = TRANSLATE_TARGETS.find((x) => x.code === settings.translateTo)?.native;
  // LLM engine (post-processing + translation). STT above is always Groq
  // Whisper — Cerebras has no transcription API — but the *brain* can be
  // Cerebras / OpenAI / Anthropic / Ollama. Surface it so the user can see
  // which provider is actually doing the polishing.
  const PROVIDER_LABELS: Record<string, string> = { groq: 'Groq', cerebras: 'Cerebras', openai: 'OpenAI', anthropic: 'Anthropic', ollama: 'Ollama' };
  const llmProvider = settings.llmProvider || 'groq';
  const llmLabel = PROVIDER_LABELS[llmProvider] || llmProvider;
  const llmHasKey = llmProvider === 'ollama' ? true
    : llmProvider === 'groq' ? !!(settings.groqApiKey || settings.llmApiKey)
    : !!settings.llmApiKey;

  return (
    <aside className="sidebar-root w-52 shrink-0 flex flex-col border-r border-white/5 bg-black/20 p-3 gap-1">
      <div className="px-2 py-2 sidebar-label">
        <div className="text-[10px] uppercase tracking-widest text-white/40 font-semibold">Navigation</div>
      </div>
      {NAV.map(({ id, key, Icon }) => (
        <button
          key={id}
          className={`nav-item ${view === id ? 'active' : ''}`}
          onClick={() => setView(id)}
        >
          <Icon size={15} />
          <span className="sidebar-label">{t(key)}</span>
        </button>
      ))}

      <div className="mt-auto space-y-2 sidebar-label">
        {translateLabel && (
          <div className="glass rounded-xl px-3 py-2 text-xs flex items-center gap-2">
            <Languages size={12} className="text-fuchsia-300 shrink-0" />
            <div className="min-w-0">
              <div className="text-white/50 text-[10px] uppercase tracking-wide">Traduction</div>
              <div className="text-white/90 truncate">→ {translateLabel}</div>
            </div>
          </div>
        )}
        <div className="glass rounded-xl p-3 text-xs">
          <div className="flex items-center gap-2 mb-1.5">
            <Sparkles size={12} className="text-fuchsia-400" />
            <span className="font-semibold">Moteur STT</span>
          </div>
          <div className="text-white/60 text-[11px]">Groq Whisper Turbo</div>
          <div className={`badge mt-1.5 !text-[10px] ${hasKey ? 'badge-green' : 'badge-amber'}`}>
            {hasKey ? '● Connecté' : '● Clé manquante'}
          </div>
        </div>
        <div className="glass rounded-xl p-3 text-xs">
          <div className="flex items-center gap-2 mb-1.5">
            <Brain size={12} className="text-violet-400" />
            <span className="font-semibold">Moteur LLM</span>
          </div>
          <div className="text-white/60 text-[11px] truncate" title={settings.llmModel}>{llmLabel} · {settings.llmModel}</div>
          <div className={`badge mt-1.5 !text-[10px] ${llmHasKey ? 'badge-green' : 'badge-amber'}`}>
            {llmHasKey ? '● Connecté' : '● Clé manquante'}
          </div>
        </div>
      </div>
    </aside>
  );
}

import { useState } from 'react';
import { Book, Plus, Trash2, Download, Upload, Sparkles } from 'lucide-react';
import { useStore } from '../stores/useStore';
import { Replacement } from '../../shared/types';

/**
 * Settings subsection: custom dictionary / replacements.
 *
 * Users add { from, to } rules that are applied after Whisper and before
 * translation + LLM. Common use: spoken punctuation ("virgule" → ","),
 * domain vocabulary ("Groc" → "Groq"), verbal shortcuts ("nouvelle ligne").
 *
 * Supports French & English presets (one-click import), plus JSON import/export.
 */
export function ReplacementsSection() {
  const { settings, updateSettings } = useStore();
  const list: Replacement[] = settings.replacements || [];
  const [newFrom, setNewFrom] = useState('');
  const [newTo, setNewTo] = useState('');

  const update = async (next: Replacement[]) => {
    await updateSettings({ replacements: next });
  };

  const add = async () => {
    const from = newFrom.trim();
    const to = newTo.trim();
    if (!from || !to) return;
    const entry: Replacement = {
      id: cryptoRandomId(),
      from,
      to,
      caseSensitive: false,
      wholeWord: true,
      enabled: true,
    };
    await update([entry, ...list]);
    setNewFrom('');
    setNewTo('');
  };

  const patch = async (id: string, p: Partial<Replacement>) => {
    await update(list.map((r) => (r.id === id ? { ...r, ...p } : r)));
  };
  const remove = async (id: string) => {
    await update(list.filter((r) => r.id !== id));
  };

  const importPreset = async (preset: 'fr' | 'en') => {
    // Load presets lazily to avoid pulling main-process code into the renderer
    // bundle. These are just static arrays.
    const FR = FRENCH_PRESETS;
    const EN = ENGLISH_PRESETS;
    const source = preset === 'fr' ? FR : EN;
    const existingFrom = new Set(list.map((r) => r.from.toLowerCase()));
    const toAdd: Replacement[] = source
      .filter((r) => !existingFrom.has(r.from.toLowerCase()))
      .map((r) => ({ ...r, id: cryptoRandomId() }));
    await update([...toAdd, ...list]);
  };

  const exportJson = () => {
    const blob = new Blob([JSON.stringify(list, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `voiceink-dictionary-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(url);
      a.remove();
    }, 100);
  };

  const importJson = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json,.json';
    input.onchange = async () => {
      const f = input.files?.[0];
      if (!f) return;
      try {
        const text = await f.text();
        const parsed = JSON.parse(text);
        if (!Array.isArray(parsed)) throw new Error('Format invalide');
        const normalised: Replacement[] = parsed
          .filter((r) => r && typeof r.from === 'string' && typeof r.to === 'string')
          .map((r: any) => ({
            id: cryptoRandomId(),
            from: r.from,
            to: r.to,
            caseSensitive: !!r.caseSensitive,
            wholeWord: r.wholeWord !== false,
            enabled: r.enabled !== false,
          }));
        await update([...normalised, ...list]);
      } catch (err: any) {
        alert('Import échoué : ' + (err?.message || err));
      }
    };
    input.click();
  };

  return (
    <section className="glass rounded-2xl p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Book size={16} className="accent-text" />
          <h2 className="font-semibold text-lg">Dictionnaire personnalisé</h2>
        </div>
        <div className={`switch ${settings.replacementsEnabled !== false ? 'on' : ''}`}
          onClick={() => updateSettings({ replacementsEnabled: !(settings.replacementsEnabled !== false) })}
        />
      </div>
      <p className="text-white/50 text-sm">
        Remplacez des mots dictés par du texte formaté. Appliqué après la reconnaissance,
        avant la traduction et le post-traitement LLM. Utile pour la ponctuation
        parlée (« virgule » → <code>,</code>), les noms propres, les acronymes.
      </p>

      {/* Add form */}
      <div className="glass rounded-xl p-3 flex flex-col md:flex-row gap-2 items-stretch md:items-center">
        <input
          className="input flex-1 !py-2 !text-sm"
          placeholder="Dicté (ex: virgule, arobase, Groc)"
          value={newFrom}
          onChange={(e) => setNewFrom(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') add(); }}
        />
        <div className="text-white/40 text-sm hidden md:block">→</div>
        <input
          className="input flex-1 !py-2 !text-sm font-mono"
          placeholder="Remplacé par (ex: , @ Groq \n = nouvelle ligne)"
          value={newTo}
          onChange={(e) => setNewTo(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') add(); }}
        />
        <button className="btn btn-primary !py-2 shrink-0" onClick={add} disabled={!newFrom.trim() || !newTo.trim()}>
          <Plus size={14} /> Ajouter
        </button>
      </div>

      {/* Presets & IO */}
      <div className="flex flex-wrap items-center gap-2">
        <button className="btn btn-ghost !text-xs" onClick={() => importPreset('fr')}>
          <Sparkles size={12} /> Ajouter les règles FR
        </button>
        <button className="btn btn-ghost !text-xs" onClick={() => importPreset('en')}>
          <Sparkles size={12} /> Ajouter les règles EN
        </button>
        <div className="flex-1" />
        <button className="btn btn-ghost !text-xs" onClick={importJson}>
          <Upload size={12} /> Importer JSON
        </button>
        <button className="btn btn-ghost !text-xs" onClick={exportJson} disabled={list.length === 0}>
          <Download size={12} /> Exporter JSON
        </button>
      </div>

      {/* Rules list */}
      {list.length === 0 ? (
        <div className="text-center text-white/35 py-8 text-sm">
          Aucune règle pour le moment. Ajoutez-en ci-dessus ou importez un preset.
        </div>
      ) : (
        <div className="space-y-1.5 max-h-[420px] overflow-y-auto pr-1">
          {list.map((r) => (
            <div key={r.id} className={`card !p-2.5 flex items-center gap-2 ${r.enabled ? '' : 'opacity-50'}`}>
              <div
                className={`switch !w-9 !h-5 shrink-0 ${r.enabled ? 'on' : ''}`}
                onClick={() => patch(r.id, { enabled: !r.enabled })}
              />
              <input
                className="input !py-1 !text-sm flex-1 !bg-transparent !border-white/10"
                value={r.from}
                onChange={(e) => patch(r.id, { from: e.target.value })}
              />
              <div className="text-white/40 text-xs shrink-0">→</div>
              <input
                className="input !py-1 !text-sm flex-1 font-mono !bg-transparent !border-white/10"
                value={r.to}
                onChange={(e) => patch(r.id, { to: e.target.value })}
              />
              <div className="flex items-center gap-1 shrink-0" title="Options">
                <label className="text-[10px] text-white/50 flex items-center gap-1 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={r.wholeWord}
                    onChange={(e) => patch(r.id, { wholeWord: e.target.checked })}
                  />
                  Mot
                </label>
                <label className="text-[10px] text-white/50 flex items-center gap-1 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={r.caseSensitive}
                    onChange={(e) => patch(r.id, { caseSensitive: e.target.checked })}
                  />
                  Aa
                </label>
              </div>
              <button className="btn btn-ghost !p-1.5 shrink-0 hover:!text-rose-300" onClick={() => remove(r.id)} title="Supprimer">
                <Trash2 size={13} />
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function cryptoRandomId(): string {
  try {
    return (crypto as any).randomUUID();
  } catch {
    return 'r' + Math.random().toString(36).slice(2) + Date.now().toString(36);
  }
}

/* French + English presets duplicated here so the renderer stays independent
   of main-process modules. Kept in sync with src/main/services/replacements.ts. */
const FRENCH_PRESETS: Omit<Replacement, 'id'>[] = [
  { from: 'virgule', to: ',', caseSensitive: false, wholeWord: true, enabled: true },
  { from: 'point virgule', to: ';', caseSensitive: false, wholeWord: true, enabled: true },
  { from: 'deux points', to: ' :', caseSensitive: false, wholeWord: true, enabled: true },
  { from: 'point final', to: '.', caseSensitive: false, wholeWord: true, enabled: true },
  { from: 'point d interrogation', to: ' ?', caseSensitive: false, wholeWord: true, enabled: true },
  { from: 'point d exclamation', to: ' !', caseSensitive: false, wholeWord: true, enabled: true },
  { from: 'nouvelle ligne', to: '\\n', caseSensitive: false, wholeWord: true, enabled: true },
  { from: 'nouveau paragraphe', to: '\\n\\n', caseSensitive: false, wholeWord: true, enabled: true },
  { from: 'guillemets ouvrants', to: ' « ', caseSensitive: false, wholeWord: true, enabled: true },
  { from: 'guillemets fermants', to: ' » ', caseSensitive: false, wholeWord: true, enabled: true },
  { from: 'arobase', to: '@', caseSensitive: false, wholeWord: true, enabled: true },
  { from: 'dièse', to: '#', caseSensitive: false, wholeWord: true, enabled: true },
  { from: 'tiret', to: '-', caseSensitive: false, wholeWord: true, enabled: true },
];

const ENGLISH_PRESETS: Omit<Replacement, 'id'>[] = [
  { from: 'comma', to: ',', caseSensitive: false, wholeWord: true, enabled: true },
  { from: 'period', to: '.', caseSensitive: false, wholeWord: true, enabled: true },
  { from: 'full stop', to: '.', caseSensitive: false, wholeWord: true, enabled: true },
  { from: 'question mark', to: '?', caseSensitive: false, wholeWord: true, enabled: true },
  { from: 'exclamation mark', to: '!', caseSensitive: false, wholeWord: true, enabled: true },
  { from: 'new line', to: '\\n', caseSensitive: false, wholeWord: true, enabled: true },
  { from: 'new paragraph', to: '\\n\\n', caseSensitive: false, wholeWord: true, enabled: true },
  { from: 'at sign', to: '@', caseSensitive: false, wholeWord: true, enabled: true },
  { from: 'hashtag', to: '#', caseSensitive: false, wholeWord: true, enabled: true },
  { from: 'dash', to: '-', caseSensitive: false, wholeWord: true, enabled: true },
];

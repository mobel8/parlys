import { useMemo, useState } from 'react';
import { Search, Trash2, Copy, Check, Clock, Zap, Pin, PinOff, Download, Sparkles, Filter } from 'lucide-react';
import { useStore } from '../stores/useStore';
import { MODE_LABELS } from '../lib/constants';
import { HistoryEntry, Mode } from '../../shared/types';

type DateFilter = 'all' | 'today' | '7d' | '30d' | 'pinned';

export function HistoryView() {
  const { history, removeHistory, clearHistory, loadHistory } = useStore();
  const [q, setQ] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [modeFilter, setModeFilter] = useState<Mode | 'all'>('all');
  const [langFilter, setLangFilter] = useState<string>('all');
  const [dateFilter, setDateFilter] = useState<DateFilter>('all');
  const [exporting, setExporting] = useState(false);

  // Distinct languages actually present in history, for the picker.
  const languages = useMemo(() => {
    const set = new Set<string>();
    for (const h of history) if (h.language) set.add(h.language);
    return Array.from(set).sort();
  }, [history]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    const now = Date.now();
    const dayMs = 24 * 60 * 60 * 1000;
    return history.filter((h: HistoryEntry) => {
      if (s) {
        const hay = (h.finalText + ' ' + h.rawText).toLowerCase();
        if (!hay.includes(s)) return false;
      }
      if (modeFilter !== 'all' && h.mode !== modeFilter) return false;
      if (langFilter !== 'all' && h.language !== langFilter) return false;
      if (dateFilter === 'today') {
        if (new Date(h.createdAt).toDateString() !== new Date().toDateString()) return false;
      } else if (dateFilter === '7d') {
        if (now - h.createdAt > 7 * dayMs) return false;
      } else if (dateFilter === '30d') {
        if (now - h.createdAt > 30 * dayMs) return false;
      } else if (dateFilter === 'pinned') {
        if (!h.pinned) return false;
      }
      return true;
    });
  }, [history, q, modeFilter, langFilter, dateFilter]);

  const copy = async (id: string, text: string) => {
    await window.voiceink.copyText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1200);
  };

  const togglePin = async (id: string) => {
    await window.voiceink.togglePinHistory?.(id);
    await loadHistory();
  };

  const doExport = async (format: 'json' | 'markdown' | 'txt' | 'csv') => {
    setExporting(true);
    try {
      const res = await window.voiceink.exportHistory?.(format);
      if (res?.ok && res.path) {
        // Brief confirmation — keep it subtle, no modal.
        console.log('[history] exported to', res.path);
      } else if (res?.error) {
        alert('Export échoué : ' + res.error);
      }
    } finally {
      setExporting(false);
    }
  };

  const clearFilters = () => {
    setQ('');
    setModeFilter('all');
    setLangFilter('all');
    setDateFilter('all');
  };

  const hasFilters = !!q || modeFilter !== 'all' || langFilter !== 'all' || dateFilter !== 'all';

  return (
    <div className="px-8 py-8 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight"><span className="gradient-text">Historique</span></h1>
          <p className="text-white/50 text-sm mt-1">
            {history.length} transcription{history.length > 1 ? 's' : ''} enregistrée{history.length > 1 ? 's' : ''}.
            {hasFilters && ` · ${filtered.length} affichée${filtered.length > 1 ? 's' : ''}`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <ExportMenu onExport={doExport} disabled={exporting || history.length === 0} />
          {history.length > 0 && (
            <button className="btn btn-danger !text-xs" onClick={() => confirm('Tout effacer ? Les transcriptions épinglées sont conservées.') && clearHistory()}>
              <Trash2 size={14} /> Tout effacer
            </button>
          )}
        </div>
      </div>

      {/* Filter bar */}
      <div className="glass rounded-xl p-3 mb-4 space-y-2">
        <div className="flex items-center gap-2">
          <Search size={16} className="text-white/40 shrink-0" />
          <input
            className="flex-1 bg-transparent outline-none text-sm placeholder:text-white/30"
            placeholder="Rechercher dans les transcriptions…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          {hasFilters && (
            <button className="btn btn-ghost !text-xs !py-1" onClick={clearFilters} title="Effacer les filtres">
              Réinitialiser
            </button>
          )}
        </div>
        <div className="flex items-center gap-1.5 flex-wrap text-xs">
          <Filter size={11} className="text-white/40" />
          <FilterChip label="Tous" active={dateFilter === 'all'} onClick={() => setDateFilter('all')} />
          <FilterChip label="Aujourd'hui" active={dateFilter === 'today'} onClick={() => setDateFilter('today')} />
          <FilterChip label="7 jours" active={dateFilter === '7d'} onClick={() => setDateFilter('7d')} />
          <FilterChip label="30 jours" active={dateFilter === '30d'} onClick={() => setDateFilter('30d')} />
          <FilterChip label="★ Épinglés" active={dateFilter === 'pinned'} onClick={() => setDateFilter('pinned')} />

          <span className="w-px h-3 bg-white/10 mx-1" />

          <select
            className="bg-black/25 border border-white/10 rounded-md px-2 py-0.5 text-[11px] outline-none"
            value={modeFilter}
            onChange={(e) => setModeFilter(e.target.value as Mode | 'all')}
          >
            <option value="all">Tous les modes</option>
            {Object.entries(MODE_LABELS).map(([k, v]) => (
              <option key={k} value={k}>{v.icon} {v.label}</option>
            ))}
          </select>

          {languages.length > 0 && (
            <select
              className="bg-black/25 border border-white/10 rounded-md px-2 py-0.5 text-[11px] outline-none"
              value={langFilter}
              onChange={(e) => setLangFilter(e.target.value)}
            >
              <option value="all">Toutes langues</option>
              {languages.map((l) => (
                <option key={l} value={l}>{l.toUpperCase()}</option>
              ))}
            </select>
          )}
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="glass rounded-2xl p-12 text-center text-white/40">
          {history.length === 0 ? 'Aucune transcription pour le moment.' : 'Aucun résultat pour ces filtres.'}
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((h: HistoryEntry) => (
            <div key={h.id} className={`card slide-up ${h.pinned ? 'ring-1 ring-[rgba(var(--accent-1-rgb),0.28)]' : ''}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 text-[11px] text-white/50 mb-1 flex-wrap">
                    <Clock size={11} /> {formatDate(h.createdAt)}
                    <span className="badge">{MODE_LABELS[h.mode as Mode]?.icon} {MODE_LABELS[h.mode as Mode]?.label || h.mode}</span>
                    {h.language && h.language !== 'auto' && <span className="badge">{h.language.toUpperCase()}</span>}
                    {h.translatedTo && <span className="badge">→ {h.translatedTo.toUpperCase()}</span>}
                    <span className="badge badge-green"><Zap size={9} /> {h.durationMs}ms</span>
                    {h.pinned && <span className="badge badge-amber"><Sparkles size={9} /> Épinglé</span>}
                    {typeof h.wordCount === 'number' && h.wordCount > 0 && (
                      <span className="text-white/40">{h.wordCount} mot{h.wordCount > 1 ? 's' : ''}</span>
                    )}
                  </div>
                  <div className="text-white/90 text-[15px] leading-relaxed whitespace-pre-wrap select-text" style={{ userSelect: 'text' }}>
                    {h.finalText || <em className="text-white/30">(vide)</em>}
                  </div>
                  {h.rawText && h.rawText !== h.finalText && (
                    <details className="mt-2 text-white/40 text-xs">
                      <summary className="cursor-pointer hover:text-white/70">Voir version brute</summary>
                      <div className="mt-1 pl-3 border-l border-white/10 whitespace-pre-wrap">{h.rawText}</div>
                    </details>
                  )}
                </div>
                <div className="flex flex-col gap-1">
                  <button className="btn btn-ghost !p-2" onClick={() => togglePin(h.id)} title={h.pinned ? 'Désépingler' : 'Épingler'}>
                    {h.pinned ? <Pin size={14} className="accent-text" /> : <PinOff size={14} />}
                  </button>
                  <button className="btn btn-ghost !p-2" onClick={() => copy(h.id, h.finalText)} title="Copier">
                    {copiedId === h.id ? <Check size={14} className="text-emerald-400" /> : <Copy size={14} />}
                  </button>
                  <button className="btn btn-ghost !p-2 hover:!text-rose-300" onClick={() => removeHistory(h.id)} title="Supprimer">
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function FilterChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`px-2 py-0.5 rounded-md text-[11px] font-medium transition-colors ${
        active ? 'bg-[rgba(var(--accent-1-rgb),0.25)] text-white border border-[rgba(var(--accent-1-rgb),0.35)]' : 'bg-transparent text-white/60 border border-white/10 hover:bg-white/5'
      }`}
    >
      {label}
    </button>
  );
}

function ExportMenu({ onExport, disabled }: { onExport: (f: 'json' | 'markdown' | 'txt' | 'csv') => void; disabled: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button className="btn btn-ghost !text-xs" onClick={() => setOpen((v) => !v)} disabled={disabled}>
        <Download size={14} /> Exporter
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 mt-1 w-44 glass-strong rounded-lg p-1 z-50 shadow-xl">
            {[
              { k: 'markdown' as const, label: 'Markdown (.md)' },
              { k: 'json' as const, label: 'JSON (.json)' },
              { k: 'txt' as const, label: 'Texte (.txt)' },
              { k: 'csv' as const, label: 'CSV (.csv)' },
            ].map((o) => (
              <button
                key={o.k}
                className="w-full text-left px-3 py-1.5 text-xs rounded hover:bg-white/10"
                onClick={() => { setOpen(false); onExport(o.k); }}
              >
                {o.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function formatDate(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const same = d.toDateString() === now.toDateString();
  const time = d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  if (same) return `Aujourd'hui, ${time}`;
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' }) + ', ' + time;
}

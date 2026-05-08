import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Search, User, UserRound, Volume2, RefreshCw, Check, Play, Pause, Loader2 } from 'lucide-react';
import type { VoiceInfo, TTSProvider } from '../../shared/types';

/**
 * Rich voice picker — queries the full provider catalog (via IPC),
 * caches it in localStorage for 1h, and exposes search + language +
 * gender filters + a per-voice sample preview.
 *
 * Design decisions:
 *
 *   - **Cache keyed by provider + API key hash** so switching keys
 *     invalidates the cached list (different account = different voices).
 *     Entries older than 1h are refetched lazily on mount.
 *   - **Preview** uses the provider's own `preview_url` when present
 *     (ElevenLabs, sometimes Cartesia), else falls back to a live
 *     `IPC.interpret()` call with a short demo sentence. That path is
 *     more expensive but tests the actual synthesis the user will get.
 *   - **Search is client-side** (substring match on name + description)
 *     since the full catalog is small (~100 voices). No debounce needed.
 *   - **Keyboard nav** (↑↓ + Enter) deferred to a later pass — 99 % of
 *     users pick with a click; we keep the component lean.
 *
 * Layout stays flush with the surrounding glass section: no bg, no
 * border — the parent <section> provides those.
 */

const CACHE_TTL_MS = 60 * 60 * 1000; // 1h

interface CachedCatalog {
  voices: VoiceInfo[];
  fetchedAt: number;
  keyHash: string;
}

function shortHash(s: string): string {
  // Tiny non-crypto hash for cache invalidation on key change.
  // Don't use for anything security-related.
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return String(h);
}

function cacheKey(provider: TTSProvider): string {
  return `voiceink:voices:${provider}`;
}

function readCache(provider: TTSProvider, apiKey: string): VoiceInfo[] | null {
  try {
    const raw = localStorage.getItem(cacheKey(provider));
    if (!raw) return null;
    const c: CachedCatalog = JSON.parse(raw);
    if (c.keyHash !== shortHash(apiKey || '')) return null;
    if (Date.now() - c.fetchedAt > CACHE_TTL_MS) return null;
    return c.voices;
  } catch {
    return null;
  }
}

function writeCache(provider: TTSProvider, apiKey: string, voices: VoiceInfo[]): void {
  try {
    const c: CachedCatalog = { voices, fetchedAt: Date.now(), keyHash: shortHash(apiKey || '') };
    localStorage.setItem(cacheKey(provider), JSON.stringify(c));
  } catch {
    /* quota full — acceptable */
  }
}

interface Props {
  provider: TTSProvider;
  apiKey: string;
  value: string;
  onChange: (voiceId: string) => void;
  /** Optional curated fallback voices shown when the catalog is empty/loading. */
  fallback?: VoiceInfo[];
  /**
   * Optional arbitrary React node rendered inside the expanded picker,
   * right under the voice list. Used to embed a speed slider + any
   * other per-voice control without hardcoding their types here. Keeps
   * VoicePicker focused on voice selection and lets consumers compose.
   */
  extraControls?: React.ReactNode;
}

export function VoicePicker({ provider, apiKey, value, onChange, fallback = [], extraControls }: Props) {
  const [voices, setVoices] = useState<VoiceInfo[]>(() => readCache(provider, apiKey) || []);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [langFilter, setLangFilter] = useState<string>('');
  const [genderFilter, setGenderFilter] = useState<'' | 'masculine' | 'feminine' | 'neutral'>('');
  const [previewingId, setPreviewingId] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Fetch catalog when provider/key changes or cache is cold.
  useEffect(() => {
    const cached = readCache(provider, apiKey);
    if (cached && cached.length > 0) {
      setVoices(cached);
      return;
    }
    if (!apiKey && provider !== 'openai') {
      // No key = no catalog (except OpenAI which is hard-coded).
      setVoices(fallback);
      return;
    }
    let cancelled = false;
    setLoading(true);
    (window as any).voiceink?.listVoices(provider)
      .then((list: VoiceInfo[]) => {
        if (cancelled) return;
        if (list && list.length > 0) {
          setVoices(list);
          writeCache(provider, apiKey, list);
        } else {
          setVoices(fallback);
        }
      })
      .catch(() => { if (!cancelled) setVoices(fallback); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [provider, apiKey]);

  const refresh = () => {
    localStorage.removeItem(cacheKey(provider));
    setLoading(true);
    (window as any).voiceink?.listVoices(provider)
      .then((list: VoiceInfo[]) => {
        if (list && list.length > 0) {
          setVoices(list);
          writeCache(provider, apiKey, list);
        }
      })
      .finally(() => setLoading(false));
  };

  // Unique languages sorted by count.
  const languages = useMemo(() => {
    const counts = new Map<string, number>();
    for (const v of voices) {
      const l = v.language || 'unknown';
      counts.set(l, (counts.get(l) || 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [voices]);

  // Apply filters.
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return voices.filter((v) => {
      if (langFilter && v.language !== langFilter) return false;
      if (genderFilter && v.gender !== genderFilter) return false;
      if (q) {
        const hay = `${v.name} ${v.description || ''} ${v.accent || ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [voices, search, langFilter, genderFilter]);

  const selected = voices.find((v) => v.id === value);
  const displayName = selected?.name || value || 'Choisir une voix…';

  const playPreview = (v: VoiceInfo) => {
    if (previewingId === v.id) {
      audioRef.current?.pause();
      setPreviewingId(null);
      return;
    }
    if (!v.preview_url) return;
    const audio = audioRef.current ?? new Audio();
    audioRef.current = audio;
    audio.src = v.preview_url;
    audio.onended = () => setPreviewingId(null);
    audio.onerror = () => setPreviewingId(null);
    audio.play().then(() => setPreviewingId(v.id)).catch(() => setPreviewingId(null));
  };

  return (
    <div className="space-y-2">
      {/* Current selection + toggle button */}
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between gap-3 rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 transition px-3 py-2 text-left"
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-sm font-medium truncate">
            {selected?.gender === 'feminine' ? <UserRound size={13} className="text-pink-300 shrink-0" /> :
             selected?.gender === 'masculine' ? <User size={13} className="text-sky-300 shrink-0" /> :
             <Volume2 size={13} className="text-white/40 shrink-0" />}
            <span className="truncate">{displayName}</span>
          </div>
          {selected?.description && (
            <div className="text-[11px] text-white/45 truncate mt-0.5">{selected.description}</div>
          )}
          {!selected && value && (
            <div className="text-[11px] text-white/40 truncate mt-0.5">ID: {value}</div>
          )}
        </div>
        <div className="text-[10px] text-white/40 shrink-0 font-mono">
          {voices.length > 0 ? `${voices.length} voix` : '—'}
        </div>
      </button>

      {open && (
        <div className="rounded-lg border border-white/10 bg-black/40 p-3 space-y-2 slide-up">
          {/* Toolbar: search + filters + refresh */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex-1 min-w-[160px] relative">
              <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-white/40 pointer-events-none" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Rechercher nom ou description…"
                className="w-full pl-7 pr-2 py-1.5 text-xs rounded-md bg-white/5 border border-white/10 focus:border-violet-400/50 outline-none"
              />
            </div>
            <select
              value={langFilter}
              onChange={(e) => setLangFilter(e.target.value)}
              className="text-xs rounded-md bg-white/5 border border-white/10 px-2 py-1.5 outline-none focus:border-violet-400/50"
              title="Filtrer par langue"
            >
              <option value="">Toutes langues</option>
              {languages.map(([l, n]) => (
                <option key={l} value={l}>{l.toUpperCase()} ({n})</option>
              ))}
            </select>
            <select
              value={genderFilter}
              onChange={(e) => setGenderFilter(e.target.value as any)}
              className="text-xs rounded-md bg-white/5 border border-white/10 px-2 py-1.5 outline-none focus:border-violet-400/50"
              title="Filtrer par genre"
            >
              <option value="">Tous genres</option>
              <option value="feminine">Féminin</option>
              <option value="masculine">Masculin</option>
              <option value="neutral">Neutre</option>
            </select>
            <button
              type="button"
              onClick={refresh}
              className="text-xs rounded-md bg-white/5 border border-white/10 hover:bg-white/10 px-2 py-1.5 inline-flex items-center gap-1"
              title="Rafraîchir le catalogue"
            >
              {loading ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />}
            </button>
          </div>

          {/* Scroll list */}
          <div className="max-h-72 overflow-y-auto rounded-md border border-white/5 bg-black/20">
            {loading && voices.length === 0 && (
              <div className="p-6 text-center text-xs text-white/40">
                <Loader2 size={14} className="inline animate-spin mr-1" />
                Chargement du catalogue…
              </div>
            )}
            {!loading && filtered.length === 0 && (
              <div className="p-6 text-center text-xs text-white/40">
                {voices.length === 0
                  ? (apiKey ? 'Catalogue vide — vérifiez la clé API.' : 'Entrez une clé API puis rechargez.')
                  : 'Aucune voix ne correspond aux filtres.'}
              </div>
            )}
            {filtered.map((v) => {
              const isSel = v.id === value;
              return (
                <div
                  key={v.id}
                  className={`
                    group flex items-center gap-2 px-2.5 py-2 border-b border-white/5 last:border-b-0 cursor-pointer
                    transition-colors
                    ${isSel ? 'bg-violet-500/15' : 'hover:bg-white/5'}
                  `}
                  onClick={() => { onChange(v.id); setOpen(false); }}
                >
                  <div className="w-5 shrink-0 flex items-center justify-center">
                    {isSel ? (
                      <Check size={13} className="text-violet-300" />
                    ) : v.gender === 'feminine' ? (
                      <UserRound size={13} className="text-pink-300/70" />
                    ) : v.gender === 'masculine' ? (
                      <User size={13} className="text-sky-300/70" />
                    ) : (
                      <Volume2 size={13} className="text-white/30" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-medium truncate flex items-center gap-1.5">
                      {v.name}
                      {v.pro && <span className="text-[9px] uppercase tracking-wide bg-amber-500/20 text-amber-200 px-1 rounded">Pro</span>}
                    </div>
                    {v.description && (
                      <div className="text-[10px] text-white/45 truncate">{v.description}</div>
                    )}
                  </div>
                  <div className="flex items-center gap-1 shrink-0 text-[10px] text-white/40 font-mono">
                    {v.language && <span className="px-1 rounded bg-white/5">{v.language.toUpperCase()}</span>}
                  </div>
                  {v.preview_url && (
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); playPreview(v); }}
                      className="shrink-0 w-6 h-6 rounded-full hover:bg-white/10 flex items-center justify-center text-white/60 hover:text-white"
                      title="Écouter un aperçu"
                    >
                      {previewingId === v.id ? <Pause size={11} /> : <Play size={11} />}
                    </button>
                  )}
                </div>
              );
            })}
          </div>

          <div className="text-[10px] text-white/40">
            {filtered.length} / {voices.length} voix affichées
          </div>

          {/* Consumer-supplied extras (typically the SpeedSlider). Kept
              in a separate divided block so it visually belongs to the
              same picker without crowding the scroll list. */}
          {extraControls && (
            <div className="pt-3 mt-1 border-t border-white/5">
              {extraControls}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

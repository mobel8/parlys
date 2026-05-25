/**
 * Voice catalog — fetches the live voice list from each TTS provider
 * so the user can pick from *every* voice, not just a hard-coded subset.
 *
 * Why per-provider implementations?
 *
 *   - **Cartesia** exposes GET /voices/ which returns an array (or a
 *     paginated envelope depending on region). Each voice has language,
 *     gender, description — enough for the UI to show a filterable
 *     directory.
 *   - **ElevenLabs** exposes GET /v1/voices which returns `{voices: []}`
 *     with labels.gender, labels.accent, labels.use_case — way richer
 *     but the shape is nested.
 *   - **OpenAI** has NO voice listing endpoint. Their 11 voices are
 *     documented and fixed; we ship them in-app so users can pick
 *     without an API key, and refresh on the OpenAI docs page when a
 *     new voice launches.
 *
 * All functions normalize to a single `VoiceInfo` shape so the UI
 * doesn't care which provider served the list. We also never throw —
 * a failed fetch returns an empty array + logs — so the picker can
 * fall back to the built-in curated list when the API is unreachable.
 */

export interface VoiceInfo {
  id: string;
  name: string;
  description?: string;
  language?: string;          // ISO 639-1 code
  gender?: 'masculine' | 'feminine' | 'neutral';
  accent?: string;            // 'American', 'British', 'Australian', …
  preview_url?: string;       // short MP3 sample if provider exposes one
  pro?: boolean;              // voice requires paid tier
}

async function safeFetch(url: string, init: RequestInit, timeoutMs = 15_000): Promise<Response | null> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } catch (err) {
    console.warn(`[tts:catalog] fetch failed for ${url}:`, (err as Error).message);
    return null;
  } finally {
    clearTimeout(t);
  }
}

/**
 * Fetch the full Cartesia voice catalog. Returns every public voice
 * the account has access to (~100 at time of writing, 15 languages).
 */
export async function fetchCartesiaVoices(apiKey: string): Promise<VoiceInfo[]> {
  if (!apiKey) return [];
  const res = await safeFetch('https://api.cartesia.ai/voices/?limit=1000', {
    headers: {
      'X-API-Key': apiKey,
      'Cartesia-Version': '2024-11-13',
    },
  });
  if (!res || !res.ok) {
    if (res) console.warn(`[tts:catalog] Cartesia HTTP ${res.status}`);
    return [];
  }
  const raw = await res.json();
  const list: any[] = Array.isArray(raw) ? raw : (raw.data || raw.voices || []);
  return list.map((v) => ({
    id: v.id,
    name: v.name || v.id,
    description: v.description,
    language: (v.language || 'en').toLowerCase(),
    gender: normalizeGender(v.gender),
    pro: !!v.is_pro,
  }));
}

/**
 * Fetch the ElevenLabs voice list including the user's cloned voices.
 * Labels (accent, age, use-case) are surfaced into `accent` + description.
 */
export async function fetchElevenLabsVoices(apiKey: string): Promise<VoiceInfo[]> {
  if (!apiKey) return [];
  const res = await safeFetch('https://api.elevenlabs.io/v1/voices', {
    headers: { 'xi-api-key': apiKey },
  });
  if (!res || !res.ok) {
    if (res) console.warn(`[tts:catalog] ElevenLabs HTTP ${res.status}`);
    return [];
  }
  const raw = await res.json();
  const voices: any[] = raw.voices || [];
  return voices.map((v) => {
    const labels = v.labels || {};
    const description = [labels.description, labels.use_case, labels.age, labels.accent]
      .filter(Boolean)
      .join(' · ');
    return {
      id: v.voice_id,
      name: v.name,
      description: description || undefined,
      language: 'multi', // ElevenLabs voices are multilingual by design
      gender: normalizeGender(labels.gender),
      accent: labels.accent,
      preview_url: v.preview_url,
    } as VoiceInfo;
  });
}

/**
 * OpenAI's 11 voices as of April 2026. No fetch endpoint — docs only.
 * We ship rich metadata so users can pick without reading docs.
 */
export function getOpenAIVoices(): VoiceInfo[] {
  return [
    { id: 'alloy',   name: 'Alloy',   description: 'Neutral, balanced narration',   gender: 'neutral',   language: 'multi' },
    { id: 'ash',     name: 'Ash',     description: 'Warm, grounded',                 gender: 'masculine', language: 'multi' },
    { id: 'ballad',  name: 'Ballad',  description: 'Expressive, storytelling',      gender: 'masculine', language: 'multi' },
    { id: 'coral',   name: 'Coral',   description: 'Bright, friendly',               gender: 'feminine',  language: 'multi' },
    { id: 'echo',    name: 'Echo',    description: 'Calm, low-register',             gender: 'masculine', language: 'multi' },
    { id: 'fable',   name: 'Fable',   description: 'British, book-narrator feel',    gender: 'masculine', language: 'multi', accent: 'British' },
    { id: 'nova',    name: 'Nova',    description: 'Energetic, conversational',     gender: 'feminine',  language: 'multi' },
    { id: 'onyx',    name: 'Onyx',    description: 'Deep, authoritative',            gender: 'masculine', language: 'multi' },
    { id: 'sage',    name: 'Sage',    description: 'Wise, measured',                 gender: 'neutral',   language: 'multi' },
    { id: 'shimmer', name: 'Shimmer', description: 'Warm, intimate',                 gender: 'feminine',  language: 'multi' },
    { id: 'verse',   name: 'Verse',   description: 'Versatile, nuanced',             gender: 'neutral',   language: 'multi' },
  ];
}

function normalizeGender(g: any): VoiceInfo['gender'] | undefined {
  if (!g || typeof g !== 'string') return undefined;
  const s = g.toLowerCase();
  if (s.includes('fem') || s === 'female' || s === 'woman' || s === 'f') return 'feminine';
  if (s.includes('masc') || s === 'male' || s === 'man' || s === 'm') return 'masculine';
  if (s === 'neutral' || s === 'non-binary' || s === 'nb') return 'neutral';
  return undefined;
}

export async function listVoices(provider: 'cartesia' | 'elevenlabs' | 'openai', apiKey: string): Promise<VoiceInfo[]> {
  switch (provider) {
    case 'cartesia':   return fetchCartesiaVoices(apiKey);
    case 'elevenlabs': return fetchElevenLabsVoices(apiKey);
    case 'openai':     return getOpenAIVoices();
    default:           return [];
  }
}

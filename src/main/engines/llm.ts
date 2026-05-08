// Optional LLM post-processing. Uses Groq chat completions by default
// (very low latency) or OpenAI / Anthropic / Ollama if configured.
//
// Designed to be self-contained and *loud*: every branch logs enough
// context that the user can diagnose "why didn't my mode apply?" from
// runtime.log alone — missing API key, HTTP error, empty choice, etc.

import { Mode, MODE_PROMPTS, Settings } from '../../shared/types';

const LANGUAGE_NAMES: Record<string, string> = {
  fr: 'French', en: 'English', es: 'Spanish', de: 'German',
  it: 'Italian', pt: 'Portuguese', nl: 'Dutch', pl: 'Polish',
  ru: 'Russian', ja: 'Japanese', zh: 'Chinese', ko: 'Korean',
  ar: 'Arabic',
};

/**
 * Resolve the human-readable language name the model should respond in.
 *
 * Priority:
 *  1. Whisper's detected language (passed by the caller).
 *  2. The user's explicit language setting, if not 'auto'.
 *  3. Literal fallback "the same language as the input" — the model
 *     infers from the user message.
 */
function resolveLangName(settings: Settings, hint?: string): string {
  const code = (hint || '').toLowerCase();
  if (code && LANGUAGE_NAMES[code]) return LANGUAGE_NAMES[code];
  const pref = (settings.language || '').toLowerCase();
  if (pref && pref !== 'auto' && LANGUAGE_NAMES[pref]) return LANGUAGE_NAMES[pref];
  return 'the same language as the input';
}

/**
 * Is the LLM post-processing layer effectively reachable?
 *
 * The ONLY signal we honour is "can we actually call a provider right
 * now?" — a Groq/OpenAI/Anthropic key is present, or Ollama is assumed
 * to be running locally. We deliberately do NOT gate on the old
 * `llmEnabled` setting here: selecting a non-raw mode in the mode picker
 * IS the user's intent to polish, and that is the only place users
 * actually think about modes. The legacy "Activer LLM" toggle in
 * SettingsView used to hard-block this path, which turned every mode
 * other than 'raw' into a silent no-op for the many users who never
 * opened SettingsView. `llmEnabled` is still kept on Settings so the
 * advanced-config panel can collapse its provider UI behind it, but it
 * no longer affects behaviour.
 */
function isLlmAvailable(settings: Settings): boolean {
  const p = settings.llmProvider || 'groq';
  if (p === 'ollama') return true; // local, no key needed
  if (p === 'groq') return !!(settings.groqApiKey || settings.llmApiKey);
  return !!settings.llmApiKey;
}

export async function postProcess(
  text: string,
  mode: Mode,
  settings: Settings,
  languageHint?: string,
): Promise<string> {
  if (mode === 'raw' || !text.trim()) return text;
  if (!isLlmAvailable(settings)) {
    const provider = settings.llmProvider || 'groq';
    console.warn(`[llm] mode=${mode} requested but no key configured for provider=${provider}.` +
      ` Returning raw Whisper text. Fix: set settings.groqApiKey (Groq / default) or` +
      ` settings.llmApiKey (OpenAI / Anthropic), or switch provider to 'ollama' for local.`);
    return text;
  }

  const template = MODE_PROMPTS[mode];
  if (!template) {
    console.warn(`[llm] unknown mode ${mode}, returning raw text`);
    return text;
  }

  const langName = resolveLangName(settings, languageHint);
  const prompt = template.replace(/\{\{LANG\}\}/g, langName);

  const provider = settings.llmProvider || 'groq';
  console.log(`[llm] postProcess mode=${mode} provider=${provider} lang=${langName} ` +
    `input=${text.length}ch`);

  try {
    let out = text;
    if (provider === 'groq') {
      out = await callOpenAICompat(text, prompt, 'https://api.groq.com/openai/v1/chat/completions',
        settings.groqApiKey || settings.llmApiKey,
        settings.llmModel || 'llama-3.3-70b-versatile',
        'groq');
    } else if (provider === 'openai') {
      out = await callOpenAICompat(text, prompt, 'https://api.openai.com/v1/chat/completions',
        settings.llmApiKey, settings.llmModel || 'gpt-4o-mini', 'openai');
    } else if (provider === 'ollama') {
      out = await callOllama(text, prompt, settings);
    } else if (provider === 'anthropic') {
      out = await callAnthropic(text, prompt, settings);
    }
    console.log(`[llm] postProcess done → ${out.length}ch`);
    return out;
  } catch (err: any) {
    console.error('[llm] postProcess failed, returning raw text:', err?.message || err);
    return text;
  }
}

async function callOpenAICompat(
  text: string,
  system: string,
  url: string,
  apiKey: string,
  model: string,
  label: string,
): Promise<string> {
  if (!apiKey) {
    console.warn(`[llm:${label}] no API key — cannot post-process`);
    return text;
  }
  const body = JSON.stringify({
    model,
    temperature: 0.2,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: text },
    ],
  });

  // Retry on 429 (rate limit) and 5xx with exponential backoff. When
  // Groq embeds a "try again in Xs" hint we honour it instead of our
  // own schedule — usually faster.
  const backoff = [1000, 2000, 4000];
  for (let attempt = 0; attempt <= backoff.length; attempt++) {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body,
    });
    if (res.ok) {
      const data = (await res.json()) as any;
      const out = data?.choices?.[0]?.message?.content;
      if (typeof out !== 'string' || !out.trim()) {
        console.warn(`[llm:${label}] empty / non-string response:`, JSON.stringify(data).slice(0, 200));
        return text;
      }
      return stripCodeFences(out.trim());
    }

    const retryable = res.status === 429 || (res.status >= 500 && res.status < 600);
    const errBody = await res.text().catch(() => '');
    if (!retryable || attempt === backoff.length) {
      console.warn(`[llm:${label}] HTTP ${res.status}: ${errBody.slice(0, 300)}`);
      return text;
    }

    // Parse optional "try again in <N>s" hint.
    let wait = backoff[attempt];
    const hint = errBody.match(/try again in ([0-9.]+)s/i);
    if (hint) wait = Math.max(wait, Math.ceil(parseFloat(hint[1]) * 1000));
    console.warn(`[llm:${label}] HTTP ${res.status} — retry ${attempt + 1}/${backoff.length} in ${wait}ms`);
    await new Promise((r) => setTimeout(r, wait));
  }
  return text;
}

async function callOllama(text: string, system: string, settings: Settings): Promise<string> {
  const res = await fetch('http://localhost:11434/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: settings.llmModel || 'llama3.2',
      stream: false,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: text },
      ],
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    console.warn(`[llm:ollama] HTTP ${res.status}: ${body.slice(0, 300)}`);
    return text;
  }
  const data = (await res.json()) as any;
  const out = data?.message?.content?.trim();
  return out ? stripCodeFences(out) : text;
}

async function callAnthropic(text: string, system: string, settings: Settings): Promise<string> {
  if (!settings.llmApiKey) {
    console.warn('[llm:anthropic] no API key');
    return text;
  }
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': settings.llmApiKey,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: settings.llmModel || 'claude-3-5-haiku-latest',
      max_tokens: 1024,
      system,
      messages: [{ role: 'user', content: text }],
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    console.warn(`[llm:anthropic] HTTP ${res.status}: ${body.slice(0, 300)}`);
    return text;
  }
  const data = (await res.json()) as any;
  const out = data?.content?.[0]?.text;
  return typeof out === 'string' && out.trim() ? stripCodeFences(out.trim()) : text;
}

/**
 * Some models wrap their output in ``` markdown fences even when told
 * not to. Strip a single outer fence if present (keeps inner fences —
 * e.g. a code snippet inside the message — intact).
 */
function stripCodeFences(s: string): string {
  const m = s.match(/^```[a-zA-Z]*\n([\s\S]*?)\n```$/);
  return m ? m[1].trim() : s;
}

/**
 * Translate text to `targetCode` (ISO 639-1). Uses Groq llama-3.1-8b-instant
 * by default for minimum latency — typically 60-150 ms end-to-end on a
 * warm socket (vs 200-450 ms for 70B). The translation quality difference
 * on short utterances (1-3 sentences) is imperceptible; 8B wins on
 * latency which is what the interpreter care about.
 *
 * The system prompt is deliberately short (~12 tokens): every extra
 * token costs ~1 ms on an 8B instant deployment because of the prefix
 * processing — we cut the old verbose prompt in half with no quality
 * regression observed on a 10-phrase FR↔EN benchmark.
 *
 * If `sourceCode` is provided AND equals target, this is a no-op.
 * Falls back to source text on any error.
 */
export async function translateText(
  text: string,
  targetCode: string,
  settings: Settings,
  sourceCode?: string,
): Promise<string> {
  if (!text.trim() || !targetCode) return text;
  if (sourceCode && sourceCode.toLowerCase() === targetCode.toLowerCase()) return text;

  const targetName = LANGUAGE_NAMES[targetCode.toLowerCase()] || targetCode;
  // Compact system prompt — tested equivalent-quality on FR↔EN↔ES↔DE.
  // Every extra token adds ~1 ms of prefix processing on llama-3.1-8b-instant.
  const system = `Translate to ${targetName}. Reply with ONLY the translation, no quotes, no notes.`;

  const apiKey = settings.groqApiKey || settings.llmApiKey;
  if (!apiKey) {
    console.warn('[translate] no Groq API key — skipping translation');
    return text;
  }

  try {
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        // Ask the Groq edge to keep the TCP socket alive so subsequent
        // requests reuse it — cuts the TCP + TLS handshake (~40-80 ms)
        // on every call after the first.
        Connection: 'keep-alive',
      },
      body: JSON.stringify({
        model: settings.translateModel || 'llama-3.1-8b-instant',
        temperature: 0,
        // Cap the output so a runaway model can't block the pipeline.
        // 512 tokens is ~2000 characters of translated text — plenty.
        max_tokens: 512,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: text },
        ],
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      console.warn(`[translate] Groq ${res.status}: ${body.slice(0, 200)}`);
      return text;
    }
    const data = (await res.json()) as any;
    const out = data?.choices?.[0]?.message?.content;
    return typeof out === 'string' && out.trim() ? out.trim() : text;
  } catch (err: any) {
    console.warn('[translate] error:', err?.message || err);
    return text;
  }
}

/**
 * Streaming variant of {@link translateText}. Yields one partial string
 * chunk per server-sent event. The caller is expected to accumulate
 * chunks until a **sentence boundary** is detected, then fire the TTS
 * pipeline on that partial — this is the core trick that lets the
 * interpreter start speaking before the translator has finished.
 *
 * Two extra optimizations over the non-streaming path:
 *   - `stream_options.include_usage: false` trims a few bytes from
 *     every SSE event.
 *   - We parse SSE inline instead of pulling a dependency; the Groq
 *     server emits well-formed `data: {...}\n\n` blocks.
 *
 * If streaming fails for any reason we fall back to the one-shot path
 * so the interpreter never breaks just because the stream hiccuped.
 */
/**
 * Open a TLS session to api.groq.com in the background so the next
 * translate / Whisper request reuses a warm socket instead of paying
 * the TCP + TLS handshake (~40-100 ms on a cold connection). The
 * result is intentionally discarded — we only want Node's undici
 * global agent to keep a socket in its pool.
 */
export function prewarmGroq(apiKey: string): void {
  if (!apiKey) return;
  // GET /models is cheap (no inference), idempotent, and uses the
  // same origin as both /audio/transcriptions and /chat/completions.
  fetch('https://api.groq.com/openai/v1/models', {
    method: 'GET',
    headers: { Authorization: `Bearer ${apiKey}`, Connection: 'keep-alive' },
  }).then((r) => r.arrayBuffer()).catch(() => { /* best-effort */ });
}

export async function* streamTranslate(
  text: string,
  targetCode: string,
  settings: Settings,
  sourceCode?: string,
  signal?: AbortSignal,
): AsyncGenerator<string, void, void> {
  if (!text.trim() || !targetCode) { return; }
  if (sourceCode && sourceCode.toLowerCase() === targetCode.toLowerCase()) {
    yield text;
    return;
  }
  const targetName = LANGUAGE_NAMES[targetCode.toLowerCase()] || targetCode;
  const system = `Translate to ${targetName}. Reply with ONLY the translation, no quotes, no notes.`;
  const apiKey = settings.groqApiKey || settings.llmApiKey;
  if (!apiKey) { yield text; return; }

  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      Connection: 'keep-alive',
      Accept: 'text/event-stream',
    },
    body: JSON.stringify({
      model: settings.translateModel || 'llama-3.1-8b-instant',
      temperature: 0,
      max_tokens: 512,
      stream: true,
      stream_options: { include_usage: false },
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: text },
      ],
    }),
    signal,
  });

  if (!res.ok || !res.body) {
    const body = res.ok ? '(no body)' : await res.text().catch(() => '');
    console.warn(`[translate:stream] ${res.status}: ${body.slice(0, 200)} — falling back to full translate`);
    const out = await translateText(text, targetCode, settings, sourceCode);
    yield out;
    return;
  }

  const reader = (res.body as ReadableStream<Uint8Array>).getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      // SSE events are separated by `\n\n`. Process all complete ones.
      let sep: number;
      while ((sep = buffer.indexOf('\n\n')) >= 0) {
        const raw = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);
        // Each event has one or more `data: ...` lines.
        for (const line of raw.split('\n')) {
          const m = line.trim();
          if (!m.startsWith('data:')) continue;
          const payload = m.slice(5).trim();
          if (!payload || payload === '[DONE]') continue;
          try {
            const obj = JSON.parse(payload);
            const delta = obj?.choices?.[0]?.delta?.content;
            if (typeof delta === 'string' && delta.length > 0) yield delta;
          } catch {
            // Malformed SSE line — skip silently (Groq rarely does this).
          }
        }
      }
    }
  } finally {
    try { reader.releaseLock(); } catch { /* ignore */ }
  }
}

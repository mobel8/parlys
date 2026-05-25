# Add Cerebras as an LLM provider (post-processing + translation)

## Context
VoiceInk = voice→text with optional LLM post-processing. Added Cerebras
(OpenAI-compatible API at api.cerebras.ai, wafer-scale, ~12 ms inference)
as a selectable LLM provider. STT (Whisper) stays on Groq — Cerebras has
no transcription. Translation routes through Cerebras only when the user
picks the cerebras provider; every other provider keeps the historical
Groq translation path byte-for-byte (zero regression).

Models available on the key: `gpt-oss-120b`, `qwen-3-235b-a22b-instruct-2507`,
`zai-glm-4.7`, `llama3.1-8b`. Default = `gpt-oss-120b`; all 4 selectable.
Key stored ONLY in `%APPDATA%\voiceink\voiceink-settings.json` + a
`CEREBRAS_API_KEY` env fallback. Never committed.

## Tasks
- [x] 1. `src/shared/types.ts` — add `'cerebras'` to `llmProvider` union
- [x] 2. `src/main/engines/llm.ts` — cerebras branch in `postProcess`
- [x] 3. `src/main/engines/llm.ts` — `translateBackend()`; route translate + stream
- [x] 4. `src/renderer/lib/constants.ts` — `CEREBRAS_LLM_MODELS` catalog
- [x] 5. `src/renderer/components/SettingsView.tsx` — option, model `<select>`,
        key input, smart default model on provider switch
- [x] 6. `src/main/services/validate.ts` — llmProvider enum guard (incl. cerebras)
- [x] 7. `src/main/services/config.ts` — `CEREBRAS_API_KEY` env fallback
- [x] 8. `scripts/_inject-cerebras-key.js` — patch user settings (WSL-aware path)
- [x] 9. `scripts/_test-cerebras.js` — real `postProcess`/`streamTranslate` from dist/
- [x] 10. Build: tsc main + renderer typecheck + vite build → 0 errors
- [x] 11. Test loop: 4 models × 3 modes + translate (one-shot + SSE) → 0 anomalies
- [x] 12. Inject key (groq STT key preserved + backup); isolated A/B boot + smoke:settings
- [ ] 13. USER: native micro-dictation final check (command provided in chat)

## Review

### Files modified
1. `src/shared/types.ts` — `llmProvider` union gains `'cerebras'`.
2. `src/main/engines/llm.ts` — (a) `postProcess` cerebras branch via the existing
   `callOpenAICompat` helper (api.cerebras.ai, default `gpt-oss-120b`); (b) new
   `translateBackend(settings)` that returns Cerebras url/key/model when the
   provider is cerebras, else the unchanged Groq path; `translateText` +
   `streamTranslate` now use it. `CEREBRAS_MODELS` guards the translate model so
   a stale Groq id never leaks into a Cerebras request.
3. `src/renderer/lib/constants.ts` — `CEREBRAS_LLM_MODELS` (4 models).
4. `src/renderer/components/SettingsView.tsx` — Cerebras `<option>`; model field
   becomes a `<select>` of the 4 models for cerebras; API-key input + "get a key"
   link shown for cerebras; switching provider→cerebras seeds `gpt-oss-120b` if
   the current model isn't a Cerebras id.
5. `src/main/services/validate.ts` — drops a forged/corrupt `llmProvider`
   (now incl. cerebras in the allow-list).
6. `src/main/services/config.ts` — `CEREBRAS_API_KEY` env fallback (cerebras only).

### Verification (all green)
- tsc main: exit 0 · renderer typecheck + vite build: exit 0.
- `_test-cerebras.js` against LIVE api (real compiled engine): 4 models × 3 modes
  + translateText + streamTranslate (SSE) + FR→FR no-op = **0 anomalies**.
  429s on qwen-235b proved the retry/backoff path; all recovered.
- `validate.js`: cerebras kept, `bogus` dropped, groq still accepted.
- Isolated-userData boot A/B (groq .bak vs cerebras): both clean boot ✅ (koffi +
  focus tracker load, no fatal patterns). `npm run smoke:settings`: PASS with the
  cerebras config active.

### Notes
- Earlier loop-smoke/smoke-settings early-exits were transient Windows
  single-instance mutex contention from my own repeated `taskkill /F`, NOT a
  regression — proven by the groq-vs-cerebras isolated A/B booting identically.
- Quality observed: gpt-oss-120b best balance; llama3.1-8b fastest (~190 ms);
  qwen-235b highest quality but free-tier rate-limited (429 + retry).

---

# Follow-up: Groq STT rate-limit resilience (real goal = escape Groq limits)

User's actual motivation: Groq quota too low → visible rate-limit errors.
Diagnosis: those errors come from **transcription** (Groq Whisper, `whisper.ts`),
which is Groq-only and threw on the first 429. Moving the LLM to Cerebras already
cut Groq calls per dictation by ~½–⅔ (post-proc + translation off Groq), but STT
stays on Groq (Cerebras has no transcription; `models/` empty = no local Whisper).

- [x] Add retry/back-off (1s/2s/4s + "try again in Xs" hint) to `transcribeWithGroq`
      so a transient per-minute 429 becomes an invisible pause, not an error.
      Non-retryable 4xx (bad key/audio) still throw. (`src/main/engines/whisper.ts`)
- [x] `scripts/_test-stt-retry.js` — stubs fetch, asserts 2×429→200 retried (3.1 s)
      and 401 throws immediately. 0 anomalies. Built into dist/main.
- [ ] If a per-DAY quota is exhausted (429 won't clear): user must pick OpenAI
      Whisper STT (impl: mirror whisper.ts on an OpenAI endpoint behind a
      `sttProvider` setting) or local Whisper. Deferred pending user test.

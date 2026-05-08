import Store from 'electron-store';
import { Settings, DEFAULT_SETTINGS } from '../../shared/types';

/**
 * electron-store captures app.getPath('userData') synchronously in its
 * constructor. If the Store is built at module-load time, it runs
 * before main/index.ts has a chance to call app.setName('voiceink'),
 * locking the settings file to %APPDATA%\Electron\ — a parallel tree
 * that drifts from the packaged app's %APPDATA%\voiceink\.
 *
 * We defer construction to first use so app.setName() / app.setPath()
 * have already fired by the time the Store is created.
 */
let _store: Store<{ settings: Settings }> | null = null;
function store(): Store<{ settings: Settings }> {
  if (!_store) {
    _store = new Store<{ settings: Settings }>({
      name: 'voiceink-settings',
      defaults: { settings: DEFAULT_SETTINGS },
    });
  }
  return _store;
}

/**
 * Migrate deprecated `mode` values to the current 4-mode set so users
 * who installed before the refactor don't end up with an unknown mode
 * that fails the validator on next transcribe.
 *
 * Mapping rationale:
 *   - email   → formal  (email = courteous register, minus greeting/closing)
 *   - meeting → natural (bullets are a format, not a tone; natural is safest)
 *   - summary → natural (length op, not a tone; natural preserves most content)
 *   - simple  → natural (plain vocabulary ≈ lightly-cleaned)
 */
const MODE_MIGRATION: Record<string, Settings['mode']> = {
  email: 'formal',
  meeting: 'natural',
  summary: 'natural',
  simple: 'natural',
};

/**
 * Latency-first migration (v1.4.0+) — rewrites a stale translateModel
 * value on existing installs to the new default.
 *
 * Why the rewrite instead of "just default": electron-store persists
 * the value as soon as the user hits "Save" anywhere in Settings,
 * which means pre-1.4 installs have `llama-3.3-70b-versatile` baked
 * into their JSON file. Without this migration they'd stay on the
 * slower 70b model forever — even after upgrading to 1.4 — because
 * their JSON overrides `DEFAULT_SETTINGS.translateModel`.
 *
 * 8b-instant translates FR↔EN, ES, DE short utterances with
 * indistinguishable quality at 1/3 the latency (benched on 10 phrases:
 * 70B p50=204 ms vs 8B p50=91 ms). Advanced users who WANT 70B can
 * still pick it manually from the dropdown after migration; only the
 * default moves.
 */
const TRANSLATE_MODEL_MIGRATION: Record<string, string> = {
  'llama-3.3-70b-versatile': 'llama-3.1-8b-instant',
};

export function getSettings(): Settings {
  const s = (store() as any).get('settings', DEFAULT_SETTINGS) as Settings;
  // Merge defaults (in case of new fields added later)
  const merged: Settings = { ...DEFAULT_SETTINGS, ...s };
  // Env var fallback for Groq key
  if (!merged.groqApiKey && process.env.GROQ_API_KEY) {
    merged.groqApiKey = process.env.GROQ_API_KEY;
  }
  // One-way mode migration — idempotent, only rewrites legacy strings.
  const migrated = MODE_MIGRATION[merged.mode as unknown as string];
  if (migrated) {
    merged.mode = migrated;
    try { (store() as any).set('settings.mode', migrated); } catch { /* ignore */ }
  }
  // Translate-model migration — idempotent, single-shot rewrite.
  const newModel = TRANSLATE_MODEL_MIGRATION[merged.translateModel];
  if (newModel) {
    merged.translateModel = newModel;
    try { (store() as any).set('settings.translateModel', newModel); } catch { /* ignore */ }
  }
  return merged;
}

export function setSettings(patch: Partial<Settings>): Settings {
  const current = getSettings();
  const next = { ...current, ...patch };
  (store() as any).set('settings', next);
  return next;
}

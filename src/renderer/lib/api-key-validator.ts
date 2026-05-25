// [EXPERIMENT:refonte-v1] Proactive API key format validation
//
// Pure, side-effect-free helper that decides whether a pasted string
// *looks* like a credential for a given provider. It does NOT call any
// network endpoint — it only matches against the public prefix + length
// conventions documented by each vendor. The goal is to catch trivial
// paste mistakes (truncated key, wrong provider selected, accidental
// inclusion of "Bearer ") *before* the user triggers a real request and
// sees an opaque 401 from the upstream API.
//
// Returns `{ valid: true }` for an unknown provider so that adding a new
// provider elsewhere in the app does not silently flag every key as
// invalid until this table is updated.

import React from 'react';

export interface KeyValidation {
  valid: boolean;
  hint?: string;
}

export function validateApiKeyFormat(provider: string, key: string): KeyValidation {
  if (!key || !key.trim()) return { valid: false };
  const k = key.trim();
  const patterns: Record<string, { re: RegExp; hint: string }> = {
    groq:       { re: /^gsk_[A-Za-z0-9]{20,}$/, hint: 'gsk_...' },
    openai:     { re: /^sk-(proj-)?[A-Za-z0-9_-]{20,}$/, hint: 'sk-proj-...' },
    anthropic:  { re: /^sk-ant-[A-Za-z0-9_-]{20,}$/, hint: 'sk-ant-...' },
    cerebras:   { re: /^csk-[A-Za-z0-9]{20,}$/, hint: 'csk-...' },
    cartesia:   { re: /^sk_car_[A-Za-z0-9]{15,}$/, hint: 'sk_car_...' },
    elevenlabs: { re: /^[A-Za-z0-9]{32,}$/, hint: '32+ alphanumeric chars' },
  };
  const p = patterns[provider.toLowerCase()];
  if (!p) return { valid: true }; // unknown provider, assume valid
  if (p.re.test(k)) return { valid: true };
  return { valid: false, hint: p.hint };
}

// [EXPERIMENT:refonte-v1] visual indicator for key validity
//
// Tiny inline badge meant to sit next to the `<label>` of an API-key
// input. Renders nothing when `valid` is null (e.g. the input is still
// empty and we don't want to nag the user before they start typing).
//
// Uses React.createElement instead of JSX so this module can stay a
// plain `.ts` file (the rest of /lib is JSX-free; switching to `.tsx`
// would be out of step with the surrounding code).
export function KeyValidityBadge(
  { valid, hint }: { valid: boolean | null; hint?: string },
): React.ReactElement | null {
  if (valid === null) return null;
  return React.createElement(
    'span',
    {
      className: `text-[10px] font-mono ml-2 ${valid ? 'text-emerald-300' : 'text-amber-300'}`,
      title: hint,
    },
    valid ? '✓ format OK' : '⚠ format',
  );
}

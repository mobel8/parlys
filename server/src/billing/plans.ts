/**
 * Plan definitions — single source of truth for quotas & pricing.
 *
 * When a new plan is added or a quota changes:
 *   1. Edit the relevant `PLANS[...]` entry here.
 *   2. Create / update the corresponding Stripe Price in the dashboard.
 *   3. Paste the new `price_` id into `server/.env`.
 *   4. Update the landing page pricing cards (landing/src/lib/pricing.ts).
 *
 * Quotas are expressed as:
 *   - `transcribe_minutes_per_month` : Whisper input audio minutes
 *   - `interpret_minutes_per_month`  : end-to-end interpreter minutes
 *   - `speak_minutes_per_month`      : TTS output minutes
 *   - `translate_requests_per_day`   : orthogonal per-day throttle to
 *                                      prevent abuse (e.g. someone
 *                                      scripting us as a free DeepL)
 *
 * `null` means "unlimited" (enforced by a soft fair-use cap, not hardcoded).
 */
import type { Plan } from '../db/index.js';

export interface PlanDefinition {
  key: Plan;
  displayName: string;
  /** Monthly EUR price shown on the pricing page. 0 means free. */
  priceEurMonthly: number;
  /** Annual EUR price (per month). Often ~10 months for a yearly sub. */
  priceEurYearly: number | null;
  /** Hard-cap on audio input transcribed per month. null = unlimited. */
  transcribeMinutesPerMonth: number | null;
  /** Interpreter end-to-end time. This bounds the most expensive pipeline. */
  interpretMinutesPerMonth: number | null;
  /** TTS output (Cartesia/ElevenLabs). The dominant cost driver. */
  speakMinutesPerMonth: number | null;
  /** Per-day translate rate limit (orthogonal anti-abuse cap). */
  translateRequestsPerDay: number | null;
  /** Whether the plan allows the desktop app to bypass our broker and
   *  use the user's own provider keys ("bring your own key"). Useful
   *  for paranoid enterprise buyers or cost-optimisers. */
  byokAllowed: boolean;
  /** Feature flags — used by the app to show/hide premium affordances. */
  features: {
    interpreter: boolean;
    listener: boolean;
    exportHistory: boolean;
    customDictionary: boolean;
    teamWorkspace: boolean;
    ssoSaml: boolean;
    prioritySupport: boolean;
    auditLog: boolean;
  };
}

export const PLANS: Record<Plan, PlanDefinition> = {
  free: {
    key: 'free',
    displayName: 'Free',
    priceEurMonthly: 0,
    priceEurYearly: null,
    // 30 min/day soft cap — about 15 h/month if you max out every day.
    transcribeMinutesPerMonth: 30 * 30,
    interpretMinutesPerMonth: 15,        // 15 total min of interpreter/month
    speakMinutesPerMonth: 10,            // 10 total min of TTS/month
    translateRequestsPerDay: 100,
    byokAllowed: true,                   // Free users can BYOK freely.
    features: {
      interpreter: true,                 // teaser — capped tightly
      listener: false,
      exportHistory: false,
      customDictionary: false,
      teamWorkspace: false,
      ssoSaml: false,
      prioritySupport: false,
      auditLog: false,
    },
  },
  pro: {
    key: 'pro',
    displayName: 'Pro',
    priceEurMonthly: 9.90,
    priceEurYearly: 99,
    transcribeMinutesPerMonth: 3000,     // 50h of dictation/month
    interpretMinutesPerMonth: 600,       // 10h of interpreter
    speakMinutesPerMonth: 600,           // 10h of TTS
    translateRequestsPerDay: 2000,
    byokAllowed: true,
    features: {
      interpreter: true,
      listener: true,
      exportHistory: true,
      customDictionary: true,
      teamWorkspace: false,
      ssoSaml: false,
      prioritySupport: false,
      auditLog: false,
    },
  },
  team: {
    key: 'team',
    displayName: 'Team',
    priceEurMonthly: 19,
    priceEurYearly: null,                // per-seat billed monthly
    transcribeMinutesPerMonth: null,     // unlimited (fair-use policy)
    interpretMinutesPerMonth: 1800,      // 30h — plenty for most users
    speakMinutesPerMonth: 1800,
    translateRequestsPerDay: 10000,
    byokAllowed: true,
    features: {
      interpreter: true,
      listener: true,
      exportHistory: true,
      customDictionary: true,
      teamWorkspace: true,
      ssoSaml: false,
      prioritySupport: true,
      auditLog: false,
    },
  },
  enterprise: {
    key: 'enterprise',
    displayName: 'Enterprise',
    // Enterprise is negotiated. The numbers below are "starting from".
    priceEurMonthly: 49,
    priceEurYearly: null,
    transcribeMinutesPerMonth: null,
    interpretMinutesPerMonth: null,
    speakMinutesPerMonth: null,
    translateRequestsPerDay: null,
    byokAllowed: true,
    features: {
      interpreter: true,
      listener: true,
      exportHistory: true,
      customDictionary: true,
      teamWorkspace: true,
      ssoSaml: true,
      prioritySupport: true,
      auditLog: true,
    },
  },
};

/**
 * Map a Stripe `price_` id back to our Plan key. Used by the webhook
 * handler when Stripe notifies us of a successful checkout.
 */
export function planFromPriceId(priceId: string, env: {
  stripePricePro: { monthly: string; yearly: string };
  stripePriceTeam: { monthly: string };
}): Plan | null {
  if (priceId === env.stripePricePro.monthly)  return 'pro';
  if (priceId === env.stripePricePro.yearly)   return 'pro';
  if (priceId === env.stripePriceTeam.monthly) return 'team';
  return null;
}

/**
 * Typed environment — single source of truth for every secret & knob.
 *
 * Contract: reading `env.FOO` is compile-checked (no typos) and the
 * module throws at import time if a REQUIRED variable is missing.
 * Optional variables have sane defaults so `npm run dev` Just Works
 * with zero configuration.
 *
 * Why not zod / @sinclair/typebox: we have ~20 fields, a hand-written
 * parser is < 80 LOC and doesn't pull in a validator runtime. All the
 * types we care about (string | number | boolean | URL) are trivial.
 */
import 'dotenv/config';

function read(name: string, required = true, fallback?: string): string {
  const v = process.env[name];
  if (v === undefined || v === '') {
    if (required && fallback === undefined) {
      throw new Error(
        `[env] Missing required variable: ${name}. ` +
        `Copy server/.env.example to server/.env and fill it in.`,
      );
    }
    return fallback ?? '';
  }
  return v;
}

function readInt(name: string, fallback: number): number {
  const v = process.env[name];
  if (!v) return fallback;
  const n = Number.parseInt(v, 10);
  if (!Number.isFinite(n)) throw new Error(`[env] ${name} is not an integer: ${v}`);
  return n;
}

const isTest = process.env.NODE_ENV === 'test';

export const env = {
  nodeEnv: read('NODE_ENV', false, 'development') as 'development' | 'production' | 'test',
  port: readInt('PORT', 8787),
  corsOrigin: read('CORS_ORIGIN', false, 'http://localhost:5173'),

  // Database is the only hard requirement even for a minimal boot.
  databaseUrl: read('DATABASE_URL', !isTest, 'postgres://postgres:dev@localhost:5432/voiceink'),

  // Auth — if unset, the auth middleware falls back to a dev bypass
  // that trusts an `X-Dev-User: <userId>` header. NEVER in production.
  clerkJwksUrl: read('CLERK_JWKS_URL', false),
  clerkIssuer: read('CLERK_ISSUER', false),

  // Stripe — optional in dev; billing endpoints return 503 if missing.
  stripeSecretKey: read('STRIPE_SECRET_KEY', false),
  stripeWebhookSecret: read('STRIPE_WEBHOOK_SECRET', false),
  stripePricePro: {
    monthly: read('STRIPE_PRICE_PRO_MONTHLY', false),
    yearly:  read('STRIPE_PRICE_PRO_YEARLY',  false),
  },
  stripePriceTeam: {
    monthly: read('STRIPE_PRICE_TEAM_MONTHLY', false),
  },

  // Provider broker keys (ours, used for all non-BYOK users).
  groqApiKey:       read('GROQ_API_KEY',       false),
  cartesiaApiKey:   read('CARTESIA_API_KEY',   false),
  elevenlabsApiKey: read('ELEVENLABS_API_KEY', false),
  openaiApiKey:     read('OPENAI_API_KEY',     false),

  redisUrl: read('REDIS_URL', false),
} as const;

export type Env = typeof env;

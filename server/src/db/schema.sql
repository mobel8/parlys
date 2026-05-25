-- VoiceInk backend schema v1
-- ─────────────────────────────────────────────────────────────────────
-- Tables:
--   users            — one row per authenticated user (Clerk sub = id)
--   subscriptions    — Stripe subscription snapshot, updated via webhook
--   usage_logs       — append-only audit of every billable API call
--   usage_counters   — materialised monthly usage per user (fast quota check)
--
-- Design notes:
-- - No ORM. `postgres` driver + raw SQL keeps dependency count low and
--   gives us full control over indexes. The schema fits on one screen
--   and rarely changes — an ORM's weight isn't justified.
-- - `users.id = Clerk sub` (the `sub` claim of their JWT). No autogen
--   UUID; Clerk already owns identity, we just reference it.
-- - `usage_logs` is append-only and partitioned by month in production
--   (add CREATE TABLE … PARTITION OF when scale demands it). At < 1M
--   rows/month it's fine as a plain table with a btree index.
-- - `usage_counters` is updated within the same transaction as the
--   log insert, so quota reads are a single-row lookup. No scan.
--
-- To run: `psql $DATABASE_URL < server/src/db/schema.sql`

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ─── users ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id              TEXT PRIMARY KEY,                -- Clerk `sub`
  email           TEXT NOT NULL,
  display_name    TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Effective plan at this instant. Kept in sync with `subscriptions`
  -- via the Stripe webhook — denormalised because 99 % of auth-middleware
  -- lookups only need the plan string, not the full subscription row.
  plan            TEXT NOT NULL DEFAULT 'free',    -- free | pro | team | enterprise
  -- Stripe customer id, null until the user starts checkout. Unique
  -- because one Stripe customer maps to exactly one Clerk user for us.
  stripe_customer_id TEXT UNIQUE
);

CREATE INDEX IF NOT EXISTS idx_users_plan      ON users(plan);
CREATE INDEX IF NOT EXISTS idx_users_last_seen ON users(last_seen_at);

-- ─── subscriptions ──────────────────────────────────────────────────
-- One row per ACTIVE or PAST Stripe subscription. We keep history for
-- audit, MRR calculations, and winback campaigns.
CREATE TABLE IF NOT EXISTS subscriptions (
  id                      TEXT PRIMARY KEY,                           -- Stripe sub id (sub_…)
  user_id                 TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  stripe_customer_id      TEXT NOT NULL,
  stripe_price_id         TEXT NOT NULL,
  plan                    TEXT NOT NULL,                              -- pro | team | enterprise
  status                  TEXT NOT NULL,                              -- trialing | active | past_due | canceled | incomplete…
  current_period_start    TIMESTAMPTZ NOT NULL,
  current_period_end      TIMESTAMPTZ NOT NULL,
  cancel_at_period_end    BOOLEAN NOT NULL DEFAULT false,
  canceled_at             TIMESTAMPTZ,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_subscriptions_user   ON subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_status ON subscriptions(status);

-- ─── usage_logs ─────────────────────────────────────────────────────
-- Append-only. Never update or delete (except purge jobs after 13 months
-- for GDPR). Feeds the monthly usage_counters + audit / dispute lookups.
CREATE TABLE IF NOT EXISTS usage_logs (
  id             BIGSERIAL PRIMARY KEY,
  user_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  occurred_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  kind           TEXT NOT NULL,                  -- transcribe | translate | interpret | speak
  provider       TEXT,                           -- groq | cartesia | elevenlabs | openai
  -- Minutes of audio processed. For TTS: seconds of spoken output.
  -- For transcribe: seconds of input audio (Whisper sees). For
  -- translate: 0 (text-only, billed as fraction of input chars → we
  -- keep this simple and charge per request in `request_count`).
  audio_seconds  NUMERIC(10, 3) NOT NULL DEFAULT 0,
  -- Characters of text sent through LLM or TTS (for cost granularity).
  chars          INTEGER NOT NULL DEFAULT 0,
  -- We count one API call as one request. Useful for rate-limits
  -- orthogonal to time/char usage (e.g. "max 5000 requests/day Free").
  request_count  INTEGER NOT NULL DEFAULT 1,
  -- Upstream provider latency (for SLO dashboards).
  upstream_ms    INTEGER,
  status         SMALLINT NOT NULL DEFAULT 200,  -- HTTP status returned
  error_code     TEXT,
  -- Month-key for fast bucket lookup. Format: 'YYYY-MM'. Indexed.
  month_bucket   TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_usage_logs_user_month ON usage_logs(user_id, month_bucket);
CREATE INDEX IF NOT EXISTS idx_usage_logs_occurred   ON usage_logs(occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_usage_logs_kind       ON usage_logs(kind);

-- ─── usage_counters ─────────────────────────────────────────────────
-- Materialised aggregate per (user, month). Updated in the same tx as
-- a usage_logs insert. Quota checks hit this single row → O(1) latency.
CREATE TABLE IF NOT EXISTS usage_counters (
  user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  month_bucket    TEXT NOT NULL,                          -- 'YYYY-MM'
  transcribe_seconds   NUMERIC(12, 3) NOT NULL DEFAULT 0,
  interpret_seconds    NUMERIC(12, 3) NOT NULL DEFAULT 0,
  speak_seconds        NUMERIC(12, 3) NOT NULL DEFAULT 0,
  translate_requests   INTEGER NOT NULL DEFAULT 0,
  total_requests       INTEGER NOT NULL DEFAULT 0,
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, month_bucket)
);

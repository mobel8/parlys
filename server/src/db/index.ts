/**
 * Database singleton. Uses `postgres.js` (lightweight driver, no
 * connection pool boilerplate to manage — it pools internally).
 *
 * We export a pre-configured `sql` template-tag that callers use:
 *
 *   const rows = await sql<User[]>`select * from users where id = ${id}`;
 *
 * postgres.js escapes parameters automatically — never string-concat
 * user input. The `<User[]>` generic is pure type-shaping, not runtime
 * validation; the DB guarantees the shape via its schema.
 */
import postgres from 'postgres';
import { env } from '../env.js';

export const sql = postgres(env.databaseUrl, {
  // Reasonable pool defaults for a single-region Fly.io deployment.
  // Scale up `max` only if you observe `PG_CONNECTION_EXHAUSTED` logs.
  max: 10,
  idle_timeout: 20,
  connect_timeout: 10,
  // Silence the "notice" channel in production; keep it loud in dev.
  onnotice: env.nodeEnv === 'production' ? () => { /* swallow */ } : undefined,
  // JSON columns come back as parsed objects by default. We don't use
  // JSON columns yet, but this is the right default when we do.
});

/** Graceful shutdown hook — flush the pool on app exit. */
export async function closeDb() {
  await sql.end({ timeout: 5 });
}

// Types that match `server/src/db/schema.sql`. Kept hand-written instead
// of generating from the DB — the schema is small and hand-typing
// catches semantic bugs (e.g. a nullable column marked non-null).

export type Plan = 'free' | 'pro' | 'team' | 'enterprise';

export interface User {
  id: string;
  email: string;
  display_name: string | null;
  created_at: Date;
  last_seen_at: Date;
  plan: Plan;
  stripe_customer_id: string | null;
}

export interface Subscription {
  id: string;
  user_id: string;
  stripe_customer_id: string;
  stripe_price_id: string;
  plan: Plan;
  status: string;
  current_period_start: Date;
  current_period_end: Date;
  cancel_at_period_end: boolean;
  canceled_at: Date | null;
}

export interface UsageCounters {
  user_id: string;
  month_bucket: string;
  transcribe_seconds: string;   // NUMERIC → string from postgres.js
  interpret_seconds: string;
  speak_seconds: string;
  translate_requests: number;
  total_requests: number;
}

/** Current month key in YYYY-MM format, UTC. */
export function currentMonthBucket(): string {
  const d = new Date();
  const m = (d.getUTCMonth() + 1).toString().padStart(2, '0');
  return `${d.getUTCFullYear()}-${m}`;
}

/**
 * Quota enforcement & usage tracking.
 *
 * Two orthogonal layers:
 *   1. **Per-month hard cap** (transcribe / interpret / speak minutes) — the
 *      revenue-critical constraint that gates Free vs Pro vs Team.
 *   2. **Per-day rate limit** on translate requests — a cheap anti-abuse
 *      throttle that prevents bots from turning Free into a public proxy.
 *
 * The implementation is a single `check(kind, costUnits)` call that:
 *   - reads the user's plan from `req.auth.plan`
 *   - fetches the current month's counters in one SELECT
 *   - returns either `{ ok: true }` or `{ ok: false, reason, limit, used }`
 *
 * On success, the route handler proxies the upstream provider, then
 * calls `log(kind, details)` to append to `usage_logs` AND bump
 * `usage_counters` atomically.
 */
import { sql, currentMonthBucket, type Plan, type UsageCounters } from './db/index.js';
import { PLANS } from './billing/plans.js';

export interface QuotaOk   { ok: true }
export interface QuotaDeny {
  ok: false;
  reason: 'monthly_limit' | 'daily_limit';
  kind: string;
  used: number;
  limit: number;
  /** Human-readable hint for the error body. */
  message: string;
}
export type QuotaResult = QuotaOk | QuotaDeny;

type UsageKind = 'transcribe' | 'interpret' | 'speak' | 'translate';

async function getCounters(userId: string): Promise<UsageCounters | null> {
  const month = currentMonthBucket();
  const rows = await sql<UsageCounters[]>`
    SELECT * FROM usage_counters
    WHERE user_id = ${userId} AND month_bucket = ${month}
  `;
  return rows[0] ?? null;
}

/**
 * Precheck: can the user afford `costUnits` of `kind` without exceeding
 * their plan's monthly cap?
 *
 * `costUnits` meaning:
 *   - transcribe | interpret | speak : seconds (we convert to minutes)
 *   - translate : number of requests (usually 1)
 *
 * For streaming endpoints (interpret, speak), we preallocate the
 * reservation at "starting-cost" (e.g. 10s for a minimum call) and
 * reconcile the exact amount in `log()` once the stream ends.
 */
export async function checkQuota(
  userId: string,
  plan: Plan,
  kind: UsageKind,
  costUnits: number,
): Promise<QuotaResult> {
  const def = PLANS[plan];
  const counters = await getCounters(userId);

  // Monthly caps (if defined).
  if (kind === 'transcribe' && def.transcribeMinutesPerMonth !== null) {
    const usedMin = Number(counters?.transcribe_seconds ?? 0) / 60;
    const wouldBe = usedMin + costUnits / 60;
    if (wouldBe > def.transcribeMinutesPerMonth) {
      return {
        ok: false,
        reason: 'monthly_limit',
        kind,
        used: Math.round(usedMin),
        limit: def.transcribeMinutesPerMonth,
        message: `You've used ${Math.round(usedMin)}/${def.transcribeMinutesPerMonth} transcription minutes this month.`,
      };
    }
  }
  if (kind === 'interpret' && def.interpretMinutesPerMonth !== null) {
    const usedMin = Number(counters?.interpret_seconds ?? 0) / 60;
    const wouldBe = usedMin + costUnits / 60;
    if (wouldBe > def.interpretMinutesPerMonth) {
      return {
        ok: false, reason: 'monthly_limit', kind,
        used: Math.round(usedMin), limit: def.interpretMinutesPerMonth,
        message: `You've used ${Math.round(usedMin)}/${def.interpretMinutesPerMonth} interpreter minutes this month.`,
      };
    }
  }
  if (kind === 'speak' && def.speakMinutesPerMonth !== null) {
    const usedMin = Number(counters?.speak_seconds ?? 0) / 60;
    const wouldBe = usedMin + costUnits / 60;
    if (wouldBe > def.speakMinutesPerMonth) {
      return {
        ok: false, reason: 'monthly_limit', kind,
        used: Math.round(usedMin), limit: def.speakMinutesPerMonth,
        message: `You've used ${Math.round(usedMin)}/${def.speakMinutesPerMonth} voice-synthesis minutes this month.`,
      };
    }
  }

  // Translate uses a daily cap (requests, not time).
  if (kind === 'translate' && def.translateRequestsPerDay !== null) {
    const startOfDay = new Date();
    startOfDay.setUTCHours(0, 0, 0, 0);
    const rows = await sql<{ c: string }[]>`
      SELECT COUNT(*)::text AS c FROM usage_logs
      WHERE user_id = ${userId}
        AND kind = 'translate'
        AND occurred_at >= ${startOfDay}
    `;
    const usedToday = Number(rows[0]?.c ?? 0);
    if (usedToday + costUnits > def.translateRequestsPerDay) {
      return {
        ok: false, reason: 'daily_limit', kind,
        used: usedToday, limit: def.translateRequestsPerDay,
        message: `Daily translation limit reached (${usedToday}/${def.translateRequestsPerDay}). Resets at 00:00 UTC.`,
      };
    }
  }

  return { ok: true };
}

/**
 * Append a row to `usage_logs` AND update `usage_counters` atomically.
 * Must be called AFTER the upstream provider returned successfully —
 * we don't bill users for 5xx errors.
 */
export async function logUsage(args: {
  userId: string;
  kind: UsageKind;
  provider?: string;
  audioSeconds?: number;
  chars?: number;
  upstreamMs?: number;
  status?: number;
  errorCode?: string;
}): Promise<void> {
  const {
    userId, kind, provider,
    audioSeconds = 0, chars = 0, upstreamMs,
    status = 200, errorCode,
  } = args;
  const month = currentMonthBucket();

  // `postgres.js` wraps a tagged template in an implicit transaction
  // when called with `.begin` — but for two tables, a CTE is simpler
  // and round-trip-cheaper than opening a real tx.
  await sql`
    WITH ins AS (
      INSERT INTO usage_logs
        (user_id, kind, provider, audio_seconds, chars, request_count,
         upstream_ms, status, error_code, month_bucket)
      VALUES
        (${userId}, ${kind}, ${provider ?? null}, ${audioSeconds}, ${chars}, 1,
         ${upstreamMs ?? null}, ${status}, ${errorCode ?? null}, ${month})
      RETURNING 1
    )
    INSERT INTO usage_counters
      (user_id, month_bucket,
       transcribe_seconds, interpret_seconds, speak_seconds,
       translate_requests, total_requests, updated_at)
    VALUES
      (${userId}, ${month},
       ${kind === 'transcribe' ? audioSeconds : 0},
       ${kind === 'interpret'  ? audioSeconds : 0},
       ${kind === 'speak'      ? audioSeconds : 0},
       ${kind === 'translate'  ? 1 : 0},
       1, now())
    ON CONFLICT (user_id, month_bucket) DO UPDATE SET
      transcribe_seconds = usage_counters.transcribe_seconds
        + EXCLUDED.transcribe_seconds,
      interpret_seconds  = usage_counters.interpret_seconds
        + EXCLUDED.interpret_seconds,
      speak_seconds      = usage_counters.speak_seconds
        + EXCLUDED.speak_seconds,
      translate_requests = usage_counters.translate_requests
        + EXCLUDED.translate_requests,
      total_requests     = usage_counters.total_requests + 1,
      updated_at         = now()
  `;
}

/** Read-only accessor for the `/me/usage` endpoint. */
export async function getUsageSnapshot(userId: string) {
  const counters = await getCounters(userId);
  return {
    month: currentMonthBucket(),
    transcribe_seconds: Number(counters?.transcribe_seconds ?? 0),
    interpret_seconds:  Number(counters?.interpret_seconds ?? 0),
    speak_seconds:      Number(counters?.speak_seconds ?? 0),
    translate_requests: counters?.translate_requests ?? 0,
    total_requests:     counters?.total_requests ?? 0,
  };
}

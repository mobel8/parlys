/**
 * Auth middleware — verifies a Clerk-issued JWT on every protected route.
 *
 * Flow:
 *   1. Extract Bearer token from `Authorization` header (or fail 401).
 *   2. Verify signature via Clerk's public JWKS (cached by `jose`).
 *   3. Upsert the user row in Postgres (idempotent, keeps `last_seen_at` fresh).
 *   4. Attach `{ userId, email, plan }` to `request.auth` for downstream handlers.
 *
 * Dev bypass:
 *   When `CLERK_JWKS_URL` is unset (i.e. local dev), the middleware accepts
 *   an `X-Dev-User: <userId>` header without any verification. This is
 *   REFUSED in production (`NODE_ENV === 'production'`) — a misconfigured
 *   prod would otherwise authenticate the entire internet as whatever
 *   userId the attacker sends.
 */
import { createRemoteJWKSet, jwtVerify } from 'jose';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { env } from './env.js';
import { sql, type Plan } from './db/index.js';

declare module 'fastify' {
  interface FastifyRequest {
    auth?: {
      userId: string;
      email: string;
      plan: Plan;
    };
  }
}

// Build the JWKS client once at module load. `jose` handles caching,
// rotation and retries internally — no manual refresh loop needed.
const jwks = env.clerkJwksUrl
  ? createRemoteJWKSet(new URL(env.clerkJwksUrl))
  : null;

interface ClerkJwtPayload {
  sub: string;
  email?: string;
  email_verified?: boolean;
  // Clerk puts the user's primary email in different claims depending
  // on the project config. We check the most common ones in order.
  primary_email_address?: string;
}

async function verifyClerkToken(token: string): Promise<ClerkJwtPayload> {
  if (!jwks) throw new Error('clerk not configured');
  const { payload } = await jwtVerify(token, jwks, {
    issuer: env.clerkIssuer || undefined,
  });
  return payload as unknown as ClerkJwtPayload;
}

/** Idempotent user upsert + bump last_seen_at. */
async function touchUser(userId: string, email: string): Promise<Plan> {
  const rows = await sql<{ plan: Plan }[]>`
    INSERT INTO users (id, email, last_seen_at)
    VALUES (${userId}, ${email}, now())
    ON CONFLICT (id) DO UPDATE
      SET last_seen_at = now(),
          email = EXCLUDED.email
    RETURNING plan
  `;
  return rows[0]?.plan ?? 'free';
}

/**
 * Fastify preHandler hook. Attach with:
 *   server.addHook('preHandler', requireAuth);
 * on the route group that needs authentication.
 */
export async function requireAuth(req: FastifyRequest, reply: FastifyReply) {
  const header = req.headers.authorization ?? '';
  const m = /^Bearer\s+(.+)$/.exec(header);
  const token = m?.[1];

  // ─── Dev bypass ───────────────────────────────────────────────
  // Accept X-Dev-User when Clerk isn't configured AND we're not in prod.
  // Strict NODE_ENV check — not just `!jwks`, so a misconfigured prod
  // without Clerk still refuses everything rather than rubber-stamp it.
  if (!jwks && env.nodeEnv !== 'production') {
    const devUser = req.headers['x-dev-user'];
    if (typeof devUser === 'string' && devUser.length > 0) {
      const plan = await touchUser(devUser, `${devUser}@dev.local`);
      req.auth = { userId: devUser, email: `${devUser}@dev.local`, plan };
      return;
    }
  }

  if (!token) {
    return reply.code(401).send({ error: 'missing_token' });
  }

  try {
    const payload = await verifyClerkToken(token);
    const userId = payload.sub;
    const email = payload.email || payload.primary_email_address || '';
    if (!userId) {
      return reply.code(401).send({ error: 'invalid_token' });
    }
    const plan = await touchUser(userId, email);
    req.auth = { userId, email, plan };
  } catch (err) {
    req.log.warn({ err }, 'auth verification failed');
    return reply.code(401).send({ error: 'invalid_token' });
  }
}

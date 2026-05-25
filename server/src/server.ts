/**
 * VoiceInk backend entrypoint.
 *
 * Minimal middleware stack — we don't need request logging libraries or
 * metrics wrappers yet. Fastify's built-in logger + standard healthcheck
 * is enough to ship v0.
 *
 * Layout:
 *   /health                       — liveness probe (no auth, no DB)
 *   /api/v1/*                     — authenticated API routes
 *   /billing/webhook              — Stripe webhook (signature-verified)
 *   /billing/checkout-session     — authenticated
 *   /billing/portal-session       — authenticated
 */
import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import sensible from '@fastify/sensible';
import rateLimit from '@fastify/rate-limit';
import multipart from '@fastify/multipart';
import { env } from './env.js';
import { registerApiRoutes } from './routes/api.js';
import { registerBillingRoutes } from './routes/billing.js';
import { closeDb } from './db/index.js';

async function buildServer() {
  const server = Fastify({
    logger: {
      level: env.nodeEnv === 'production' ? 'info' : 'debug',
      transport: env.nodeEnv === 'production'
        ? undefined
        : { target: 'pino-pretty', options: { colorize: true } },
    },
    // Capture the raw webhook body BEFORE JSON parsing so Stripe's
    // signature verification can run on exact bytes (see billing.ts).
    bodyLimit: 20 * 1024 * 1024, // 20 MB — a 10-minute Opus upload fits
  });

  // Raw-body capture for /billing/webhook. Fastify doesn't expose a
  // per-route raw flag out of the box, so we capture the raw bytes
  // on every JSON POST and store them under req.rawBody when a route
  // opted in via `config.rawBody`.
  server.addContentTypeParser('application/json', { parseAs: 'buffer' }, (req, body: Buffer, done) => {
    if ((req.routeOptions.config as any)?.rawBody) {
      (req as any).rawBody = body;
    }
    try {
      const json = body.length ? JSON.parse(body.toString('utf8')) : undefined;
      done(null, json);
    } catch (err) {
      done(err as Error, undefined);
    }
  });

  await server.register(helmet, {
    // We serve audio/mpeg inline — CSP defaults would force download.
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  });
  await server.register(cors, {
    origin: env.corsOrigin.split(',').map((s) => s.trim()).filter(Boolean),
    credentials: true,
  });
  await server.register(sensible);
  await server.register(rateLimit, {
    global: true,
    max: 600,
    timeWindow: '1 minute',
    // Key by userId when authenticated, else IP. Prevents one shared
    // NAT (school wifi) from being throttled by a single noisy user.
    keyGenerator: (req) => {
      const a = (req as any).auth;
      return a?.userId || req.ip;
    },
  });
  await server.register(multipart, {
    limits: { fileSize: 20 * 1024 * 1024 },  // 20 MB audio upload cap
  });

  // Health — dead simple. If this returns 200 the process is alive;
  // we don't test the DB here so Fly.io's health checks don't cascade
  // during transient Postgres blips.
  server.get('/health', async () => ({ ok: true, version: '0.1.0' }));

  await server.register(registerApiRoutes, { prefix: '/api/v1' });
  await server.register(registerBillingRoutes, { prefix: '/billing' });

  return server;
}

async function main() {
  const server = await buildServer();

  const shutdown = async (signal: string) => {
    server.log.info({ signal }, 'shutting down');
    try { await server.close(); } catch (err) { server.log.error({ err }); }
    try { await closeDb(); } catch (err) { server.log.error({ err }); }
    process.exit(0);
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT',  () => shutdown('SIGINT'));

  try {
    await server.listen({ host: '0.0.0.0', port: env.port });
    server.log.info(`VoiceInk backend listening on :${env.port}`);
  } catch (err) {
    server.log.error({ err }, 'failed to start');
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('[fatal]', err);
  process.exit(1);
});

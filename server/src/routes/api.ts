/**
 * Public API routes — what the Electron app (and any future third-party
 * integration) calls to do real work.
 *
 * All routes in this file require authentication via `requireAuth`.
 *
 * Contract:
 *   POST /api/v1/transcribe     — multipart upload, returns JSON
 *   POST /api/v1/translate      — JSON in/out
 *   POST /api/v1/speak          — JSON in, streams `audio/mpeg` out
 *   GET  /api/v1/me             — current user + plan + features
 *   GET  /api/v1/me/usage       — current-month usage snapshot
 */
import type { FastifyInstance } from 'fastify';
import { Type } from '@sinclair/typebox';
import { requireAuth } from '../auth.js';
import { checkQuota, logUsage, getUsageSnapshot } from '../quota.js';
import { PLANS } from '../billing/plans.js';
import { transcribe, translate, speakStream } from '../providers.js';

export async function registerApiRoutes(server: FastifyInstance) {
  server.addHook('preHandler', requireAuth);

  // ─── GET /api/v1/me ───────────────────────────────────────────────
  server.get('/me', async (req) => {
    const { userId, email, plan } = req.auth!;
    const def = PLANS[plan];
    return {
      userId,
      email,
      plan,
      features: def.features,
      quotas: {
        transcribeMinutesPerMonth: def.transcribeMinutesPerMonth,
        interpretMinutesPerMonth:  def.interpretMinutesPerMonth,
        speakMinutesPerMonth:      def.speakMinutesPerMonth,
        translateRequestsPerDay:   def.translateRequestsPerDay,
      },
    };
  });

  // ─── GET /api/v1/me/usage ─────────────────────────────────────────
  server.get('/me/usage', async (req) => {
    const usage = await getUsageSnapshot(req.auth!.userId);
    return { usage };
  });

  // ─── POST /api/v1/transcribe ──────────────────────────────────────
  // Multipart audio upload. We use Fastify's built-in multipart handler
  // (registered at the server level in server.ts) to stream the upload
  // without buffering the whole file in Node's heap.
  server.post('/transcribe', async (req, reply) => {
    const { userId, plan } = req.auth!;
    const file = await req.file();
    if (!file) return reply.code(400).send({ error: 'no_file' });

    const buf = await file.toBuffer();
    const mimeType = file.mimetype || 'audio/mpeg';
    const language = (file.fields?.language as any)?.value as string | undefined;

    // Estimate: 1 byte ≈ 1 ms of compressed audio (rough). Reserve 10s
    // minimum, we'll reconcile to actual in `logUsage` below.
    const estimatedSeconds = Math.max(10, Math.round(buf.length / 16000));

    const gate = await checkQuota(userId, plan, 'transcribe', estimatedSeconds);
    if (!gate.ok) return reply.code(402).send(gate);

    try {
      const r = await transcribe({ audio: buf, mimeType, language });
      await logUsage({
        userId, kind: 'transcribe', provider: 'groq',
        audioSeconds: r.durationSec, upstreamMs: r.upstreamMs,
      });
      return { text: r.text, language: r.language, durationSec: r.durationSec };
    } catch (err: any) {
      req.log.error({ err }, 'transcribe upstream error');
      await logUsage({
        userId, kind: 'transcribe', provider: 'groq',
        audioSeconds: 0, status: 502, errorCode: String(err?.message || err).slice(0, 200),
      });
      return reply.code(502).send({ error: 'upstream_failed', message: String(err?.message || err) });
    }
  });

  // ─── POST /api/v1/translate ───────────────────────────────────────
  const TranslateBody = Type.Object({
    text: Type.String({ minLength: 1, maxLength: 20_000 }),
    targetLang: Type.String({ minLength: 2, maxLength: 10 }),
    sourceLang: Type.Optional(Type.String({ minLength: 2, maxLength: 10 })),
  });

  server.post('/translate', { schema: { body: TranslateBody } }, async (req, reply) => {
    const { userId, plan } = req.auth!;
    const body = req.body as typeof TranslateBody.static;

    const gate = await checkQuota(userId, plan, 'translate', 1);
    if (!gate.ok) return reply.code(429).send(gate);

    try {
      const r = await translate(body);
      await logUsage({
        userId, kind: 'translate', provider: 'groq',
        chars: body.text.length, upstreamMs: r.upstreamMs,
      });
      return { text: r.text };
    } catch (err: any) {
      req.log.error({ err }, 'translate upstream error');
      return reply.code(502).send({ error: 'upstream_failed', message: String(err?.message || err) });
    }
  });

  // ─── POST /api/v1/speak ───────────────────────────────────────────
  const SpeakBody = Type.Object({
    text: Type.String({ minLength: 1, maxLength: 8_000 }),
    voiceId: Type.String({ minLength: 1 }),
    language: Type.Optional(Type.String()),
    provider: Type.Optional(Type.Union([
      Type.Literal('cartesia'),
      Type.Literal('elevenlabs'),
      Type.Literal('openai'),
    ])),
  });

  server.post('/speak', { schema: { body: SpeakBody } }, async (req, reply) => {
    const { userId, plan } = req.auth!;
    const body = req.body as typeof SpeakBody.static;

    // Reserve enough for the estimated spoken duration up front.
    const estimatedSeconds = Math.max(3, Math.round(body.text.length * 0.06));
    const gate = await checkQuota(userId, plan, 'speak', estimatedSeconds);
    if (!gate.ok) return reply.code(402).send(gate);

    reply.header('content-type', 'audio/mpeg');
    reply.header('cache-control', 'no-store');

    const iter = speakStream(body);
    try {
      let durationSec = 0;
      let upstreamMs = 0;
      let result: IteratorResult<Uint8Array, { upstreamMs: number; durationSec: number }>;
      while (!(result = await iter.next()).done) {
        reply.raw.write(result.value);
      }
      durationSec = result.value.durationSec;
      upstreamMs  = result.value.upstreamMs;
      reply.raw.end();
      await logUsage({
        userId, kind: 'speak', provider: body.provider || 'cartesia',
        audioSeconds: durationSec, chars: body.text.length, upstreamMs,
      });
      return reply;
    } catch (err: any) {
      req.log.error({ err }, 'speak upstream error');
      if (!reply.sent) {
        return reply.code(502).send({ error: 'upstream_failed', message: String(err?.message || err) });
      }
      reply.raw.end();
    }
  });
}

# VoiceInk Backend

Fastify + Postgres + Stripe + Clerk. Brokers Groq / Cartesia / ElevenLabs / OpenAI for paid users; enforces per-plan quotas.

## Setup (local dev)

```bash
cd server
cp .env.example .env               # fill in your dev values
npm install
docker run -d --name voiceink-pg -e POSTGRES_PASSWORD=dev -p 5432:5432 postgres:16
psql postgres://postgres:dev@localhost:5432/postgres -c "CREATE DATABASE voiceink;"
psql $DATABASE_URL < src/db/schema.sql
npm run dev
```

The server runs on `http://localhost:8787`. With `CLERK_JWKS_URL` unset, any
request carrying `X-Dev-User: <someId>` is treated as authenticated (dev
bypass, blocked in production). Hit `GET /api/v1/me`:

```bash
curl -s -H "X-Dev-User: dev-user-1" http://localhost:8787/api/v1/me | jq
```

## Routes

| Method | Path                        | Auth | Notes |
|--------|-----------------------------|------|-------|
| GET    | `/health`                   | no   | liveness probe |
| GET    | `/api/v1/me`                | yes  | user + plan + quotas |
| GET    | `/api/v1/me/usage`          | yes  | current-month counters |
| POST   | `/api/v1/transcribe`        | yes  | multipart audio → text |
| POST   | `/api/v1/translate`         | yes  | JSON text → translated text |
| POST   | `/api/v1/speak`             | yes  | JSON text → `audio/mpeg` stream |
| POST   | `/billing/checkout-session` | yes  | creates Stripe Checkout URL |
| POST   | `/billing/portal-session`   | yes  | creates Stripe Billing Portal URL |
| POST   | `/billing/webhook`          | sig  | Stripe-signed webhook ingest |

## Quotas

Enforced in `src/quota.ts`. Monthly caps (transcribe / interpret / speak)
gate Free vs Pro vs Team; translate has an orthogonal daily cap for
abuse prevention. See `src/billing/plans.ts` for the concrete numbers
(easy to tweak without touching handler code).

## Deploy (Fly.io)

```bash
fly launch --no-deploy
fly secrets set \
  DATABASE_URL=postgres://... \
  CLERK_JWKS_URL=https://...well-known/jwks.json \
  CLERK_ISSUER=https://...clerk.accounts.dev \
  STRIPE_SECRET_KEY=sk_live_... \
  STRIPE_WEBHOOK_SECRET=whsec_... \
  STRIPE_PRICE_PRO_MONTHLY=price_... \
  STRIPE_PRICE_PRO_YEARLY=price_... \
  STRIPE_PRICE_TEAM_MONTHLY=price_... \
  GROQ_API_KEY=gsk_... \
  CARTESIA_API_KEY=sk_car_... \
  ELEVENLABS_API_KEY=el_... \
  OPENAI_API_KEY=sk-...
fly deploy
```

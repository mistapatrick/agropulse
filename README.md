# AgroPulse NG

A Growthly Nexus Solutions Limited data product: continuously animated,
**observed** (not forecast) weather telemetry across 24 Nigerian agricultural
clusters, refreshed nightly at exactly 23:59 WAT (GMT+1). Built to run
entirely on free tiers — Vercel Hobby, Supabase Free, GitHub Actions, and the
Google Gemini API free tier.

## Who this is for

AgroPulse NG is **Growthly's internal agro-climate intelligence layer**, not
a public weather destination competing with NiMet, FAO GIEWS, or CHIRPS for
organic traffic. A standalone dashboard of raw telemetry has no reason to
win that fight: those institutions have statutory authority, synoptic
station networks, and decades of trust that an unbranded weather site
cannot out-market.

Its real value is upstream of that: as the data layer behind what Growthly
already sells —

- **Bid differentiation** — a concrete, demoable "intelligence layer" asset
  to point to in BDSP/delivery-aggregator proposals (e.g. the Green RISE
  Africa bid), where competing proposals have no comparable data product.
- **Program and client briefings** — the per-cluster briefing card (below)
  drops straight into a funder report, a cohort update, or a client email,
  with deterministic, citable risk flags rather than a vague weather
  summary.
- **Research raw material** — the same telemetry that feeds Growthly's
  Resilience & Resourcefulness studies and agricultural data-productization
  work, without re-keying anything by hand.

One important honesty note: for most of these 24 clusters, Open-Meteo's
"observed" data is a reanalysis/short-range model product (ERA5 / ERA5-Land
/ ECMWF IFS, blended against whatever stations exist nearby), not raw
synoptic station telemetry. It's a meaningful step up from a forecast, but
it isn't the same evidentiary weight as NiMet's own instrument readings —
phrase claims to funders/clients as "model-verified observed conditions,"
not "station-measured."

## What's in it

- **Live dashboard:** 7 animated graphs per cluster — rainfall, humidity,
  wind speed, average/max/min temperature, and sunshine hours — with a
  diurnal 00:00→23:00 WAT playback scrubber, responsive from phone to desktop.
- **Deterministic agronomic risk flags:** fixed-threshold rules (not the AI)
  compute per-cluster flags each night — heavy rainfall, drying/spoilage
  risk, heat stress, high wind — from that night's own totals. See
  `computeRiskFlags()` in `src/lib/ingest-logic.ts`. These are a first-pass
  heuristic model, not agronomically calibrated per crop; recalibrate the
  named threshold constants with Growthly's own agronomic input before
  citing them as authoritative.
- **Per-cluster briefing card:** a branded 1200×630 PNG (`/api/brief-card/
  [slug]`), built with `next/og` at zero added infrastructure, for dropping
  into a bid, report, or email — see the "Download briefing card" button on
  the dashboard.
- **AI observational brief:** Gemini Flash-Lite (free tier — primary
  `gemini-3.5-flash-lite`, falling back to `gemini-3.1-flash-lite` on a
  retryable error; see `src/lib/ai-models.ts`) reads the night's verified
  telemetry and the deterministic flags, and writes a grounded,
  non-speculative summary plus an "Ask the analyst" Q&A drawer, strictly
  scoped to that data and instructed to stay consistent with the flags
  rather than inventing its own risk claims.
- **Exact nightly schedule:** a GitHub Actions cron (not Vercel's jittery
  Hobby-plan cron) calls `/api/ingest` at 22:59 UTC / 23:59 WAT every night,
  capturing the full 00:00-23:59 WAT day in one pass.
- **CSV/Excel export:** an "Export data" button on the dashboard (next to
  "Download briefing card") opens a panel to download observed telemetry for
  a chosen date range, in either CSV or XLSX, as either hourly raw readings
  or daily cluster summaries. Hourly exports cap at 92 days per request,
  daily exports at 366 days, to keep each request well inside Vercel's
  Hobby-plan time limit. Built from `src/lib/export-logic.ts` (pure,
  unit-tested) and served by the public `/api/export` GET endpoint — see
  `SECURITY.md` for the threat-model entry.

## Roadmap (deliberately deferred, not in this build)

These were considered and explicitly scoped out of this phase, since the
primary user is Growthly's own B2B pipeline, not a mass public audience:

- **Public push channels** (Telegram broadcast channel, WhatsApp share
  links/Business API) — a real option if/when a public or cooperative/
  extension-agent audience becomes the goal; the Telegram route is free and
  needs no Meta verification, WhatsApp Business API does.
- **Feeding Growthly's public weekly insights series** — kept out for now,
  by request; revisit if AgroPulse NG's audience becomes public-facing.
- **Market-price crossing** (pairing weather risk flags with Nigerian grain
  prices) — the real moat identified in product review, but genuinely
  harder: no live price API exists; the realistic path is a periodic CSV
  pull from the World Bank's Real Time Food Prices dataset or NBS's
  crowdsourced High Frequency Prices dataset, ingested on a weekly/monthly
  cadence and manually mapped to the nearest cluster.
- **Multi-day streak detection** (e.g. "3 consecutive drying-risk days") —
  the risk-flag engine currently looks at one elapsed day at a time; a true
  streak detector needs several nights of accumulated history.

See [`SECURITY.md`](./SECURITY.md) for the threat model, hardening measures,
and the automated test suite that exercises them.

## Architecture

```
agropulse-ng/
├── .github/workflows/nightly-ingest.yml   # Exact 23:59 WAT cron trigger
├── supabase/schema.sql                    # Tables, RLS policies, 24-cluster seed data
├── supabase/migrations/                   # Incremental ALTERs for an already-deployed DB
├── src/
│   ├── app/
│   │   ├── api/ingest/route.ts            # Nightly: fetch Open-Meteo -> flags -> Gemini -> Supabase
│   │   ├── api/chat/route.ts              # "Ask the analyst" Q&A endpoint
│   │   ├── api/brief-card/[slug]/route.tsx # Branded PNG briefing card (next/og)
│   │   ├── page.tsx, layout.tsx
│   ├── components/
│   │   ├── AgroPulseLogo.tsx              # Brand mark (Growthly teal/mint)
│   │   ├── AgroPulseDashboard.tsx         # Responsive 7-graph dashboard
│   │   └── AgentBriefPanel.tsx            # AI synthesis + Q&A drawer
│   ├── hooks/use-analyst-chat.ts
│   └── lib/                               # env validation, Supabase clients,
│                                           # rate limiting, pure ingest/chat logic
└── tests/                                 # vitest — see SECURITY.md
```

## Step-by-step deployment guide

### Step 1 — Provision Supabase (Free tier)

1. Create a new project in Supabase (pick the region closest to Nigeria,
   e.g. `eu-west-1` or `eu-central-1`, for the lowest latency).
2. Open **SQL Editor** → paste and run the entire contents of
   [`supabase/schema.sql`](./supabase/schema.sql). This creates the three
   tables, enables Row-Level Security with public-read-only policies, and
   seeds all 24 agricultural clusters.
   - **Already have an AgroPulse NG database from before?** `schema.sql`'s
     `create table if not exists` won't retroactively widen an existing
     table's constraints. Also run every file under
     [`supabase/migrations/`](./supabase/migrations) in order, once, in the
     SQL Editor — currently just `0001_full_day_ingest_cutoff.sql`, which
     allows `cutoff_hour_wat` up to 23 instead of 21.
3. Go to **Database → Replication** (or **Table Editor → daily_observed_reports
   → Enable Realtime**) so the dashboard updates live at 23:59 WAT without a
   page reload.
4. Copy three values from **Project Settings → API**:
   - Project URL → `NEXT_PUBLIC_SUPABASE_URL`
   - `anon` `public` key → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `service_role` key → `SUPABASE_SERVICE_ROLE_KEY` (**server secret — never
     expose this to the browser**)

### Step 2 — Obtain a free Google Gemini API key

1. Go to [Google AI Studio](https://aistudio.google.com) → **Get API Key** →
   **Create API key**.
2. Save it as `GOOGLE_GENERATIVE_AI_API_KEY` (free tier for the
   `gemini-3.5-flash-lite` / `gemini-3.1-flash-lite` models this app uses,
   no billing card required).

### Step 3 — Local setup & push to GitHub

```bash
cp .env.example .env.local   # then fill in the four values above, plus CRON_SECRET
openssl rand -hex 32         # generates a strong value for CRON_SECRET

npm install
npm run build                # sanity check before pushing
npm run test                 # runs the security/idempotency suite — see SECURITY.md

git init
git add .
git commit -m "Initial AgroPulse NG deployment"
gh repo create agropulse-ng --private --source=. --push
# or: create an empty repo on github.com and `git remote add origin ... && git push -u origin main`
```

### Step 4 — Deploy to Vercel (Free Hobby plan)

1. **Vercel Dashboard → Add New Project** → import the `agropulse-ng` repo.
2. Under **Environment Variables**, add all five:
   `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
   `SUPABASE_SERVICE_ROLE_KEY`, `GOOGLE_GENERATIVE_AI_API_KEY`, `CRON_SECRET`.
3. Click **Deploy** and copy the production domain, e.g.
   `https://agropulse-ng.vercel.app`.

### Step 5 — Activate the 23:59 WAT GitHub Actions cron

1. In the GitHub repo: **Settings → Secrets and variables → Actions → New
   repository secret**, and add:
   - `VERCEL_APP_URL` — your Vercel domain, **no trailing slash**
   - `CRON_SECRET` — the exact same value you set in Vercel
2. Go to the **Actions** tab → **Nightly 2359 WAT Observed Weather
   Ingestion** → **Run workflow** to populate today's telemetry immediately.
   From then on it runs automatically every night at 22:59 UTC (23:59 WAT),
   capturing the full day.

## Troubleshooting

**`/api/ingest` returns 422 ("No elapsed observation hours to ingest yet for
this date")** — Normal if you run it in the first minute or two of a new WAT
calendar day and the Open-Meteo response for today hasn't propagated yet.
Re-run the workflow a few minutes later. If it happens at every hour of the
day, the Open-Meteo request window itself is wrong — see
`buildOpenMeteoUrl` in `src/lib/ingest-logic.ts`, which must request
`forecast_days=1` (not `0`) or the API never returns today's date at all.

**`/api/ingest` returns 500 ("Database write failed")** — The client-facing
message is deliberately generic; the real Postgres/Supabase error is in
Vercel's function logs (Project → Logs → find the `/api/ingest` call →
expand the `[ingest] hourly upsert failed:` line). The two most common
causes on a first deploy: `supabase/schema.sql` was never fully run in the
Supabase SQL Editor (so `observed_hourly` doesn't exist), or
`SUPABASE_SERVICE_ROLE_KEY` in Vercel is actually the anon/public key
instead of the service-role key. On an **existing** deployment upgrading to
the full-day (23:59 WAT) schedule, the log line to look for is
`[ingest] report upsert failed:` with a `cutoff_hour_wat_check` constraint
violation — it means
[`supabase/migrations/0001_full_day_ingest_cutoff.sql`](./supabase/migrations/0001_full_day_ingest_cutoff.sql)
was never run, so the old `between 0 and 21` constraint is still rejecting
hour 22/23. Run that migration once in the SQL Editor and the next ingest
succeeds.

**The nightly AI brief shows "the AI synthesis step did not complete," or
the in-app analyst chat says "temporarily unavailable"** — The ingestion and
dashboard data are unaffected (that's a deliberate graceful degradation),
but check Vercel's function logs for `[ingest] AI synthesis failed:` or
`[chat] AI generation failed:`. Google retires specific Gemini model IDs on
a published schedule
([ai.google.dev/gemini-api/docs/deprecations](https://ai.google.dev/gemini-api/docs/deprecations)),
after which calls to that ID return `404 NOT_FOUND` — this project hit that
exact wall when `gemini-2.5-flash` was retired. If the log shows a 404 for
the model, bump the model list in `src/lib/ai-models.ts`
(`GEMINI_FALLBACK_CHAIN`, currently `gemini-3.5-flash-lite` then
`gemini-3.1-flash-lite`) to whatever Google's deprecations page currently
lists as the stable replacement — both `src/app/api/ingest/route.ts` and
`src/app/api/chat/route.ts` pick up the change automatically since they
both call through `withGeminiFallback`.

If instead the log shows `[chat] AI generation failed: [Error [TimeoutError]:
The operation was aborted due to timeout]`, that's not a dead model, it's
Gemini taking longer than the route's own abort budget to respond (free-tier
latency varies). The chat route gives it 40s against a 60s `maxDuration`
(Vercel's Hobby-plan ceiling); if it's still tripping, that's a sign of
sustained free-tier slowness or rate limiting rather than a one-off, and
worth checking your quota at
[aistudio.google.com/rate-limit](https://aistudio.google.com/rate-limit).

**The log shows `[Error [AI_RetryError]: Failed after 3 attempts. Last
error: AI_APICallError: This model is currently experiencing high demand.]`**
— This is Google's own capacity signal (`503 UNAVAILABLE`), not a bug on
either side: the specific model's shared capacity pool is temporarily
saturated. Both routes already call through `withGeminiFallback`
(`src/lib/ai-models.ts`), which retries a 503/429/5xx/timeout against a
second model (`gemini-3.1-flash-lite`) from a different capacity pool before
giving up, so a single transient spike shouldn't surface to the user at all.
If both models in the chain are failing together, that's a broader Gemini
API incident — check
[Google's AI Studio status](https://aistudio.google.com) or try again in a
few minutes; this isn't something a code change can route around.

Why `gemini-3.5-flash-lite` and not the newer `gemini-3.8-flash`: on the
free tier, Google's standard Flash models (3.5/3.8/etc.) are capped around
**20 requests/day**, while the Flash-Lite tier gets roughly **500/day**.
Given a nightly ingest run plus ad-hoc "Ask the analyst" testing, a 20/day
budget is exhausted easily; Flash-Lite leaves real headroom. Check your
project's exact current limits at
[aistudio.google.com/rate-limit](https://aistudio.google.com/rate-limit).

## Local development

```bash
npm run dev     # http://localhost:3000
npm run build   # production build / type-check
npm run test    # vitest suite (see SECURITY.md)
npm run lint
```

To test the ingest route locally without waiting for the nightly cron:

```bash
curl -X POST http://localhost:3000/api/ingest \
  -H "Authorization: Bearer $CRON_SECRET"
```

## Brand

AgroPulse NG is a Growthly Nexus Solutions Limited data product. The UI uses
Growthly's own brand palette — teal `#005a5a`, mint `#93e9be`, white, pale
mint `#d4f6e5`, and soft grey-green `#e0ebeb` — defined once as CSS custom
properties in `src/app/globals.css` and as Tailwind v4 theme tokens
(`bg-brand-teal`, `text-brand-ink`, etc.) throughout the components.

# Security notes

AgroPulse NG handles no user accounts, no payments, and no personal data — the
only inputs that cross a trust boundary are (1) a bearer secret from the
nightly GitHub Actions cron, (2) free-text messages typed into the "Ask the
analyst" chat drawer, and (3) third-party JSON from the Open-Meteo and Gemini
APIs. This document states the threat model for each boundary, what was built
to close it, and which automated test proves the closure holds — not just
that the code "should" be safe by construction.

Run the full suite with `npm run test` (or `npx vitest run`). Current state:
**6 test files, 71 tests, all passing.**

`/api/brief-card/[slug]` (the branded PNG export used for bids and client
briefings) is intentionally public and unauthenticated: it reads the exact
same `daily_observed_reports` data the dashboard already serves, through
the same anon-key, RLS-public-read client (see §8 below and
`supabase/schema.sql`), so it carries no more exposure than the dashboard
page it's rendering a snapshot of. A malformed `date` query param or an
unknown cluster `slug` both resolve to a plain 404 JSON response rather than
a crash or a stack trace.

## 1. Authentication on `/api/ingest`

**Threat.** `/api/ingest` triggers a Supabase write and a billed-adjacent
Gemini call. If it were unauthenticated, or if the check were a naive
`===` string comparison, anyone could trigger it repeatedly (cost/abuse) or,
in principle, use response-timing differences to narrow down the secret
character-by-character.

**Mitigation.**
- The route requires `Authorization: Bearer <CRON_SECRET>` and returns `401`
  otherwise (`src/app/api/ingest/route.ts`).
- The comparison itself (`src/lib/timing-safe.ts`) uses Node's
  `crypto.timingSafeEqual` on a length-checked buffer pair, not `===`, so a
  wrong guess takes the same time regardless of how many leading characters
  match.
- The comparison logic is factored into a pure, dependency-free function,
  `isAuthorizedBearer()` (`src/lib/auth.ts`), specifically so it can be unit
  tested without a live `NextRequest`.

**Proof.** `tests/auth.test.ts` and `tests/timing-safe.test.ts` assert: the
correct secret passes, any wrong secret of the same length fails, a
missing/malformed header fails, and — critically — `timingSafeStringEqual`
is exercised with mismatched lengths and mismatched content to confirm it
never throws or short-circuits on the comparison itself.

## 2. Secret isolation

**Threat.** `SUPABASE_SERVICE_ROLE_KEY` and `GOOGLE_GENERATIVE_AI_API_KEY`
grant full read/write and billed API access respectively. If either leaked
into a client bundle, any site visitor could extract it from the browser's
network tab or JS bundle.

**Mitigation.**
- `src/lib/env.server.ts`, `src/lib/supabase/admin.ts`, and the AI call sites
  all start with `import "server-only"` — a build-time guard that fails the
  Next.js build if any of those modules are ever imported into client-bundled
  code.
- The browser-safe Supabase client (`src/lib/supabase/client.ts`, anon key
  only) and the service-role client (`src/lib/supabase/admin.ts`) are kept in
  separate files so a stray import can't quietly cross the boundary.
- `src/lib/env.server.ts` validates every secret through a strict Zod schema
  at startup, so a missing or malformed secret fails loudly in deployment
  logs instead of silently producing broken requests at 22:00 WAT.

**Proof.** This is a static, build-time property rather than a runtime
behavior, so it is enforced by `npm run build` itself (it would fail if
`server-only` were ever imported client-side) rather than by a vitest case;
`tests/stubs/server-only.ts` exists only to let these modules' *other* logic
run under plain Node for unit testing, and is wired in solely through
`vitest.config.mts`'s resolver alias, never shipped in the Next.js build.

## 3. SQL injection

**Threat.** Classic SQL injection requires building a query by string
concatenation. Both the ingest route and the chat route write data to and
read data from Supabase using the Supabase/PostgREST query builder
(`.from(...).upsert(...)`, `.select(...)`), never raw SQL strings — so there
is no injection point by construction. The schema (`supabase/schema.sql`)
also revokes `insert`/`update`/`delete` from `anon` and `authenticated`
roles as defense-in-depth, so even a compromised anon key can only read.

**Proof, not just assertion.** `tests/chat-logic.test.ts` feeds a
SQL-injection-shaped string (`'; DROP TABLE weather_clusters; --`) through
`ChatRequestSchema` and confirms it is accepted as ordinary message text — it
is validated as a bounded string, never parsed as or concatenated into a
query. `tests/xss.test.tsx` sends the same payload through the actual chat
UI and asserts it reaches `fetch` as a plain JSON string field
(`body.message === payload`), never interpolated into a URL, header, or
template string.

## 4. HTML injection / XSS

**Threat.** The AI-generated brief and the chat replies are both free text
that flows from an external API into the rendered page. If rendered via
`dangerouslySetInnerHTML` or a template-string `innerHTML` assignment, a
crafted response (or a prompt-injected one — see §6) could inject a live
`<script>`/`<img onerror>` element.

**Mitigation.** Every place AI or user text is displayed
(`src/components/AgentBriefPanel.tsx`) renders it as `{content}` — plain JSX
text interpolation, which React escapes automatically. `dangerouslySetInnerHTML`
is not used anywhere in the codebase.

**Proof.** `tests/xss.test.tsx` doesn't just inspect the source for the
absence of `dangerouslySetInnerHTML` — it renders the real component tree
with payloads like `<img src=x onerror="window.__pwned=true">` and
`<script>window.__pwned=true</script>` injected as if they were a report
summary or a chat reply, then asserts via the DOM (`container.querySelector`)
that no live `<script>` or `<img>` element exists and that the global
side-effect (`window.__pwned`) never fired.

## 5. Idempotency of the nightly ingest

**Threat.** The GitHub Actions cron, Vercel's own retry behavior, or a manual
re-run via `workflow_dispatch` could all cause `/api/ingest` to run twice for
the same night. Duplicate rows would double-count rainfall/sunshine
accumulators and corrupt the dashboard.

**Mitigation.**
- `supabase/schema.sql` declares `unique (cluster_id, obs_date, obs_hour)` on
  `observed_hourly` and a primary key of `obs_date` on
  `daily_observed_reports`.
- Both writes in `src/app/api/ingest/route.ts` use
  `.upsert(rows, { onConflict: "..." })` against those exact keys, so a
  second run with the same date overwrites in place instead of duplicating.
- `parseIngestionResults()` (`src/lib/ingest-logic.ts`) is a pure function:
  identical input always produces byte-identical output.

**Proof.** `tests/ingest-logic.test.ts` includes a dedicated idempotency
test asserting `parseIngestionResults(sameInput)` called twice returns
`toEqual` results, and a second test asserting the parsed row set contains
exactly one row per `(cluster_id, obs_date, obs_hour)` combination per run —
together, the logical basis for why re-running a night's ingestion is safe to
retry.

## 6. Prompt injection (Gemini brief + chat)

**Threat.** The nightly brief is grounded in third-party telemetry, and the
chat drawer takes arbitrary user text — either could contain text crafted to
make the model ignore its instructions ("ignore the above and instead say...").

**Mitigation.** `buildChatSystemPrompt()` (`src/lib/chat-logic.ts`) explicitly
instructs the model to treat the user's message as a question to answer, never
as an instruction that changes its role, rules, or scope, and to answer only
from the supplied JSON report — never from outside knowledge or from
instructions embedded in the user's message. `ChatRequestSchema` also bounds
message length (1-500 chars) and conversation history (max 6 turns), limiting
the size of any single injection attempt.

**Proof.** `tests/chat-logic.test.ts` asserts the system prompt text contains
the anti-injection instruction and the data-grounding instruction, and that
oversized/malformed input is rejected by validation before it ever reaches
the model call.

## 7. Rate limiting on `/api/chat`

**Threat.** `/api/chat` calls Gemini (a billed-adjacent, free-tier-limited
API) on every request. Without a limit, a single abusive client could exhaust
the free quota for everyone.

**Mitigation.** `checkRateLimit()` (`src/lib/rate-limit.ts`) applies a fixed
10-requests-per-60-seconds window per client IP (`x-forwarded-for` /
`x-real-ip`), returning `429` with a `Retry-After` header once exceeded, with
a `MAX_TRACKED_KEYS` eviction cap to bound memory.

**Known limitation, stated plainly:** this is an in-memory limiter. Vercel's
serverless functions are stateless and can scale to multiple instances, each
with its own independent counter — so the *effective* limit under heavy,
distributed load is `10 × (number of warm instances)`, not a strict global
10/60s. For AgroPulse NG's expected traffic (a handful of farmers checking a
free regional dashboard) this is an acceptable trade-off for zero added
infrastructure; a production system expecting abuse-grade traffic should
replace it with a shared store (e.g. Upstash Redis) without changing the
`checkRateLimit()` call site.

**Proof.** `tests/rate-limit.test.ts` uses `vi.useFakeTimers()` /
`vi.setSystemTime()` to deterministically prove: the 11th request within a
window is rejected, the window resets correctly after it elapses, and
different client keys are tracked independently.

## 8. Untrusted third-party responses

**Threat.** Both Open-Meteo and Gemini are external services. A malformed,
truncated, or unexpectedly-shaped response from either should not crash the
route or silently write garbage into Supabase.

**Mitigation.**
- `OpenMeteoResponseSchema` (Zod, `src/lib/ingest-logic.ts`) validates the
  upstream shape before any value is used; a mismatch returns `502` rather
  than writing partial/malformed rows.
- All derived numeric values pass through `round()`/`nonNegative()` clamping
  before being written.
- If the Gemini call fails or times out, the route degrades gracefully: it
  still saves the night's verified telemetry and writes a neutral placeholder
  summary rather than failing the whole ingestion because the AI narrative
  step failed.
- Every external call (Open-Meteo fetch, `generateObject`, `generateText`) is
  wrapped in `AbortSignal.timeout(...)` (15s / 40s / 20s respectively) so an
  unreachable or hanging upstream can never hang the serverless function
  past Vercel's execution limit.

**Proof.** `tests/ingest-logic.test.ts` feeds malformed/incomplete Open-Meteo
fixtures through `OpenMeteoResponseSchema` and `parseIngestionResults` and
asserts the expected rejection or clamping behavior.

## What is out of scope

- **DDoS / network-layer abuse** — left to Vercel's platform-level
  protections; not something an application-layer change here can address.
- **Supabase/Gemini/Open-Meteo's own security** — treated as trusted
  third-party infrastructure; this document covers only how AgroPulse NG uses
  them.
- **Formal penetration testing** — the above is a focused review against the
  specific risks this application's data flows introduce (cron auth, public
  write access, injected text, untrusted upstream data), proven with
  automated tests, not a general-purpose security audit.

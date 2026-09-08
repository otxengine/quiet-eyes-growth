# Google Business Profile Integration Audit

Scope: readiness of this codebase to connect customers' own Google Business Profiles via OAuth (`business.manage` scope) as a multi-tenant SaaS, with no sandbox — every write hits production data on a real customer's live listing.

Severity is blunt on purpose. Findings below are marked as fixed only where the code has actually changed since — see the update notes.

---

## Update — B1–B5 fixed, plus the matching hole in campaigns.ts

All 5 blockers are now fixed in code. Each `Bx` heading below is marked `[FIXED]` with a short note on what changed and file:line. Two things still need a human, not more code:

1. **Run the backfill script once against production**: `npx ts-node src/scripts/encryptGoogleTokens.ts` (new file) encrypts any `SocialAccount.refresh_token`/`.access_token` and `BusinessProfile.google_access_token` rows still in plaintext from before this fix. Safe to re-run — it skips anything already encrypted.
2. **Confirm/set a real `META_ENCRYPTION_KEY` value in the Render dashboard** for the backend service. It's now declared in `render.yaml` (`sync: false`) and validated at boot (`server/src/index.ts`, right after the existing production env-var guard) — the server now refuses to start in production without a correctly-formatted 64-char hex key, and warns loudly in dev. This directly resolves open question 1 from below by making the missing-key state impossible to silently run in production.

Also fixed as a byproduct of tracing B2: two pre-existing bugs not in the original audit — `fetchSocialInsights.ts` and `campaigns.ts` (`publish-google-ads`, `sync-stats`) were reading `SocialAccount.access_token` **raw** (never decrypted) even though it's been written encrypted since day one. If `META_ENCRYPTION_KEY` was actually set in production, both pipelines were likely already silently broken (ciphertext sent as a Bearer token → 401 → swallowed). Both are now fixed alongside the rest of B2.

**Not in scope for this pass** — still open, unchanged from the original audit: the Gaps tier (tests, `validateOnly`, backoff, alerting, logging consistency, multi-location UI) and the open questions below (still worth answering, especially #2/#3/#5 which gate the actual Google Cloud Console verification submission — none of that is code-fixable from this repo).

---

## Update — own-business-info sync added after this audit

Since this audit, three files were added/changed to pull the tenant's own address/phone/category/website/description from GBP's Business Information API instead of manual entry/Places (`server/src/lib/googleBusinessInfo.ts`, `server/src/routes/functions/collectOwnBusinessInfo.ts`, plus small changes to `collectReviews.ts` and `onboarding.ts`). This did not touch any blocker, but it shifts a few items below:

- **None of B1–B5 are affected.** No auth, encryption, revocation, or privacy-policy code was touched. B5 (privacy policy silent on Google) is worth re-reading with slightly higher stakes now: the app reads one more category of Google user data (business profile fields, not just reviews/metrics/replies), which needs the same disclosure.
- **The new code is correctly gated** — it's registered in `FUNCTION_MAP` and dispatched only via `POST /api/functions/:name`, which *is* `requireBusinessAccess`-protected (unlike the B1 routes). It doesn't reproduce the B1 hole.
- **Quota Risk (line 50) compounds slightly**: the new sync adds +1 GBP request per connected location per day, in the same 05:30 scheduler batch as `collectReviews`/`CollectOwnSocialProfile`. It doesn't change *where* the 300 QPM line is breached, but it adds to the volume in that window — factor it in when acting on item #12.
- **The "ciphertext fallback on refresh failure" Risk (line 54) now has a second call site**: the new `getOwnLocationInfo()` also calls `getValidGoogleToken()`, so it inherits the same bug — a merely-slow-to-refresh token gets treated as a hard failure (mapped to `is_connected: false`) via this path too, not just `GoogleBusinessClient.ts`/`postReviewReply`. Slightly raises the value of fixing item #14.
- **`X-GOOG-API-FORMAT-VERSION: 2` (Gap, line 68) is now set in the new code** (`googleBusinessInfo.ts`) but still missing on the two pre-existing call sites (`GoogleBusinessClient.ts`, `collectReviews.ts`) — item #10 is now a partial retrofit rather than a from-scratch add.
- **Logging inconsistency (Gap, line 70) was extended, not fixed**: the new code's error path uses `console.warn`, matching `collectReviews.ts`'s existing (already-flagged) pattern rather than the structured `logger`. Worth folding into item #16 rather than treating as separate.
- **"What's already fine" (line 79) still holds and now covers more surface**: the new code only ever reads the tenant's *own* GBP-connected location (same `SocialAccount` ownership gate as the existing call sites), so the "GBP is only ever used for owned profiles" finding remains true.

No new blockers, no new architectural violations. Suggested order of work (line 116 onward) is unchanged.

---

## Blockers

Things that will break in production or fail Google's review, right now.

### B1. [FIXED] Two routes have no authentication or ownership check at all — this is exploitable today, independent of GBP
- `GET /api/oauth/initiate/:platform?businessId=X` — `server/src/routes/oauth.ts:129-212`
- `POST /api/oauth/disconnect` — `server/src/routes/oauth.ts:733-770`
- `POST /api/social/reviews/:id/reply` — `server/src/routes/social.ts:745-768`, writing through `server/src/services/execution/GoogleBusinessClient.ts:51-57,68-78`

None of these routes call `requireAuth`/`requireBusinessAccess` (the one ownership-check middleware in this codebase, defined in `server/src/middleware/businessAccess.ts`, and wired up *only* on `POST /api/functions/:name`). `businessId`/`businessProfileId` is taken straight from the query string or request body with zero verification that the caller owns that tenant.

Concrete exploits, both confirmed by tracing the code:
- **OAuth hijack**: an attacker who knows or guesses a victim's `businessId` completes Google consent with *their own* Google account against `/api/oauth/initiate/:platform?businessId=<victim>`. `handleGoogleCallback` (`oauth.ts:389-471`) writes the attacker's token as the victim's `google_business` connection — the attacker now controls what the victim's app does against Google under the victim's stored connection, and `POST /api/oauth/disconnect` lets anyone silently sever any tenant's integration.
- **Cross-tenant published review reply**: `social.ts:745-768` reads `businessProfileId`/`reviewId`/`replyText` from the request body, looks the review up by bare ID with no `linked_business` filter (`social.ts:752`), and calls `postReviewReply` directly — no approval-record check, no verification the review belongs to that business. `GoogleBusinessClient.ts:51-57` then does an unconditional `prisma.review.update({where:{id: payload.reviewId}}...)` with no ownership filter. Any caller who knows (or can enumerate) a `businessProfileId` + `reviewId` pair can publish arbitrary text as another business's official public reply on their live Google listing, or corrupt another tenant's review data.

Blast radius for the reply case specifically: the write is public, permanent-looking (Google review replies have no delete/undo path in this codebase — `GoogleBusinessClient.ts` only implements `PUT`, no `DELETE` against the reply endpoint exists anywhere), and nothing in the flow raises an alert when it happens.

**Fix**: add `requireBusinessAccess` (or equivalent) to all three routes, and add an explicit `review.linked_business === businessProfileId` check before any read/write in the reply path.

**Fixed**: `businessAccess.ts` now exports a `requireOwnsBusiness(extractId)` factory (the old `requireBusinessAccess` is just `requireOwnsBusiness(req => req.body?.businessProfileId)` now, unchanged behavior for `/api/functions/:name`). Applied to `GET /api/oauth/initiate/:platform` (query param), `POST /api/oauth/disconnect` (body), and `POST /api/social/reviews/:id/reply` (body) — plus an explicit `review.linked_business !== businessProfileId → 403` check in the reply handler itself, since the middleware only proves the caller owns `businessProfileId`, not that the URL's `reviewId` belongs to it. Same pattern applied to `campaigns.ts`'s `publish-google-ads`/`publish-meta-ads`/`sync-stats` (the matching Risk below).

### B2. [FIXED] Refresh tokens and the mirrored Google access token are stored in plaintext
- `SocialAccount.refresh_token` written raw, no encryption call, at `server/src/routes/oauth.ts:452` (update), `:460` (insert), and again for Google Ads at `:606`/`:614`. Schema: `server/prisma/schema.prisma:706-722` — no encryption note, contrast with `MetaConnection` at line 728 ("Tokens are always encrypted").
- `BusinessProfile.google_access_token` written raw with the code comment `// Mirror access token into BusinessProfile (plaintext — separate field)` — `server/src/routes/oauth.ts:464-468` and `server/src/lib/googleTokenRefresh.ts:63-67`. Schema comment at `schema.prisma:101` doesn't even flag it as sensitive, unlike `whatsapp_access_token` on the line above it.
- Contrast: Facebook/Instagram tokens on the same table *are* passed through `tryEncryptToken()` before the same kind of mirror write (`oauth.ts:293`, `:307`).

The refresh token is the longest-lived, highest-value credential in this system (valid until revoked or 6 months idle) and it's the one field never encrypted. This will also surface in Google's CASA/security assessment for the restricted `business.manage` scope, which expects tokens encrypted at rest.

**Fixed**: every write site (`oauth.ts` `handleGoogleCallback`/`handleGoogleAdsCallback`, `googleTokenRefresh.ts`, and the token-refresh path in `campaigns.ts`) now wraps `refresh_token` and `google_access_token` in `tryEncryptToken()`, matching the existing Facebook/Instagram pattern. Every read site that previously assumed plaintext (`collectReviews.ts`, `GoogleBusinessClient.ts`'s final fallback, `campaigns.ts`) now decrypts first. Two read sites — `fetchSocialInsights.ts` and `campaigns.ts`'s `publish-google-ads`/`sync-stats` — were found to already be reading the (already-encrypted-since-day-one) `access_token` raw, a pre-existing bug beyond this audit's original findings; fixed alongside. A one-time backfill script (`server/src/scripts/encryptGoogleTokens.ts`) encrypts any rows still in plaintext from before this fix — **still needs to be run manually against production**.

### B3. [FIXED] The encryption helper fails open to plaintext, silently
`tryEncryptToken`/`tryDecryptToken` (`server/src/lib/crypto.ts:54-62`) swallow any error and return the plaintext unchanged if `META_ENCRYPTION_KEY` is missing or malformed. That key is **not declared in `render.yaml`** at all (every other secret, including `GOOGLE_CLIENT_SECRET`, is listed there with `sync: false`; this one is absent). If it isn't actually set by hand in the Render dashboard, every token this system believes is "encrypted" — Facebook/Instagram included — is silently stored as plaintext, with no error, warning, or alert anywhere. There is no way to tell from the DB or logs which state you're in (see open question A1).

**Fixed**: `META_ENCRYPTION_KEY` is now declared in `render.yaml`. `server/src/index.ts` validates it's a well-formed 64-char hex string at boot (right next to the existing production env-var guard) — refuses to start in production if missing/malformed, warns loudly in dev. `tryEncryptToken`/`tryDecryptToken` still fall back to plaintext on error (a hard throw mid-request would 500 a customer's OAuth callback), but now `logger.error(...)` loudly every time that happens instead of the old zero-signal silent fallback. **Still needs a human**: confirm/set the actual key value in the Render dashboard — adding it to the blueprint doesn't set a value.

### B4. [FIXED] Disconnecting an integration doesn't revoke the token or delete the refresh token
`POST /api/oauth/disconnect` (`oauth.ts:733-770`) clears `access_token` but never clears `refresh_token`, and never calls Google's revoke endpoint (zero references to `oauth2.googleapis.com/revoke` anywhere in the codebase). After a customer "disconnects," a live, still-valid refresh token for their real Google Business Profile sits in the DB (in plaintext, per B2) indefinitely, inert only because current code paths happen to filter on `is_connected: true`.

**Fixed**: `/disconnect` now calls `POST https://oauth2.googleapis.com/revoke` (best-effort, logs a warning on failure but doesn't block the disconnect) for `google_business`/`google_ads` before clearing local state, and the `socialAccount.update` now clears `refresh_token: null` alongside `access_token: null` (previously only the latter).

### B5. [FIXED] Privacy policy discloses Meta data handling but never mentions Google
`src/marketing/pages/Legal.jsx:48-97` (served at `/privacy`) has a detailed "Meta Platform Data" section (`:61-68`) but zero mention of Google, Google Business Profile, or the `business.manage` scope anywhere. Google's verification for a sensitive/restricted scope requires the privacy policy, on the verified domain, to specifically disclose what Google user data is accessed, how it's used/stored/secured, and how a user can revoke access or request deletion. As written today, this fails that requirement outright. The related `/data-deletion` page (`Legal.jsx:101-109`) also only covers Facebook/Instagram deletion, not Google.

**Fixed**: added a new §3 to `Privacy()` mirroring the Meta section's structure (what's collected, encryption, purpose limitation, immediate deletion on disconnect), extended the ML-training and retention carve-out sentences to cover Google alongside Meta, and added a matching disconnect bullet to `DataDeletion()`. This is drafted legal-adjacent copy modeled closely on the existing approved section — **still worth a human read-through (or legal review) before it ships**, since Google's reviewers and your users will read it literally. Still Hebrew-only (see the separate Risk below about that).

---

## Risks

Works today, will bite at scale or on edge cases.

- **No client-side rate limiting or backoff anywhere near GBP calls.** No `rateLimit`/`throttle`/`p-limit`/backoff dependency or code exists (`GoogleBusinessClient.ts`, `collectReviews.ts`, `fetchSocialInsights.ts`). A 429/5xx today is either silently swallowed (`fetchSocialInsights.ts:134`, `if (perfRes.ok)` with no else) or treated as a hard stop with no retry (`collectReviews.ts:93-106` only special-cases 401/403). A breach currently manifests as **silent data loss** for that day's sync, not a retry. See quota estimate below for where this bites.
- **[FIXED] Same unauthenticated `businessId`-from-body pattern in the Google Ads / Meta Ads flows** (`server/src/routes/campaigns.ts:34-41,147-153,163-168,178-188,275-279`) — not GBP proper, but the identical hole lets an attacker who knows a `businessId` trigger real ad spend or credential use on another tenant's account. Fixed alongside B1 — `requireOwnsBusiness` now guards all three `campaigns.ts` routes.
- **`SocialAccount` has no unique constraint on `(linked_business, platform)`** and no DB-level foreign key from `linked_business` to `BusinessProfile` (`schema.prisma:706-722`, confirmed by the code's own comment at `oauth.ts:100` about using `findFirst` instead of a unique upsert). A race during OAuth (double callback, retried flow) can create duplicate rows for the same tenant; every read is a `findFirst` with no `orderBy`, so which token gets used is non-deterministic. Tenant isolation is 100% application-code discipline with no second layer (no RLS on this table — the existing RLS migrations cover an unrelated subsystem).
- **`invalid_grant` is never explicitly detected.** `refreshGoogleToken()` (`server/src/lib/googleTokenRefresh.ts:21-75`) treats every refresh failure the same way — log and return `null` — never distinguishing a permanently dead token from a transient error, never flipping `is_connected`, never writing `last_error`. The 30-minute scheduler (`refreshExpiringGoogleTokens`, `googleTokenRefresh.ts:104-126`) will retry a permanently dead token forever with no circuit breaker and no customer-facing signal from this path (`.catch(() => {})` at `server/src/index.ts:1431` swallows everything). A *separate* reactive path in `collectReviews.ts:93-105` does catch 401/403 and set `is_connected: false` with `last_error` — but that field is never read anywhere in the frontend (0 matches in `src/`), so even when it's captured, the customer never sees why.
- **The "use last known token" fallback on refresh failure is dead code that returns ciphertext, not plaintext.** `GoogleBusinessClient.ts:46` (`freshToken || gmbAccount?.access_token || ...`) and `googleTokenRefresh.ts:94` both fall back to the raw encrypted-at-rest column without decrypting it, so the fallback token sent to Google is garbage and guarantees an auth failure. Not a leakage risk, but the intended graceful degradation silently never works.
- **`GET /v1/{account}/locations` only ever fetches `pageSize=1`** (`oauth.ts:420,428`) — a tenant managing multiple GBP locations under one Google account gets an arbitrary first location wired up with no selection step, silently.
- **Shared `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` across the `google_business` and `google_ads` OAuth flows** (`oauth.ts:397` vs `:552`). If this is one Google Cloud OAuth client, the restricted `business.manage` scope and the Ads scope get bundled into the same verification/security-assessment surface, and a user connecting only GBP sees the Ads permission on the consent screen too. Can't confirm from the repo whether it's one client or two.
- **Privacy policy is Hebrew-only** (`index.html:2`, `lang="he" dir="rtl"`), no English version — commonly a friction point with Google's (English-speaking) reviewers, even if not an automatic rejection.
- **Plaintext `google_access_token` on `BusinessProfile` is a latent leakage surface**: if any generic entity/CRUD route returns a `BusinessProfile` row wholesale to the frontend without field exclusion, it would serialize a live access token straight into an API response. Not confirmed either way — needs a direct check of the entity router.

---

## Gaps

Expected safeguards that are simply absent.

- **No test anywhere constructs two tenants and asserts cross-tenant access is denied** for any GBP-touching endpoint. Existing tests (`functionsAccessControl.test.ts`, `oauth.test.ts`, `googleBusinessClient.test.ts`) test middleware/DB-write scoping in isolation with mocks, not the actual HTTP routes end-to-end, and none constructs an IDOR scenario.
- **`validateOnly` is never used anywhere in the codebase.** The one GBP write that exists today (review reply, `GoogleBusinessClient.ts:68-78`) has never been safely dry-run tested, and there's no sandbox to fall back on.
- **`X-GOOG-API-FORMAT-VERSION: 2` is never set** on any GBP request (`GoogleBusinessClient.ts:72-75`, `collectReviews.ts:92`) — Google's v4 error bodies are far less detailed without it, which directly hurts debugging the exact failure modes (`invalid_grant`, `403`, quota) this audit is about.
- **No exponential backoff with jitter on 429/5xx anywhere.**
- **Inconsistent structured logging on GBP error paths.** A real structured logger exists (`server/src/infra/logger.ts`, JSON output with `data` fields) and is used well in some places (`GoogleBusinessClient.ts:85`), but `collectReviews.ts` falls back to raw `console.warn`/`console.error` in several spots (`:96,165,201,261,575`), and some `logger` calls put the tenant ID inside an interpolated string rather than the structured `data` object (`googleTokenRefresh.ts:48,72`), making it unfilterable at scale.
- **No alerting specific to `invalid_grant` or `403 PERMISSION_DENIED`.** The only alerting mechanism in the repo is a generic, daily, aggregate per-automation error-rate email (`server/src/lib/collectorMetrics.ts:91-125`) gated on an `OPS_ALERT_EMAIL` env var that no-ops silently if unset — and the token-refresh job (where `invalid_grant` would actually surface) doesn't even feed into that signal.
- **No scope constant.** The `business.manage` scope string is defined in exactly one place today (`oauth.ts:176`, good — no drift risk currently), but it's an inline literal, not an exported constant, so nothing enforces that stays true as the file grows.
- Verifications, Place Actions, Notifications, and Lodging APIs are entirely unbuilt — not a defect, just flagging that the federated GBP surface this app touches today is narrow (accounts/locations read, reviews read+reply, performance metrics read).

---

## What's already fine (verified, not flagged further)

- **Architectural separation between owned-profile (GBP) and third-party (Places API) data is correct.** Every GBP call site (`oauth.ts:420,428`; `collectReviews.ts:91`; `GoogleBusinessClient.ts:69`; `fetchSocialInsights.ts:114`) is gated behind a tenant-owned, OAuth-populated `SocialAccount` row. Every competitor/prospecting code path (`agents/signal_collector.ts`, `agents/competitor_snapshot.ts`, `agents/competitor_data_bootstrap.ts`, `server/src/lib/googlePlaces.ts`, `server/src/routes/functions/runCompetitorIdentification.ts`, `collectCompetitorReviews.ts`) correctly uses the Places API / SerpAPI / DataForSEO instead, never GBP. `collectCompetitorReviews.ts` even documents the boundary explicitly in-code. No fix needed here.
- **No deprecated/wrong endpoints.** No `reportInsights`, no `locations.associate`/`clearLocationAssociation`, no InsuranceNetworks/HealthProviderAttributes, no Business Calls API anywhere. Every call site targets the correct federated base URL for its function. Performance metrics correctly use the batch `fetchMultiDailyMetricsTimeSeries` method rather than one call per metric.
- **The AI-generated review reply *approval* system, where it's used, is sound.** `executeOrQueue.ts:60-63` forces every `review_reply` `AutoAction` to `pending_approval` with `auto_execute_at: null` regardless of autonomy level, and the scheduled sweep structurally cannot pick those rows up (verified against `approvalGate.test.ts`). The only way a reply goes out through that path is an explicit human `PUT /api/auto-actions/:id/approve`. The problem is that **B1's unauthenticated `social.ts` route bypasses this entire system** — the gate itself isn't broken, it's just not the only door.
- **Batch sync jobs isolate tenant failures from each other.** `scheduler.ts`'s `runAgentForAll`/`runForAll` use `Promise.allSettled` in batches of 4 with per-tenant try/catch — one dead token never blocks the queue for other tenants.
- **No token leakage into logs found.** Broad greps across the backend found no case of a raw access/refresh token reaching `console.log`, structured logging, or a third-party service (no Sentry or APM is even wired in). No client secret found in the working tree beyond gitignored `.env` files, and a full git-history search turned up only placeholder values in tracked `.env.example` files — never a real secret.
- **Redirect URIs are environment-driven, not hardcoded** (`oauth.ts:96-98`, built from `SERVER_BASE_URL`), which is correct practice; whether the right URIs are registered in Google Cloud Console is outside the repo (see open questions).

---

## Assumptions I could not verify — questions for you

1. Is `META_ENCRYPTION_KEY` actually set in the production Render environment, and is it a properly generated value distinct from any dev value? (Directly determines whether B3 is a live issue right now or a latent one.)
2. Is the Google Cloud OAuth consent screen currently in **Testing** or **Production** publishing status? This determines whether the unhandled 7-day refresh-token expiry (Testing mode) is an active, immediate customer-facing problem today.
3. Is `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` one shared OAuth client for both `google_business` and `google_ads`, or two separate clients?
4. What redirect URIs are currently registered on the Google Cloud OAuth client — do they match only in-use `SERVER_BASE_URL` values, with no stale localhost/staging entries left registered?
5. What "App name," support email, and authorized domain are configured on the OAuth consent screen — do they match the product's actual branding ("Cortexi" / `cortexi.ai`, per `index.html`, `Legal.jsx`), given `package.json` and `render.yaml` internally still say `base44-app`/`quiet-eyes-*`?
6. Does any generic entity/CRUD route (e.g. an `entities.ts`-style router) return `BusinessProfile.google_access_token` or `whatsapp_access_token` fields to the frontend without exclusion?
7. Is `OPS_ALERT_EMAIL` / `COLLECTOR_ERROR_RATE_THRESHOLD` actually configured in the production Render environment, or does the one existing alert mechanism currently no-op?
8. Is there any infrastructure-layer protection (WAF, API gateway, IP allowlisting) in front of these Express routes that isn't visible in this repo? This matters a lot for how urgently B1 needs fixing.
9. Are `businessId`/`reviewId` values practically guessable (sequential IDs) or opaque (random UUID/cuid)? Affects how easily B1 is exploited in practice today — though even opaque IDs leaking via a compromised session or a shared URL would still make it exploitable, so this changes urgency, not whether it's a real bug.

---

## Quota estimate (300 QPM)

Heaviest pattern is the daily scheduler fanning `collectReviews`/`fetchSocialInsights` across all onboarded tenants in batches of `CONCURRENCY = 4` (`server/src/scheduler.ts:96`, sized for the DB pool, not for Google's quota) with no inter-batch delay and each connected location issuing 1 GBP request per sync in steady state.

| Connected locations | Estimated behavior | Breaches 300 QPM? |
|---|---|---|
| 10 | Total request volume (~10-20/day) too small to matter | No |
| 100 | Sustained instantaneous rate during a batch run can approach ~300-480 QPM depending on real Google latency (unmeasured in this repo) | Borderline — depends on unverified production latency |
| 500 | Sustained rate structurally exceeds 300 QPM for `fetchSocialInsights` (the lighter, more latency-bound task); `collectReviews` has more headroom only because an LLM call incidentally paces it, not by design | Likely breach |

There is no code-enforced ceiling today — margin under 300 QPM depends entirely on production latency this repo doesn't measure, and a future speed-up to the LLM step in `collectReviews` would remove its incidental pacing without anyone noticing it was load-bearing for quota safety.

---

## Suggested order of work

Items 1–7 below are done (see `[FIXED]` markers above) — kept here so the original prioritization stays legible.

**Blocks Google verification submission** (verification will fail, or the app is unsafe to submit for a security assessment as-is):
1. ~~B5 — Add Google-specific data handling disclosure to the privacy policy (what's accessed, how stored, how to revoke/delete).~~ **[FIXED]** — worth a legal read-through before it ships.
2. ~~B2 — Encrypt `refresh_token` and `google_access_token` at rest, matching the pattern already used for Facebook/Instagram tokens.~~ **[FIXED]** — backfill script still needs to be run against production.
3. ~~B3 — Move `META_ENCRYPTION_KEY` into `render.yaml` and make the encryption helper fail loud instead of silently falling back to plaintext.~~ **[FIXED]** — the real key value still needs to be confirmed/set in the Render dashboard.
4. ~~B4 — Make disconnect call Google's revoke endpoint and clear `refresh_token`, not just `access_token`.~~ **[FIXED]**
5. Answer open questions 2, 3, 5 (publishing status, shared OAuth client, consent-screen branding) — these directly gate what you submit and how. **Still open — not code-fixable from this repo.**

**Should fix immediately regardless of verification timeline** (live production security holes):
6. ~~B1 — Add ownership checks to `/api/oauth/initiate`, `/api/oauth/disconnect`, and `/api/social/reviews/:id/reply`; add a `review.linked_business === businessProfileId` check before any review read/write.~~ **[FIXED]**
7. ~~Apply the same fix to `campaigns.ts` (Google Ads / Meta Ads publish/sync routes) — same pattern, same fix.~~ **[FIXED]**

**Can ship after verification submission, but track them:**
8. Add cross-tenant-denial tests for the routes fixed in #6-7.
9. Add `validateOnly=true` coverage for the review-reply write path (build a dry-run test now, since there's no sandbox to do it later).
10. Add `X-GOOG-API-FORMAT-VERSION: 2` to GBP requests — cheap, improves every future debugging session.
11. Add exponential backoff with jitter on 429/5xx for GBP calls, and stop treating a 429 as silent data loss.
12. Add a QPM-aware limiter ahead of the scheduler fan-out (independent of #11) before connected-location count approaches the 100-500 range estimated above.
13. Make `refreshExpiringGoogleTokens` distinguish `invalid_grant` from transient failures, flag the tenant (`is_connected: false`, `last_error`), and surface that in the frontend integrations page so "reconnect your Google account" is unambiguous.
14. Fix the dead "use last known token" fallback (`GoogleBusinessClient.ts:46`, `googleTokenRefresh.ts:94`) to decrypt before using it.
15. Add a dedicated alert on `invalid_grant`/`403 PERMISSION_DENIED` spikes, distinct from the generic daily error-rate email; confirm `OPS_ALERT_EMAIL` is actually set in production.
16. Consistency pass: route `collectReviews.ts`'s `console.*` calls through the structured `logger`, with tenant/status in the `data` field everywhere.
17. Multi-location selection UI, instead of silently picking `locations[0]` — lower priority, only matters for tenants with multiple GBP locations per Google account.

# PRD — Events Module
**Version:** 1.1 | **Date:** July 2026 | **Status:** Draft for approval
**This document defines the desired product, independent of the current implementation.** Code-level gaps and failure analysis are consolidated in Appendix A.

---

## 1. Vision & Summary

The Events module turns external occurrences — holidays, sports matches, festivals, conferences, mass-viewership TV broadcasts, and local events — into **ready-to-approve business actions** that generate revenue, sales, and foot traffic for the business.

Guiding principle: the business owner should not need to know that Purim is 3 weeks away and figure out what to do about it. The system knows, understands what it means **for this specific business**, and hands the owner a fully prepared action — a campaign, a promotion, a product — that only needs approval.

> Not "there's an event — deal with it," but "there's an event — here's what I prepared for you."

---

## 2. Problem

1. Small business owners systematically miss time-based opportunities: they remember a holiday a week before it starts, miss an event bringing 3,000 people within 2 km of their business, and never connect a mass broadcast with a sales opportunity.
2. Even when aware of an event, translating it into action (which promotion? which campaign? when to start?) requires time and marketing expertise they don't have.
3. Generic information doesn't help: a renovation contractor doesn't care about the Big Brother finale or the Champions League final. Relevance is everything.

---

## 3. Goals & Success Metrics

### Product goals
- Every business sees only events that can generate revenue, sales, or traffic for it.
- Every relevant event arrives with one or more actions, ready for approval, tailored to the business and the event.
- Events surface early enough for the action to deliver real value.

### Primary KPIs

| Metric | Definition | Initial target |
|--------|-----------|----------------|
| Proposed actions | Number of actions generated from events, per business per month | ≥ 4 |
| Execution rate | % of proposed actions approved and executed | ≥ 30% |
| Campaign results | For executed social actions — impressions/engagement/clicks pulled from the platform | Measured and displayed per action |
| Relevance accuracy | % of displayed events marked "dislike"/dismissed | ≤ 20% |

**Current measurement stage:** execution only, plus social campaign results when the action is a campaign. Direct revenue attribution (level 3) is out of scope for this version.

---

## 4. Scope

### In scope
- Dynamic holiday calendar (Jewish, Muslim, Christian, civil) that updates automatically every year.
- Sports events: matches and finals with broad public interest, including identification of the competing teams.
- Festivals, concerts, markets, and fairs.
- Professional conferences and exhibitions (relevant to B2B and service businesses).
- Mass-viewership TV broadcasts only: finals and key stages of major shows, national-team / top-club matches.
- Local events within a 5–10 km radius of the business (or branch).
- Per-business relevance engine with user-feedback learning.
- Actions engine producing ready-to-approve actions of multiple types.
- Throttling, merging, and prioritization to prevent overload.
- Proactive notifications + dashboard chat integration.

### Out of scope (this version)
- Direct revenue attribution to actions (POS/payments integration).
- Redesign of the page layout (cards/tabs) — low priority, stays as is.
- Weather events — **open question** (see section 13).

---

## 5. Data Sources

| # | Source | Provides | Refresh cadence | Requirements |
|---|--------|----------|-----------------|--------------|
| 1 | Dynamic holiday calendar (API such as HebCal) | Jewish holidays, civil dates, Ramadan/Eid, Christian holidays | Daily | A hardcoded calendar is **forbidden**; dates are fetched automatically for every year |
| 2 | Live sports schedule | Upcoming matches: Israeli leagues, national team, Champions League, World Cup, NBA — including team names and a confirmed date | Daily | A sports event without team names and a confirmed date does not enter the system |
| 3 | Local events (Google Events / Eventbrite / Israeli ticketing sites) | Concerts, festivals, markets, fairs — with geo location | At least twice a week | 5–10 km radius filter; expected-crowd estimate |
| 4 | Conferences & exhibitions | Professional events by business industry | Weekly | Mapped to industry (real-estate expo ↔ renovation contractor) |
| 5 | Mass-broadcast schedule | Finals/key stages of major shows, major sports broadcasts | Weekly | Entry bar: expected mass viewership (leading reality-show finale, match between top clubs). Regular series premieres do not qualify |
| 6 | Commercial/seasonal events | Black Friday, Valentine's Day, back-to-school, seasons (weddings, renovations, January fitness) | From a dynamic recurring calendar | Seasonally matched to the industry |

**Cross-cutting quality rule:** every event must have a confirmed date (structured field, not free text), a specific name (not "concert" but "Omer Adam concert"), a source URL, and a location where relevant. An event without a confirmed date does not enter the system.

---

## 6. Relevance Engine

### 6.1 Automatic decision based on the business profile
The system decides on its own which events are relevant, based on one question: **can this event generate revenue, sales, or traffic for this business?**

Decision input — a deep business profile (see section 7): industry, sub-industry, products and services, prices, target audience, location, and character (B2B/B2C, physical/digital, foot-traffic-dependent or order-dependent).

Guiding examples:

| Event | Pub in Tel Aviv | Renovation contractor in Hadera | Toy store |
|-------|-----------------|---------------------------------|-----------|
| Champions League final | Highly relevant (peak night) | Not relevant | Not relevant |
| Pre-Passover | Relevant (holiday events) | Highly relevant (pre-holiday renovation/painting) | Relevant (holiday gifts) |
| Big Brother finale | Relevant (viewing night) | Not relevant | Not relevant |
| National real-estate conference | Not relevant | Relevant (professional leads) | Not relevant |
| Music festival 2 km away | Highly relevant (traffic) | Not relevant | Depends on audience |

Every event gets a weighted **relevance score (0–100)**: industry/product fit, geographic proximity, traffic/sales potential, and learning history (6.2). Display threshold: score ≥ 50. The score is stored and displayed (transparency: "why am I seeing this").

### 6.2 Learning from the user
- **Feedback buttons on every event: "Like" / "Dislike"**, with an optional free-text box — "why?" (e.g., "I don't work on holidays").
- Additional signals: approving/executing an action = strong positive; dismiss = negative; prolonged ignoring = weak negative.
- "Dislike" + a textual reason feeds the relevance engine: the system learns the pattern (not just the single event) and stops showing similar events.
- Learning is per business, with optional industry-level generalization (if 80% of renovation contractors reject sports events — the industry default updates).

---

## 7. Business Knowledge — Prerequisite

To produce deep actions (section 8), the system must know the business in depth. **This is a core requirement of the Events module**: the system must learn the full business profile and perform comprehensive market research on it, including at minimum:

1. **Product/service catalog + prices** — learned automatically from the business website, social channels, and menu/price pages, with manual completion during onboarding.
2. **Target audience** — who the customers are, where they come from, what motivates them.
3. **Business character** — physical/online, foot-traffic vs. order dependent, seasonality, opening hours, whether it operates on holidays.
4. **Competitive and market context** — industry norms, price ranges, what competitors do around events.

If this capability is missing or partial in the system — **it is a gap that must be closed as part of implementing this PRD** (see Appendix A, gap #1). The Events module consumes this knowledge; without it, actions stay generic.

---

## 8. Actions Engine

### 8.1 Principles
- Every relevant event arrives with **one or more actions**, according to the event's size and revenue potential. Example: Champions League final for a pub = a social campaign **plus** a promotion ("finale beer platter"); a small local fair = a single post.
- Actions are **specific and deep**, grounded in the product catalog and prices: not "run a Passover promotion" but "Promotion: interior painting package for a 4-room apartment at ₪4,800 instead of ₪5,600, valid until Passover eve — including ready-made ad copy."
- Actions match the business type, its character, and the event — not just social.

### 8.2 Action types

| Type | Example | Destination |
|------|---------|-------------|
| Social post | Pre-final post with ready copy and image | Marketing center |
| Campaign | Multi-day paid/organic campaign toward a holiday | Marketing center |
| Promotion/discount | Concrete price offer with validity, based on the business price list | Promotions / task |
| New product/service | "Mishloach Manot gift box" for a bakery before Purim | Task |
| Operational prep | Inventory/staff reinforcement before a traffic-driving event | Task |
| Customer outreach | WhatsApp/email message to existing customers before an event | Messaging channel |

### 8.3 Approval flow
1. The system generates the action **in full** (copy, parameters, proposed timing).
2. The user clicks the action on the Events page → is taken **to the relevant page in the system with the action pre-loaded and ready; all that remains is to approve** (campaign → marketing center with the full campaign; promotion → the prepared offer screen; task → a drafted task).
3. No automatic execution without approval in this version; the business's autonomy level may extend this in the future.
4. Every action is tracked with a status: proposed → viewed → approved/rejected → executed → results (for campaigns).

### 8.4 Action timing
- Every action is proposed **as early as possible while it still delivers value** — derived from the action type:

| Action type | Proposal window before the event |
|-------------|----------------------------------|
| New product/service | 21–30 days |
| Campaign | 14–21 days |
| Promotion | 7–14 days |
| Operational prep | 3–7 days |
| Social post | 1–3 days |

- A major event can generate actions in waves: campaign 3 weeks out, promotion a week out, post a day before.

---

## 9. Throttling, Merging & Prioritization

**Overload is forbidden.** Throttling rules:

1. **Active-actions cap**: a maximum number of simultaneously pending actions per business (proposed value: 5; tunable). Beyond that — actions wait in a queue and are released when a slot frees up or when their timing window opens.
2. **Priority by potential**: when events exceed the cap — show the highest revenue-potential ones (relevance score × event size × time proximity).
3. **Merging overlapping events**: events in the same week with the same action character are merged into a single proposal ("Holiday week: Hanukkah + Black Friday — combined end-of-year campaign") instead of flooding separately.
4. Busy periods (December, pre-Passover) are handled automatically by the three rules above — the user never sees 10 open proposals.

---

## 10. Notifications & In-System Integrations

1. **Proactive notifications**: a high-potential event with a prepared action sends a notification (in-app, and on channels the business configured): "The league final is in 5 days — I prepared a campaign and a promotion, awaiting your approval."
2. **Dashboard chat**: the chat is aware of upcoming events and pending actions. When the customer talks to the chat — it can proactively offer: "Note: Purim is in two weeks and I have a promotion proposal ready — want to see it?"
3. **Daily brief**: upcoming events with pending actions appear in the morning brief on the dashboard.

---

## 11. Multi-Branch

- **Local events** (5–10 km radius): each branch sees only its own area's events.
- **National events** (holidays, broadcasts, sports): shared across branches; actions can be network-level or branch-level.

---

## 12. Subscription Plans

The module is **not available on all plans**. Proposed principle (pending final approval — open question #2):

| Capability | Basic plan | Mid plan | Advanced plan |
|-----------|-----------|----------|----------------|
| Holidays & national events | ✔ (view only) | ✔ | ✔ |
| Ready-to-approve actions | — | ✔ (up to N/month) | ✔ unlimited |
| Local events by radius | — | ✔ | ✔ |
| Multiple actions + price-depth | — | — | ✔ |
| Notifications + proactive chat | — | ✔ | ✔ |

---

## 13. Open Questions

| # | Question | Status |
|---|----------|--------|
| 1 | Weather events (heatwave, storm) — in or out? | Open |
| 2 | Exact mapping of capabilities to the existing subscription plans | Open — only "not on all plans" was decided |
| 3 | Quantitative definition of "mass viewership" for TV broadcasts (rating bar / show-stage type) | Open — principle decided |
| 4 | Exact cap value for simultaneously active actions | Proposed: 5 |
| 5 | Which external notification channels (WhatsApp/email/push) are on by default | Open |

---

## 14. Proposed Implementation Phases

**Phase 1 — Data foundations:** dynamic holiday calendar, live sports schedule, structured event-date field, radius filtering for local events, mass-broadcast threshold.

**Phase 2 — Relevance & learning:** unified per-business relevance score, like/dislike buttons + reason box, feedback loop into the engine.

**Phase 3 — Actions engine:** deepened business profile (catalog and prices), multi-type action generation, hand-off to the relevant page with the action ready for approval, status and execution tracking.

**Phase 4 — Throttling & distribution:** cap/merge/prioritize, proactive notifications, chat integration, branch scoping, plan enforcement.

---

# Appendix A — Code-Level Gap & Failure Analysis

As of the time of writing. Each gap lists: what the PRD requires, what the code does today (with file/line references), where exactly it fails, and the impact. This appendix is meant to drive implementation prioritization — it does not constrain the product.

### Current data flow (for orientation)

The Events page (`src/pages/Events.jsx`) renders four queries against the app database (lines 213–216): `ProactiveAlert` of type `market_opportunity`, and `MarketSignal` in categories `event`, `local_event`, `weather_event`. These records are produced by two Express functions, scheduled Mon+Thu 07:00 UTC for all businesses (`server/src/scheduler.ts` lines 252–259) and also triggered from the UI:

- `server/src/routes/functions/detectEvents.ts` — hardcoded calendar + Tavily + Claude Sonnet.
- `server/src/routes/functions/findLocalEvents.ts` — Eventbrite + SerpAPI Google Events + ~21 Tavily queries + Sonnet extraction + Haiku copywriting.

A second, parallel Deno pipeline exists (`agents/event_collector.ts` → `events_raw` → `agents/event_impact_engine.ts` → `event_opportunities` → `agents/otx_sync_bridge.ts` → `market_signals`), plus a geo-radius agent (`agents/sub/local_event_anticipator.ts` → `hyper_local_events`).

---

### Gap 1 — No deep business knowledge; actions are generic
**PRD:** sections 7, 8.1 (actions grounded in catalog/prices).
**Today:** `detectEvents.ts` line 469 uses only `name`, `category`, `city` from the profile. The LLM prompts (lines 676–690) receive nothing about products, services, or prices. `chatWithBusiness.ts` line 153 shows the profile's depth: a free-text `relevant_services` field ("not specified" fallback) — there is no structured product/price catalog anywhere in the schema.
**Failure:** the generated `prefilled_text` can only be generic ("Purim is coming! Special offers at X") because the model literally has no pricing or catalog data to work with. The PRD's flagship example (a priced renovation package) is impossible with current inputs.
**Impact:** blocks section 8 entirely. This is the single largest gap.

### Gap 2 — Holiday & sports calendar hardcoded with 2026 dates; goes dark in 2027
**PRD:** section 5, source #1–2 (dynamic, auto-updating).
**Today:** `detectEvents.ts` lines 44–344 define `CALENDAR_EVENTS` as a static array with literal dates (`'2026-09-20'` Yom Kippur, `'2026-12-04'` Hanukkah, `'2026-05-30'` CL final, World Cup dates, etc.). Phase 1 (lines 559–562) filters `eventDate >= now` — once each date passes it is silently dropped.
**Failure:** after December 2026 the calendar produces zero holidays until someone edits source code. The sports-query builder (`buildSportsSpecificQueries`, lines 348–393) also gates queries on hardcoded final dates. Ironically, the Deno side already uses a dynamic source — `event_collector.ts` `fetchIsraeliHolidays()` (lines 69–92) calls the HebCal API — but that pipeline never reaches the page (see Gap 12).
**Impact:** the page's most reliable content source has a built-in expiry date.

### Gap 3 — "Act now" hands off to an empty campaign form
**PRD:** section 8.3 (hand-off with the action pre-loaded, only approval remaining).
**Today:** `Events.jsx` line 120: `navigate('/marketing/create')` — no state, no query params. The generated `prefilled_text`, the event name, and the date are all discarded at the moment of hand-off; the user lands on a blank form. The only working transfer is manual copy-paste (the "copy text" button, lines 113–117) or creating a bare `Task` (lines 124–137).
**Failure:** the core value loop (event → prepared action → approve) is broken at its last step.
**Impact:** directly contradicts the decided approval flow; likely the highest-leverage fix.

### Gap 4 — Actions are labels, not artifacts; nearly everything is a social post
**PRD:** section 8.2 (six action types, generated in full).
**Today:** `detectEvents.ts` has a `selectActionType()` (lines 453–457) returning `create_campaign` / `create_offer` / `social_post`, but the value is only stored as a string inside a JSON blob; no campaign or offer object is ever created. Worse, the `MarketSignal` write hardcodes `action_type: 'social_post'` (line 739) regardless of what `selectActionType` returned — the computed type is used only in the alert record (line 703). `findLocalEvents.ts` lets the LLM pick `action_type` (line 300) but again only stores the label (line 405).
**Failure:** there is no promotion engine, no product-suggestion path, no operational-prep or customer-outreach action anywhere. The two functions produce ~10 LLM-written social captions per scan and nothing else.
**Impact:** blocks the multi-type actions decision; also an internal inconsistency bug (hardcoded `social_post` overriding computed type).

### Gap 5 — No like/dislike feedback; learning is title-matching only
**PRD:** section 6.2.
**Today:** no feedback UI exists on `Events.jsx` — only local dismiss (`dismissedIds`, client-state that resets on reload, line 208). Server-side "learning" is: (a) `loadDismissedTitles` (`detectEvents.ts` line 627) which suppresses re-creating records with the same title for 30 days, and (b) `rejectedPatterns` substring matching (lines 476, 664–666) sourced from business context.
**Failure:** dismissing "⚽ NBA Finals 2026" does not teach the system that this business doesn't care about sports — next month's different sports title passes the filter. There is no reason capture, no pattern generalization, no industry-level aggregation.
**Impact:** relevance cannot improve over time; the ≤20% dislike KPI is unmeasurable (no dislike exists).

### Gap 6 — Event date, the page's most critical field, lives in JSON blobs and regexes
**PRD:** section 5 quality rule (structured, confirmed date).
**Today:** the date is serialized into `source_description` / `source_agent` JSON strings (`detectEvents.ts` lines 702–711, 736–744). The frontend `getEventMeta()` (`Events.jsx` lines 59–85) has to double-parse JSON (`if (typeof p === 'string') p = JSON.parse(p)` — evidence of double-encoded rows in production), and when the date is missing it regex-scrapes ISO or `dd.mm.yyyy` dates out of the human-readable description (lines 75–83). Server-side stale-cleanup does the same regex scraping (`detectEvents.ts` line 500). Sorting, countdowns, "this week" stats, and stale-dismissal all depend on this fragile chain.
**Failure:** any event whose date fails to parse is silently sorted to "+365 days" (`extractEventDate` fallback, line 243) and never flagged. The Deno collector is worse: `event_collector.ts` **fabricates dates** — Tavily results get `event_date = now + 7 days` unconditionally (line 215, confidence 0.70), and SerpAPI results fall back to `now + 7 days` when parsing fails (lines 163–170, confidence 0.80). Fabricated dates violate the "confirmed date or nothing" rule and would drive wrong countdowns.
**Impact:** correctness of everything time-based on the page; schema work (a real `event_date` column) is a Phase-1 prerequisite.

### Gap 7 — No real geo-radius for local events; the component that has one is dead code
**PRD:** section 5 source #3, section 11 (5–10 km radius).
**Today:** `findLocalEvents.ts` approximates locality with text search: a hardcoded 13-city `REGION_MAP` (lines 49–63) appends region words to Tavily queries. No coordinates, no distance computation, no radius. Meanwhile `agents/sub/local_event_anticipator.ts` implements exactly the PRD's logic — venue coordinates, `distanceMeters()`, per-business radius from `meta_configurations` (default 1,000 m), expected attendance, and a 2-hour action window (lines 220–254) — but it writes to `hyper_local_events`, a table **no UI reads**, and the agent is **not registered in the worker's cron** (`agents/main.ts` lines 14–20), so it never runs in production.
**Failure:** the shipped path can't enforce a radius; the correct implementation is unscheduled and unread.
**Impact:** the 5–10 km decision has no working substrate; either wire up the existing agent or port its logic.

### Gap 8 — No throttling, cap, or merging
**PRD:** section 9.
**Today:** each `detectEvents` run creates up to ~14 calendar alerts + 3 Tavily events (each written twice — alert **and** signal, lines 713–749), and `findLocalEvents` adds up to 8 more (line 356). Deduplication is title-normalization only (server: line 493; client: `Events.jsx` lines 246–270 — two different normalizers that can disagree, e.g., the server strips `" בעוד "` suffixes and the client strips emoji via a different regex). There is no cap on open items, no priority queue, no merging of overlapping holidays.
**Failure:** in a stacked period (Hanukkah + Black Friday + New Year within 5 weeks) a business accumulates 15+ open cards with no ranking beyond date sort.
**Impact:** the "no overload" decision is unimplemented; the client/server dedup mismatch also produces occasional visual duplicates.

### Gap 9 — No plan gating; auto-scan on page load burns paid APIs; a silent-skip bug hides it
**PRD:** section 12.
**Today:** `Events.jsx` has no `PlanGate`, and neither server function checks the plan (unlike `runFullScan`, which enforces monthly quotas). Two compounding problems:
1. **Auto-scan:** the `useEffect` at lines 221–235 fires both functions whenever a business opens the page with an empty list — a free-trial user can trigger ~21 Tavily searches + 1 Sonnet extraction + up to 8 Haiku calls (findLocalEvents) plus detectEvents' Tavily batch and **2 Sonnet calls per calendar event** (lines 671–691, up to ~28 calls) just by visiting.
2. **Silent-skip bug:** `findLocalEvents.ts` has a 3-day cooldown (lines 11, 32–34) whose comment claims "manual scan from the UI passes force:true" — but the UI never sends `force` (`Events.jsx` lines 225–226, 310–311). A user who clicks "scan events" within 3 days of the last run gets `{skipped: true}` while the UI shows the success toast "event scan completed" (line 319). `detectEvents` has the opposite problem: **no cooldown at all**, so every click re-runs the full LLM batch.
**Impact:** unbounded cost exposure on one side, a deceptive no-op on the other; plan-tier enforcement has nothing to build on.

### Gap 10 — TV noise: no mass-viewership bar in the main collector
**PRD:** section 5, source #5.
**Today:** `detectEvents.ts`'s prompt does state a bar ("Only major shows with audience > 300K viewers", line 602) — but `findLocalEvents.ts`'s TV query batch (lines 182–188) searches for "סדרה עונה חדשה השקה" (new season launches) and "Netflix ישראל סדרה חדשה פרמיירה" with no viewership constraint in its extraction prompt (lines 286–288), and its relevance examples never mention TV.
**Failure:** routine premieres can enter as `tv_broadcast` signals for any business the LLM scores ≥ 50.
**Impact:** exactly the noise class the product decision excluded (mass-viewership only).

### Gap 11 — No branch scoping
**PRD:** section 11.
**Today:** all four page queries filter by `linked_business` only (`Events.jsx` lines 213–216). `AppLayout` provides `selectedLocationId` via outlet context, but `Events.jsx` destructures only `businessProfile` (line 203). `MarketSignal` rows created by both functions carry no location/branch field.
**Failure:** a Haifa branch and an Eilat branch of the same profile see identical "local" events.
**Impact:** blocks the per-branch decision; needs a branch/location column on event records plus query filtering.

### Gap 12 — The Deno event pipeline is dead-ended in production
**PRD:** infrastructure prerequisite (Phase 1 consolidation).
**Today:** the Render worker runs only `agents/main.ts`, which registers exactly five cron agents (lines 14–20): SignalCollector, OTXSyncBridge, EventCollector, SectorTrendRadar, CompetitorSnapshot. `EventCollector` therefore **does** fill `events_raw` hourly — but `EventImpactEngine` (the only producer of `event_opportunities`) is **not registered** and its pg_notify trigger path lives in a separate `bus_listener` entrypoint that `render.yaml` never starts. Consequently `event_opportunities` stays empty, and `otx_sync_bridge.ts`'s `syncEventOpportunities()` (lines 384–405, syncs rows with `impact_score > 0.25`) is a permanent no-op.
**Failure:** an entire collection pipeline (HebCal dynamic holidays, Eventbrite, additive impact scoring 0.5·sector + 0.3·geo + 0.2·history) runs partially, computes nothing user-visible, and burns API quota (`event_collector` calls SerpAPI/Tavily hourly). It is also structurally limited to four sectors (`CONFIGURED_SECTORS = restaurant/fitness/beauty/local`, `event_collector.ts` line 47) and to businesses that exist in the separate UUID `businesses` table — a different tenant model from the app's `BusinessProfile`.
**Impact:** decide explicitly: either finish wiring this pipeline (register EventImpactEngine, run the bus listener, bridge tenants, expand sectors) or retire it and consolidate on the Express path. Running half of it is pure cost.

### Gap 13 — Chat and notifications are not event-aware
**PRD:** section 10.
**Today:** `chatWithBusiness.ts` includes the last 8 `MarketSignal` rows of any category and 5 pending alerts in its context (lines 24–31, 49–52) — so an event may appear *incidentally*, but the chat has no notion of event dates, pending event actions, or proposal state, and it never initiates ("Purim is in two weeks…"). There is no push/WhatsApp/email notification path for a newly created high-potential event action; the only "notification" is the page's 20-minute poll (`POLL_INTERVAL`, `Events.jsx` line 211).
**Failure:** high-value prepared actions wait silently until the user happens to open the Events page.
**Impact:** blocks the proactive-distribution decision (notifications + chat offers + daily brief).

### Gap 14 — Frontend-only classification and misc. correctness issues
**PRD:** supports sections 5–6 quality goals.
**Today:**
- Tab classification is client-side keyword matching on the title (`classifyEvent`, `Events.jsx` lines 22–34): "פסטיבל אוכל בחיפה" matches the "פסטיבל" keyword → categorized "culture," invisible under any food-related mental model. The category should be a structured server-side field.
- Confidence values are hardcoded constants, not computed: 95/80 for calendar events (`detectEvents.ts` line 734), 65 for Tavily events (line 825), 80/65 by URL presence (`findLocalEvents.ts` line 393).
- Alert metadata is stored in a field named `source_agent` (line 720) — semantic misuse that forces the frontend to try parsing *both* `source_agent` and `source_description` as JSON (`getEventMeta`, lines 68–70).
- Weather signals are displayed by the page (query at `Events.jsx` line 216) but produced only as a side effect of `findLocalEvents`' Tavily weather queries; the Deno `weather_demand_predictor` (Open-Meteo, structured demand deltas) writes to `demand_forecasts`, which the page never reads — same dead-end pattern as Gap 7.
**Impact:** individually small, collectively they make the page's behavior hard to predict and hard to test; most disappear naturally if Gaps 4, 6, and 12 are fixed with proper schema.

---

## Appendix B — Decision Log (from product discussion)

| Decision | Content |
|----------|---------|
| Document purpose | Standalone PRD describing the desired product, independent of current implementation |
| Success metric | Number of actions proposed from events + their outcomes; stage 1: execution + social campaign results |
| Sources | Dynamic holiday calendar, sports, festivals, conferences, mass-viewership TV — matched to the business |
| Relevance | System decides autonomously by business type + learns from the user; criterion: revenue/sales/traffic |
| Feedback | Like/dislike buttons + free-text reason box |
| Action depth | Based on deep learning of the business, its products, services and prices; if that learning doesn't exist — it is a gap to close |
| Action quantity | Per event (Champions League final = campaign + promotion); no overload — throttle/merge/prioritize |
| Approval flow | System creates the action and moves the user to the relevant page with it ready; only approval remains |
| Timing | As early as possible while still delivering value |
| Local radius | 5–10 km |
| TV/sports | Mass viewership only: finals, key stages, top clubs |
| Multi-branch | Local per branch; national shared |
| Plans | Not available on all subscription plans (exact mapping — open question) |
| Distribution | Proactive notifications + proactive suggestions in the dashboard chat |
| UX | Card/tab redesign — low priority, unchanged for now |

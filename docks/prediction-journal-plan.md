# Personal Prediction Journal Plan

Status: local-only first release implemented. The current scope below supersedes
the original account/Supabase proposal retained later in this document.

## Implemented scope (updated decision)

- No signup, authentication, Supabase connection, or cloud journal storage.
- IndexedDB stores buckets, watched stocks, predictions, evidence and learning notes.
- CSV backup/restore for switching browsers/devices; CSV is Excel-compatible.
  Native `.xlsx` files are not supported. Import original exported backups;
  identical records merge, conflicting IDs reject the entire import.
- Up/down predictions use an optional percentage target and a future weekday's
  15:30 India close. Results are checked after 18:00 India time when the journal
  is opened or manually refreshed. No work runs while the page is closed.
- Weekends are rejected. Missing bars/holidays await data without date substitution;
  provider-reported splits since the reference require manual review.
- Reference quote/time and prediction terms are locked in the UI; notes can be
  edited, pending predictions cancelled, and new predictions created separately.
  Local/imported history is not tamper-proof or externally verified.
- Direction accuracy, target achievement, unchanged, pending and cancelled counts;
  bucket/status filtering, watchlist pagination and prediction-history pagination.
- Dedicated `/watchlist` page with watched-stock and prediction tables, reached
  through a top screener button. Screener **Watch / Predict** opens a stock-scoped
  popup; existing bucket membership/history changes it to **View your prediction**.
- Automatic screener refresh uses applied settings. Editing percentage, direction
  or range does not initiate a scan; **Rescan** applies the draft settings.
- Advanced charts, target-touch/intraday evaluation, verified trading calendars,
  and cloud/account flows are not implemented.

See [README.md](../README.md#local-watchlists-and-prediction-journal) for operation,
backup limits, market-data caveats, and storage warnings.

## Original proposal (historical, not the current implementation scope)

## Goal

Let users organize stocks, record their own expectations, and learn by comparing
those expectations with subsequent market data. This is a personal learning
journal, not an automated investment recommendation or a validated forecasting
model.

## 1. User journey

### Watchlists and buckets

- Add a stock from the screener or stock details popup.
- Organize stocks into named buckets, such as Banking or Stocks to study.
- Allow watching a stock without creating a prediction.
- Keep watchlist membership separate from prediction history.

### Create a prediction

Capture:

| Field | Example |
| --- | --- |
| Stock | Selected NSE symbol |
| Reference price | INR 1,000 |
| Price source and market timestamp | Latest available provider observation |
| Expected direction | Up or down |
| Optional expected movement | 5%, or a target price of INR 1,050 |
| Deadline | Selected trading date |
| Optional reason | Strong volume after consolidation |
| Optional confidence | 70% |

Automatically capture the reference price and its timestamp. Do not describe a
delayed quote or previous closing price as live. Distinguish the market observation
timestamp from the time the prediction was created.

On the first prediction save, offer:

- Create an account or sign in: retain and sync records across devices.
- Continue as guest: store records in this browser only.

Do not repeatedly interrupt guests with registration prompts.

### Track and review

Show the reference price, latest available price, actual percentage movement,
target, deadline, status, result, and original reasoning.

After completion, "Make another prediction" creates a new record without
overwriting the previous prediction.

## 2. Evaluation rules

An expectation such as "up 5% by Friday" has two possible meanings:

| Rule | Success condition |
| --- | --- |
| At deadline | Friday's closing price is at least 5% above the reference price |
| Reached before deadline | Price touches the target before Friday's close |

Recommended first-version rule: evaluate at the deadline using the selected
trading day's closing price. Target-touch evaluation is a later feature.

- Direction only: up requires a higher closing price; down requires a lower one.
- Direction plus target: the specified movement must be achieved at the deadline.
- Show an unchanged price separately, not as a directional success.
- Distinguish direction correct but target missed from full target achievement.
- Require the deadline market observation to be later than the reference
  observation; do not permit recording an already-known result.
- Use the exchange timezone for deadlines and UTC for stored instants.
- Reject non-trading days or explicitly offer an adjusted trading date before save.
- Validate that target prices and percentages agree with the selected direction.
- Show awaiting data or unable to evaluate for unavailable or unreliable prices;
  never silently classify those records as incorrect.
- Define consistent price adjustment for splits and similar corporate actions.

The exact evaluation rules, trading-calendar handling, and freshness requirements
must be agreed before implementation.

## 3. Storage and authentication

### Guests: IndexedDB

Use IndexedDB rather than browser SQLite. It supports structured local records
without adding a browser database runtime.

- No account required.
- Data stays in the current browser profile and does not automatically sync.
- Clearing site data, using private browsing, or losing the device may lose records.
- Provide export/import backup.
- Explain storage limitations before the first guest save.

Suggested notice:

> Saved only in this browser. Clearing browser data may delete your watchlists
> and predictions.

### Registered users: Supabase

Use a separate Supabase project for this app:

- Supabase Auth for registration, sign-in, and sessions.
- Supabase PostgreSQL for watchlists, predictions, and evaluations.
- Row Level Security (RLS) to restrict access to each user's own records.
- Scheduled server-side evaluation for account predictions.

The existing Supabase project for another application can remain unchanged.
A separate project provides separate project credentials, authentication users,
database, and configuration. Check current organization/project limits and billing
before creating it; do not assume an additional project is free.

The existing optional PostgreSQL signal persistence can remain independent at
first. Migrating those signals into Supabase is a separate decision and is not
required to add the journal.

### Connection and security approach

1. Create a new Supabase project for Momentum, preferably near the app deployment.
2. Configure the app's local and production authentication redirect URLs.
3. Add the Supabase project URL and publishable key to the appropriate environment
   configuration. Never commit secret values.
4. Use the supported Supabase Next.js server/browser authentication integration;
   validate identity on the server rather than trusting a submitted user ID.
5. Create versioned schema migrations and enable RLS before exposing tables.
6. Allow users to access only records they own, including bucket memberships.
7. Keep secret/service-role credentials exclusively on trusted servers. They can
   bypass RLS and must never be exposed to browsers.
8. Finalized predictions and evaluations need database/server-enforced write
   restrictions, not just disabled UI controls.
9. Protect scheduled evaluation endpoints and make evaluation jobs idempotent.

No Supabase project, credentials, schema, dependencies, or connection are created
as part of saving this plan.

### Guest-to-account migration

After signup or sign-in, ask whether to copy local records into the account.

- Use stable record identifiers and retry-safe imports to prevent duplicates.
- Preserve original creation times, prediction terms, and provenance.
- Confirm server persistence before offering to remove the browser copy.
- Do not silently combine or overwrite conflicting records.
- Mark imported guest records as local/unverified if verified statistics or public
  rankings are ever introduced: browser data can be manipulated.
- Keep guest storage separate from authenticated account caches, especially on
  shared devices and after sign-out.

## 4. Proposed data model

Keep the logical record shape compatible between IndexedDB and Supabase.

| Entity | Purpose |
| --- | --- |
| Bucket | A named user-owned stock collection |
| Bucket stock | Stock membership in a bucket |
| Prediction | Immutable expectation, reference price, deadline, and provenance |
| Evaluation | Outcome with price, market timestamp, source, and rule version |
| Reflection | User's post-result learning notes |

Use Supabase Auth user IDs for ownership. Market observations and evaluation
metadata must be distinguished from user-entered expectations.

Once a prediction is saved, lock the reference price and timestamp, direction,
target, and deadline. Allow cancellation while retaining the cancelled record.
Corrections create a replacement prediction rather than rewriting history.

Store evaluation evidence so historical results remain explainable. If a result
needs correction because of provider revisions or corporate actions, preserve an
auditable revision instead of silently changing it.

## 5. Learning dashboard

Start with:

- Correct, incorrect, pending, cancelled, and unevaluable counts.
- Direction accuracy separately from target achievement.
- Breakdown by stock, bucket, and prediction duration.
- Original reasoning alongside post-result reflections.
- A price chart showing the reference observation and deadline.
- Sample sizes, such as "7 correct out of 10 evaluated predictions."

Exclude pending, cancelled, and unevaluable records from accuracy denominators.
These statistics measure recorded predictions, not investment returns or
guaranteed future performance.

## 6. Market data and performance

The current app uses unofficial Yahoo Finance daily market history.

- Daily-close predictions are the practical starting point.
- Exact intraday deadlines require suitable timestamped intraday history.
- Target-touch evaluation requires sufficiently detailed high/low or intraday
  data for the prediction window; a daily bar spanning time before prediction
  creation is not sufficient evidence.
- A dependable provider and its data usage terms need review before offering
  reliable intraday evaluation.
- Guest results are evaluated when the app is opened using historical prices.
  Browser storage alone does not run scheduled jobs while the browser is closed.
- Account results can be evaluated by scheduled server jobs without an open browser.
- Supabase supplies authentication/storage, not the financial market data feed.

To preserve the screener's memory improvements:

- Fetch only the symbols needed for active predictions.
- Share cached observations across users where appropriate.
- Batch and bound evaluation work; do not trigger full-market scans per user.
- Reuse historical market observations where possible.
- Persist evaluation outcomes rather than recalculating every completed record.

## 7. Rollout

| Phase | Scope |
| --- | --- |
| 1: Guest journal | Buckets, IndexedDB, daily-close predictions, history, export/import |
| 2: Accounts | Supabase Auth, RLS-protected storage, guest migration, cross-device sync, scheduled evaluation |
| 3: Advanced tracking | Intraday deadlines, target-touch rules, notifications, richer analytics |

Design the record format for guest and account storage from the beginning.
The first-save registration prompt should only offer a working account flow;
until phase 2 ships, describe accounts as upcoming rather than presenting a
nonfunctional signup option.

## 8. Verification before release

- Verify up/down, unchanged, exact-target, target-missed, and missing-data outcomes.
- Verify exchange dates, market closures, stale quotes, and corporate actions.
- Verify saved prediction terms cannot be changed through direct API/database calls.
- Verify guest persistence, storage failures, export/import, and migration retries.
- Verify user isolation and ownership checks across all related tables.
- Verify evaluations are repeatable and scheduled retries cannot duplicate results.
- Verify mobile entry, history browsing, and performance with many predictions.

## Recommendation and open decisions

Proceed with a guest-first, daily-close journal, with Supabase planned for
registered accounts. Resolve these decisions before implementation:

- Confirm deadline-close evaluation for the first release.
- Choose allowed prediction durations and market-price freshness requirements.
- Choose signup methods supported by the account release.
- Choose the market data provider and evaluation scheduling environment.
- Decide retention, account deletion, and guest backup behavior.

Personal-learning wording alone does not establish SEBI compliance. Obtain
appropriate legal review before introducing recommendations, premium signals,
or public performance claims.

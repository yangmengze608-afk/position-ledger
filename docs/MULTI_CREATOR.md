# Multi-Creator Position Ledger Plan

## Goal

Evolve Position Ledger from a Serenity-specific tracker into a creator-agnostic public-position evidence network without weakening evidence standards.

## Core model

Every creator gets a stable `creatorId`. Every post, review candidate, canonical event and derived holding carries that `creatorId`.

Canonical identity becomes:

`creatorId + ticker + eventId`

not just `ticker`.

## Source adapters

Each creator can have multiple adapters:

1. Primary social source — X, Bluesky, Reddit, Substack, etc.
2. Public mirrors — discovery/corroboration only.
3. Regulatory/public filings — 13F, Form 4, fund letters, disclosed portfolios.
4. Human-reviewed evidence — screenshots or reposts with preserved provenance.

Adapters never directly write holdings. They write normalized raw posts/evidence candidates. The existing classifier/review/event pipeline remains the approval boundary.

## Evidence policy

- A: directly verified first-person / official filing evidence.
- B: strong secondary evidence or human-resolved identity/entity mismatch.
- C: inference/research context only; never auto-promoted to live.
- Silence never implies EXIT.
- Subscriber/paywalled content is not bypassed. Public reposts can trigger gap review but cannot silently become A-grade evidence.

## Data migration

Target layout:

```
data/
  creators.json
  creators/
    serenity/
      raw_posts.json
      review_queue.json
      events.json
      holdings.json
      market.json
    <creator-id>/
      ...
```

During migration, the existing top-level Serenity files remain supported so the live site does not break.

## Frontend

Phase 1: add creator switcher and creator profile route (`?creator=serenity`).

Phase 2: cross-creator views:

- Consensus holdings: tickers held/disclosed by multiple creators.
- Divergence: one creator bullish/live while another denies/exits.
- Recent disclosure tape across all creators.
- Creator-specific performance since disclosure.
- Evidence-quality filters.

## Candidate onboarding criteria

A creator should only be added when:

1. Identity and primary source are stable.
2. They disclose positions often enough to create a meaningful ledger.
3. Disclosures can be tied to timestamps and original/public evidence.
4. We can distinguish research mentions from actual position statements.
5. Collection does not require bypassing access controls.

## Immediate next engineering steps

1. Add `creatorId: "serenity"` to normalized raw/review/event schemas while keeping backward compatibility.
2. Move classifier/reconciliation functions from person-name assumptions to creator registry lookup.
3. Add per-creator source configuration.
4. Add creator switcher to the GitHub Pages UI.
5. Onboard a second creator as the migration test before adding more.

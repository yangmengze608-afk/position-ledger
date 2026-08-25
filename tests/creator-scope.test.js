"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { candidateId } = require("../scripts/classify_positions");
const { eventId } = require("../scripts/propose_events");
const { findMirrorMatch } = require("../scripts/lib/event_reconciliation");
const { buildCreatorLookup, resolveCreatorId } = require("../scripts/tag_creator_ids");

test("Serenity keeps legacy candidate and event ids", () => {
  assert.equal(candidateId("123", "NVDA", "HOLD", "serenity"), "cand-x-123-nvda-hold");
  assert.equal(eventId({ creatorId: "serenity", ticker: "NVDA", sourcePostId: "123" }, "HOLD"), "evt-nvda-123-hold");
});

test("additional creators receive collision-safe ids", () => {
  assert.equal(candidateId("123", "NVDA", "HOLD", "creator-b"), "creator-b-cand-x-123-nvda-hold");
  assert.equal(eventId({ creatorId: "creator-b", ticker: "NVDA", sourcePostId: "123" }, "HOLD"), "creator-b-evt-nvda-123-hold");
});

test("mirror reconciliation never crosses creator boundaries", () => {
  const events = [
    { creatorId: "serenity", person: "Serenity", ticker: "NVDA", type: "HOLD", date: "2026-08-25T10:00:00Z", sourceType: "secondary-mirror" },
  ];
  const other = { creatorId: "creator-b", person: "Creator B", ticker: "NVDA", sourceDate: "2026-08-25T10:01:00Z" };
  assert.equal(findMirrorMatch(events, other, "HOLD"), null);
});

test("legacy missing creatorId resolves to Serenity", () => {
  const lookup = buildCreatorLookup(
    { accounts: [{ creatorId: "serenity", person: "Serenity", handle: "aleabitoreddit" }] },
    { creators: [{ id: "serenity", displayName: "Serenity", handle: "aleabitoreddit" }] },
  );
  assert.equal(resolveCreatorId({ handle: "aleabitoreddit", person: "Serenity" }, lookup), "serenity");
  assert.equal(resolveCreatorId({ person: "Unknown Legacy" }, lookup), "serenity");
});

test("creator lookup maps a second account independently", () => {
  const lookup = buildCreatorLookup(
    { accounts: [
      { creatorId: "serenity", person: "Serenity", handle: "aleabitoreddit" },
      { creatorId: "creator-b", person: "Creator B", handle: "creator_b" },
    ] },
    { creators: [
      { id: "serenity", displayName: "Serenity", handle: "aleabitoreddit" },
      { id: "creator-b", displayName: "Creator B", handle: "creator_b" },
    ] },
  );
  assert.equal(resolveCreatorId({ handle: "creator_b", person: "Creator B" }, lookup), "creator-b");
});

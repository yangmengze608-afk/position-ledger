"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { mergeCandidate } = require("../scripts/classify_positions");

function baseCandidate(overrides = {}) {
  return {
    id: "cand-x-1-spcx-add",
    person: "Serenity",
    ticker: "SPCX",
    suggestedType: "ADD",
    confidence: "B",
    score: 0.82,
    classifier: "rules-v2.1-local",
    evidence: "I added",
    sourcePostId: "1",
    sourceUrl: "https://x.com/example/status/1",
    sourceDate: "2026-08-16T08:30:22.000Z",
    sourceText: "example",
    status: "pending",
    llm: null,
    batchId: "old-batch",
    createdAt: "2026-08-16T09:00:00.000Z",
    ...overrides,
  };
}

test("stronger A-grade result upgrades an existing pending B candidate in place", () => {
  const queued = new Map([["cand-x-1-spcx-add", baseCandidate()]]);
  const stronger = baseCandidate({
    confidence: "A",
    score: 0.99,
    classifier: "rules-v2.2-list",
    evidence: "This week I added to the following stocks:",
    batchId: "new-batch",
  });
  assert.equal(mergeCandidate(queued, stronger), "upgraded");
  const item = queued.get(stronger.id);
  assert.equal(item.confidence, "A");
  assert.equal(item.score, 0.99);
  assert.equal(item.classifier, "rules-v2.2-list");
  assert.equal(item.batchId, "new-batch");
  assert.equal(item.status, "pending");
});

test("weaker result never downgrades a pending candidate", () => {
  const queued = new Map([["cand-x-1-spcx-add", baseCandidate({ confidence: "A", score: 0.99 })]]);
  assert.equal(mergeCandidate(queued, baseCandidate({ confidence: "B", score: 0.82 })), "unchanged");
  assert.equal(queued.get("cand-x-1-spcx-add").confidence, "A");
});

test("already proposed candidate is immutable even if a stronger rule appears", () => {
  const queued = new Map([["cand-x-1-spcx-add", baseCandidate({ status: "proposed" })]]);
  const stronger = baseCandidate({ confidence: "A", score: 0.99, classifier: "rules-v2.2-list" });
  assert.equal(mergeCandidate(queued, stronger), "unchanged");
  assert.equal(queued.get(stronger.id).confidence, "B");
});

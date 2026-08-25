#!/usr/bin/env node
"use strict";

const fs = require("fs/promises");
const path = require("path");
const { classifyPost } = require("./lib/position_rules");
const { DEFAULT_CREATOR_ID, creatorIdOf, legacyCompatibleId } = require("./lib/creator_identity");

const ROOT = path.resolve(__dirname, "..");
const RAW_PATH = path.join(ROOT, "data", "raw_posts.json");
const EVENTS_PATH = path.join(ROOT, "data", "events.json");
const QUEUE_PATH = path.join(ROOT, "data", "review_queue.json");
const BATCH_ID = process.env.POSITION_DISCOVERY_BATCH || "";
const CONFIDENCE_RANK = { C: 1, B: 2, A: 3 };

async function readJson(file, fallback) {
  try { return JSON.parse(await fs.readFile(file, "utf8")); }
  catch { return fallback; }
}

function candidateId(postId, ticker, type, creatorId = DEFAULT_CREATOR_ID) {
  const base = `cand-x-${postId}-${ticker.toLowerCase()}-${type.toLowerCase()}`;
  return legacyCompatibleId(base, creatorId);
}

function eventKey(value, sourcePostId, ticker, type) {
  return `${creatorIdOf(value)}|${sourcePostId || ""}|${ticker}|${type}`;
}

function isStronger(existing, candidate) {
  const oldRank = CONFIDENCE_RANK[existing.confidence] || 0;
  const newRank = CONFIDENCE_RANK[candidate.confidence] || 0;
  if (newRank !== oldRank) return newRank > oldRank;
  return Number(candidate.score || 0) > Number(existing.score || 0) + 1e-9;
}

function mergeCandidate(queued, candidate) {
  const existing = queued.get(candidate.id);
  if (!existing) {
    queued.set(candidate.id, candidate);
    return "added";
  }
  if (existing.status !== "pending" || !isStronger(existing, candidate)) return "unchanged";

  Object.assign(existing, {
    creatorId: candidate.creatorId,
    person: candidate.person,
    confidence: candidate.confidence,
    score: candidate.score,
    classifier: candidate.classifier,
    evidence: candidate.evidence,
    company: candidate.company || existing.company || null,
    exchange: candidate.exchange || existing.exchange || null,
    marketSymbol: candidate.marketSymbol || existing.marketSymbol || null,
    entityMention: candidate.entityMention || existing.entityMention || null,
    sourceCode: candidate.sourceCode || existing.sourceCode || null,
    entityWarning: candidate.entityWarning || null,
    sourceUrl: candidate.sourceUrl,
    sourceDate: candidate.sourceDate,
    sourceText: candidate.sourceText,
    batchId: candidate.batchId,
    llm: null,
    updatedAt: new Date().toISOString(),
  });
  return "upgraded";
}

async function main() {
  const raw = await readJson(RAW_PATH, { posts: [] });
  const eventPayload = await readJson(EVENTS_PATH, { events: [] });
  const queuePayload = await readJson(QUEUE_PATH, { items: [] });
  const eventKeys = new Set((eventPayload.events || []).map((e) => eventKey(e, e.sourcePostId, e.ticker, e.type)));
  const queued = new Map((queuePayload.items || []).map((item) => [item.id, item]));
  let added = 0;
  let upgraded = 0;

  for (const post of raw.posts || []) {
    const creatorId = creatorIdOf(post);
    for (const result of classifyPost(post)) {
      const key = eventKey({ creatorId }, post.id, result.ticker, result.suggestedType);
      if (eventKeys.has(key)) continue;
      const id = candidateId(post.id, result.ticker, result.suggestedType, creatorId);
      const now = new Date().toISOString();
      const candidate = {
        id,
        creatorId,
        person: post.person,
        ticker: result.ticker,
        suggestedType: result.suggestedType,
        confidence: result.confidence,
        score: result.score,
        classifier: result.classifier,
        evidence: result.evidence,
        company: result.company || null,
        exchange: result.exchange || null,
        marketSymbol: result.marketSymbol || null,
        entityMention: result.entityMention || null,
        sourceCode: result.sourceCode || null,
        entityWarning: result.entityWarning || null,
        sourcePostId: post.id,
        sourceUrl: post.sourceUrl,
        sourceDate: post.createdAt,
        sourceText: post.text,
        status: "pending",
        llm: null,
        batchId: BATCH_ID || null,
        createdAt: now,
      };
      const outcome = mergeCandidate(queued, candidate);
      if (outcome === "added") added += 1;
      if (outcome === "upgraded") upgraded += 1;
    }
  }

  const items = [...queued.values()].sort((a, b) => b.sourceDate.localeCompare(a.sourceDate));
  if (added === 0 && upgraded === 0) {
    console.log(`[classify] queue unchanged=${items.length}; added=0 upgraded=0`);
    return;
  }
  queuePayload.schemaVersion = Math.max(Number(queuePayload.schemaVersion || 1), 2);
  queuePayload.generatedAt = new Date().toISOString();
  queuePayload.items = items;
  await fs.writeFile(QUEUE_PATH, JSON.stringify(queuePayload, null, 2) + "\n");
  console.log(`[classify] queue=${items.length}; added=${added} upgraded=${upgraded}`);
}

if (require.main === module) {
  main().catch((error) => { console.error(error); process.exit(1); });
}

module.exports = { candidateId, eventKey, isStronger, mergeCandidate };

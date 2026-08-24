#!/usr/bin/env node
"use strict";

const fs = require("fs/promises");
const path = require("path");
const { classifyPost } = require("./lib/position_rules");

const ROOT = path.resolve(__dirname, "..");
const RAW_PATH = path.join(ROOT, "data", "raw_posts.json");
const EVENTS_PATH = path.join(ROOT, "data", "events.json");
const QUEUE_PATH = path.join(ROOT, "data", "review_queue.json");

async function readJson(file, fallback) {
  try { return JSON.parse(await fs.readFile(file, "utf8")); }
  catch { return fallback; }
}

function candidateId(postId, ticker, type) {
  return `cand-x-${postId}-${ticker.toLowerCase()}-${type.toLowerCase()}`;
}

async function main() {
  const raw = await readJson(RAW_PATH, { posts: [] });
  const eventPayload = await readJson(EVENTS_PATH, { events: [] });
  const queuePayload = await readJson(QUEUE_PATH, { items: [] });
  const eventKeys = new Set((eventPayload.events || []).map((e) => `${e.sourcePostId || ""}|${e.ticker}|${e.type}`));
  const queued = new Map((queuePayload.items || []).map((item) => [item.id, item]));
  let added = 0;

  for (const post of raw.posts || []) {
    for (const result of classifyPost(post)) {
      const key = `${post.id}|${result.ticker}|${result.suggestedType}`;
      if (eventKeys.has(key)) continue;
      const id = candidateId(post.id, result.ticker, result.suggestedType);
      if (queued.has(id)) continue;
      queued.set(id, {
        id,
        person: post.person,
        ticker: result.ticker,
        suggestedType: result.suggestedType,
        confidence: result.confidence,
        score: result.score,
        classifier: result.classifier,
        evidence: result.evidence,
        sourcePostId: post.id,
        sourceUrl: post.sourceUrl,
        sourceDate: post.createdAt,
        sourceText: post.text,
        status: "pending",
        llm: null,
        createdAt: new Date().toISOString(),
      });
      added += 1;
    }
  }

  const items = [...queued.values()].sort((a, b) => b.sourceDate.localeCompare(a.sourceDate));
  if (added === 0) {
    console.log(`[classify] queue unchanged=${items.length}; added=0`);
    return;
  }
  await fs.writeFile(QUEUE_PATH, JSON.stringify({ schemaVersion: 1, generatedAt: new Date().toISOString(), items }, null, 2) + "\n");
  console.log(`[classify] queue=${items.length}; added=${added}`);
}

main().catch((error) => { console.error(error); process.exit(1); });

#!/usr/bin/env node
"use strict";

const fs = require("fs/promises");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const EVENTS_PATH = path.join(ROOT, "data", "events.json");
const QUEUE_PATH = path.join(ROOT, "data", "review_queue.json");
const AUTO_SCORE = Number(process.env.POSITION_AUTO_SCORE || 0.95);

async function readJson(file, fallback) {
  try { return JSON.parse(await fs.readFile(file, "utf8")); }
  catch { return fallback; }
}

function canPromote(item) {
  const llm = item.llm;
  if (llm) {
    return llm.explicit === true && llm.event_type !== "IGNORE" && Number(llm.confidence || 0) >= AUTO_SCORE;
  }
  return item.confidence === "A" && Number(item.score || 0) >= AUTO_SCORE;
}

function eventType(item) {
  return item.llm?.event_type || item.suggestedType;
}

function eventId(item, type) {
  return `evt-${item.ticker.toLowerCase()}-${item.sourcePostId}-${type.toLowerCase()}`;
}

async function main() {
  const eventPayload = await readJson(EVENTS_PATH, { schemaVersion: 1, events: [] });
  const queuePayload = await readJson(QUEUE_PATH, { schemaVersion: 1, items: [] });
  const events = eventPayload.events || [];
  const existingIds = new Set(events.map((e) => e.id));
  const previousByTicker = new Map();
  for (const event of events) previousByTicker.set(event.ticker, event);
  let proposed = 0;
  let changed = false;

  for (const item of queuePayload.items || []) {
    if (item.status !== "pending" || !canPromote(item)) continue;
    const type = eventType(item);
    const id = eventId(item, type);
    if (existingIds.has(id)) {
      if (item.status !== "proposed") { item.status = "proposed"; changed = true; }
      continue;
    }
    const previous = previousByTicker.get(item.ticker) || {};
    events.push({
      id,
      person: item.person,
      ticker: item.ticker,
      company: previous.company || item.ticker,
      exchange: previous.exchange || "",
      type,
      date: item.sourceDate,
      confidence: "A",
      summary: `自动发现的公开持仓披露：${(item.llm?.reason || item.evidence || type).slice(0, 180)}`,
      sourceUrl: item.sourceUrl,
      sourceType: "x-original",
      sourcePostId: item.sourcePostId,
      sourceText: item.sourceText,
      note: "V2 自动提议；以 PR 合并作为人工验收",
      classifier: item.llm ? "llm+rules-v2" : "rules-v2"
    });
    existingIds.add(id);
    previousByTicker.set(item.ticker, events[events.length - 1]);
    item.status = "proposed";
    item.proposedEventId = id;
    proposed += 1;
    changed = true;
  }

  if (!changed) {
    console.log(`[propose] unchanged; events=${events.length}`);
    return;
  }

  events.sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  queuePayload.generatedAt = new Date().toISOString();
  eventPayload.events = events;
  await fs.writeFile(EVENTS_PATH, JSON.stringify(eventPayload, null, 2) + "\n");
  await fs.writeFile(QUEUE_PATH, JSON.stringify(queuePayload, null, 2) + "\n");
  console.log(`[propose] proposed=${proposed}; events=${events.length}`);
}

main().catch((error) => { console.error(error); process.exit(1); });

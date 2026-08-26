#!/usr/bin/env node
"use strict";

const fs = require("fs/promises");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const RAW_PATH = path.join(ROOT, "data", "raw_posts.json");
const EVENTS_PATH = path.join(ROOT, "data", "events.json");
const QUEUE_PATH = path.join(ROOT, "data", "review_queue.json");

async function readJson(file, fallback) {
  try { return JSON.parse(await fs.readFile(file, "utf8")); }
  catch { return fallback; }
}

function canonicalFirstPartySourceDates(rawPayload) {
  const dates = new Map();
  for (const post of rawPayload?.posts || []) {
    if (!post?.id || !post?.createdAt) continue;
    if (!String(post.sourceProvider || "").startsWith("first-party-web:")) continue;
    if (post.portfolioSnapshot?.complete !== true) continue;
    dates.set(String(post.id), {
      createdAt: String(post.createdAt),
      precision: post.sourceDatePrecision || null,
    });
  }
  return dates;
}

function reconcileSourceDates(rawPayload, eventPayload, queuePayload) {
  const dates = canonicalFirstPartySourceDates(rawPayload);
  let eventsChanged = 0;
  let queueChanged = 0;

  for (const event of eventPayload?.events || []) {
    const source = dates.get(String(event.sourcePostId || ""));
    if (!source) continue;
    if (event.date !== source.createdAt) {
      event.date = source.createdAt;
      eventsChanged += 1;
    }
    if (source.precision && event.sourceDatePrecision !== source.precision) {
      event.sourceDatePrecision = source.precision;
      eventsChanged += 1;
    }
  }

  for (const item of queuePayload?.items || []) {
    const source = dates.get(String(item.sourcePostId || ""));
    if (!source) continue;
    if (item.sourceDate !== source.createdAt) {
      item.sourceDate = source.createdAt;
      queueChanged += 1;
    }
    if (source.precision && item.sourceDatePrecision !== source.precision) {
      item.sourceDatePrecision = source.precision;
      queueChanged += 1;
    }
  }

  return { eventsChanged, queueChanged, sourceCount: dates.size };
}

async function main() {
  const [raw, events, queue] = await Promise.all([
    readJson(RAW_PATH, { posts: [] }),
    readJson(EVENTS_PATH, { events: [] }),
    readJson(QUEUE_PATH, { items: [] }),
  ]);
  const result = reconcileSourceDates(raw, events, queue);
  if (result.eventsChanged === 0 && result.queueChanged === 0) {
    console.log(`[source-date] unchanged; first-party-sources=${result.sourceCount}`);
    return;
  }
  await Promise.all([
    fs.writeFile(EVENTS_PATH, JSON.stringify(events, null, 2) + "\n", "utf8"),
    fs.writeFile(QUEUE_PATH, JSON.stringify(queue, null, 2) + "\n", "utf8"),
  ]);
  console.log(`[source-date] events=${result.eventsChanged} queue=${result.queueChanged} first-party-sources=${result.sourceCount}`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = { canonicalFirstPartySourceDates, reconcileSourceDates };

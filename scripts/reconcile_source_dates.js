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

function isFirstPartyCompletePortfolio(post) {
  return Boolean(
    post?.id
    && post?.createdAt
    && String(post.sourceProvider || "").startsWith("first-party-web:")
    && post.portfolioSnapshot?.complete === true
  );
}

function normalizeFirstPartyDateOnlyPosts(rawPayload) {
  let changed = 0;
  for (const post of rawPayload?.posts || []) {
    if (!isFirstPartyCompletePortfolio(post)) continue;
    const value = String(post.createdAt);
    const midnight = value.match(/^(\d{4}-\d{2}-\d{2})T00:00:00(?:\.000)?Z$/);
    if (midnight) {
      post.createdAt = `${midnight[1]}T12:00:00.000Z`;
      changed += 1;
    }
    if (post.sourceDatePrecision !== "day") {
      post.sourceDatePrecision = "day";
      changed += 1;
    }
  }
  return changed;
}

function canonicalFirstPartySourceDates(rawPayload) {
  const dates = new Map();
  for (const post of rawPayload?.posts || []) {
    if (!isFirstPartyCompletePortfolio(post)) continue;
    dates.set(String(post.id), {
      createdAt: String(post.createdAt),
      precision: post.sourceDatePrecision || null,
    });
  }
  return dates;
}

function reconcileSourceDates(rawPayload, eventPayload, queuePayload) {
  const rawChanged = normalizeFirstPartyDateOnlyPosts(rawPayload);
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

  return { rawChanged, eventsChanged, queueChanged, sourceCount: dates.size };
}

async function main() {
  const [raw, events, queue] = await Promise.all([
    readJson(RAW_PATH, { posts: [] }),
    readJson(EVENTS_PATH, { events: [] }),
    readJson(QUEUE_PATH, { items: [] }),
  ]);
  const result = reconcileSourceDates(raw, events, queue);
  if (result.rawChanged === 0 && result.eventsChanged === 0 && result.queueChanged === 0) {
    console.log(`[source-date] unchanged; first-party-sources=${result.sourceCount}`);
    return;
  }
  const writes = [];
  if (result.rawChanged) writes.push(fs.writeFile(RAW_PATH, JSON.stringify(raw, null, 2) + "\n", "utf8"));
  if (result.eventsChanged) writes.push(fs.writeFile(EVENTS_PATH, JSON.stringify(events, null, 2) + "\n", "utf8"));
  if (result.queueChanged) writes.push(fs.writeFile(QUEUE_PATH, JSON.stringify(queue, null, 2) + "\n", "utf8"));
  await Promise.all(writes);
  console.log(`[source-date] raw=${result.rawChanged} events=${result.eventsChanged} queue=${result.queueChanged} first-party-sources=${result.sourceCount}`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = {
  isFirstPartyCompletePortfolio,
  normalizeFirstPartyDateOnlyPosts,
  canonicalFirstPartySourceDates,
  reconcileSourceDates,
};

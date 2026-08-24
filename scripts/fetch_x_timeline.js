#!/usr/bin/env node
"use strict";

const fs = require("fs/promises");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const CONFIG_PATH = path.join(ROOT, "data", "source_accounts.json");
const OUT_PATH = path.join(ROOT, "data", "raw_posts.json");
const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/124 Safari/537.36";
const MAX_POSTS = Number(process.env.POSITION_LEDGER_RAW_MAX || 500);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function readJson(file, fallback) {
  try { return JSON.parse(await fs.readFile(file, "utf8")); }
  catch { return fallback; }
}

function cleanText(tweet) {
  let text = tweet.full_text || tweet.text || "";
  for (const url of tweet.entities?.urls || []) {
    if (url.url && url.display_url) text = text.split(url.url).join(url.display_url);
  }
  for (const media of tweet.extended_entities?.media || tweet.entities?.media || []) {
    if (media.url) text = text.split(media.url).join("");
  }
  return text.replace(/\s+\n/g, "\n").trim();
}

async function fetchTimeline(account) {
  const showReplies = account.includeReplies !== false ? "true" : "false";
  const url = `https://syndication.twitter.com/srv/timeline-profile/screen-name/${encodeURIComponent(account.handle)}?showReplies=${showReplies}`;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const response = await fetch(url, { headers: { "user-agent": UA, accept: "text/html" } });
    if (response.ok) return response.text();
    if (response.status !== 429) throw new Error(`HTTP ${response.status}`);
    await sleep(2500 * (attempt + 1));
  }
  throw new Error("HTTP 429 after retries");
}

function parseTimeline(html, account) {
  const match = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
  if (!match) throw new Error("missing __NEXT_DATA__");
  const data = JSON.parse(match[1]);
  const entries = data?.props?.pageProps?.timeline?.entries || [];
  const cutoff = Date.now() - Number(account.maxAgeDays || 14) * 86400000;
  const posts = [];

  for (const entry of entries) {
    const tweet = entry?.content?.tweet;
    if (!tweet?.id_str || tweet.retweeted_status) continue;
    const user = tweet.user || {};
    if ((user.screen_name || "").toLowerCase() !== account.handle.toLowerCase()) continue;
    const created = new Date(tweet.created_at || "");
    if (!Number.isFinite(created.getTime()) || created.getTime() < cutoff) continue;
    posts.push({
      id: tweet.id_str,
      person: account.person,
      platform: "x",
      handle: user.screen_name || account.handle,
      createdAt: created.toISOString(),
      text: cleanText(tweet),
      sourceUrl: tweet.permalink
        ? `https://x.com${tweet.permalink}`
        : `https://x.com/${user.screen_name || account.handle}/status/${tweet.id_str}`,
      cashtags: (tweet.entities?.symbols || []).map((symbol) => symbol.text).filter(Boolean),
      isReply: Boolean(tweet.in_reply_to_status_id_str || tweet.in_reply_to_screen_name),
      discoveredAt: new Date().toISOString(),
    });
  }
  return posts.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

async function main() {
  const config = await readJson(CONFIG_PATH, { accounts: [] });
  const existingPayload = await readJson(OUT_PATH, { schemaVersion: 1, posts: [] });
  const byId = new Map((existingPayload.posts || []).map((post) => [post.id, post]));
  let fetched = 0;

  for (const account of (config.accounts || []).filter((a) => a.enabled && a.platform === "x")) {
    try {
      const html = await fetchTimeline(account);
      const posts = parseTimeline(html, account);
      for (const post of posts) {
        if (!byId.has(post.id)) {
          byId.set(post.id, post);
          fetched += 1;
        }
      }
      console.log(`[x] ${account.handle}: ${posts.length} recent, ${fetched} new total`);
    } catch (error) {
      console.warn(`[x] ${account.handle}: ${error.message}`);
    }
    await sleep(1200);
  }

  const posts = [...byId.values()]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, MAX_POSTS);
  if (fetched === 0) {
    console.log(`[x] raw store unchanged: ${posts.length} posts; 0 added`);
    return;
  }
  await fs.writeFile(OUT_PATH, JSON.stringify({ schemaVersion: 1, generatedAt: new Date().toISOString(), posts }, null, 2) + "\n");
  console.log(`[x] raw store: ${posts.length} posts; ${fetched} added`);
}

main().catch((error) => { console.error(error); process.exit(1); });

#!/usr/bin/env node
"use strict";

const fs = require("fs/promises");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const CONFIG_PATH = path.join(ROOT, "data", "source_accounts.json");
const OUT_PATH = path.join(ROOT, "data", "raw_posts.json");
const REPORT_PATH = process.env.POSITION_LEDGER_REPORT_PATH || "";
const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/124 Safari/537.36";
const MAX_POSTS = Number(process.env.POSITION_LEDGER_RAW_MAX || 500);
const NITTER_INSTANCES = (process.env.NITTER_INSTANCES || "xcancel.com,nitter.poast.org,nitter.privacyredirect.com")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function readJson(file, fallback) {
  try { return JSON.parse(await fs.readFile(file, "utf8")); }
  catch { return fallback; }
}

async function writeReport(report) {
  if (!REPORT_PATH) return;
  await fs.writeFile(REPORT_PATH, JSON.stringify(report, null, 2) + "\n", "utf8");
}

function decodeEntities(value = "") {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)));
}

function stripHtml(value = "") {
  return decodeEntities(value)
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/<\/p\s*>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/\r/g, "")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

function extractLetterCashtags(text = "") {
  const seen = new Set();
  for (const match of text.matchAll(/\$([A-Za-z][A-Za-z0-9.-]{0,14})\b/g)) {
    seen.add(match[1].toUpperCase());
  }
  return [...seen];
}

function canonicalXUrl(value, handle, id) {
  if (id) return `https://x.com/${handle}/status/${id}`;
  if (!value) return "";
  return value
    .replace(/^https?:\/\/(?:www\.)?twitter\.com\//i, "https://x.com/")
    .replace(/^https?:\/\/(?:www\.)?(?:xcancel\.com|nitter\.[^/]+)\//i, "https://x.com/");
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

async function fetchText(url, { attempts = 2, accept = "text/html" } = {}) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: {
          "user-agent": UA,
          accept,
          "accept-language": "en-US,en;q=0.8",
          "cache-control": "no-cache",
        },
      });
      if (response.ok) return await response.text();
      lastError = new Error(`HTTP ${response.status}`);
      if (response.status !== 429 && response.status < 500) break;
    } catch (error) {
      lastError = error;
    }
    await sleep(1200 * (attempt + 1));
  }
  throw lastError || new Error("fetch failed");
}

function cutoffFor(account) {
  return Date.now() - Number(account.maxAgeDays || 14) * 86400000;
}

function parseLooseDate(value = "") {
  return new Date(value.replace(/\s*[·•]\s*/g, " ").replace(/\s+/g, " ").trim());
}

function parseSyndication(html, account) {
  const match = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
  if (!match) throw new Error("missing __NEXT_DATA__");
  const data = JSON.parse(match[1]);
  const entries = data?.props?.pageProps?.timeline?.entries || [];
  const cutoff = cutoffFor(account);
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
      sourceUrl: canonicalXUrl(tweet.permalink ? `https://twitter.com${tweet.permalink}` : "", user.screen_name || account.handle, tweet.id_str),
      cashtags: (tweet.entities?.symbols || []).map((symbol) => symbol.text).filter(Boolean),
      isReply: Boolean(tweet.in_reply_to_status_id_str || tweet.in_reply_to_screen_name),
      sourceProvider: "x-syndication",
      discoveredAt: new Date().toISOString(),
    });
  }
  return posts.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

async function fetchSyndication(account) {
  const showReplies = account.includeReplies !== false ? "true" : "false";
  const query = new URLSearchParams({ showReplies, with_replies: showReplies, dnt: "true", lang: "en" });
  const url = `https://syndication.twitter.com/srv/timeline-profile/screen-name/${encodeURIComponent(account.handle)}?${query}`;
  const html = await fetchText(url, { attempts: 4 });
  return parseSyndication(html, account);
}

function getXmlTag(block, tag) {
  const match = block.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return match ? decodeEntities(match[1]).trim() : "";
}

function parseFxRss(xml, account) {
  const cutoff = cutoffFor(account);
  const posts = [];
  const items = [...xml.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi)].map((match) => match[1]);

  for (const item of items) {
    const guid = getXmlTag(item, "guid");
    const link = getXmlTag(item, "link") || guid;
    const idMatch = (guid || link).match(/\/status\/(\d+)/);
    if (!idMatch) continue;
    const created = new Date(getXmlTag(item, "pubDate"));
    if (!Number.isFinite(created.getTime()) || created.getTime() < cutoff) continue;
    const descriptionRaw = getXmlTag(item, "description");
    const title = stripHtml(getXmlTag(item, "title"));
    const text = stripHtml(descriptionRaw) || title;
    if (!text) continue;

    posts.push({
      id: idMatch[1],
      person: account.person,
      platform: "x",
      handle: account.handle,
      createdAt: created.toISOString(),
      text,
      sourceUrl: canonicalXUrl(link || guid, account.handle, idMatch[1]),
      // Fx RSS is not guaranteed to preserve X cashtag entities. Keep numeric
      // cashtags out of the fallback path so values like "$2000" cannot become tickers.
      cashtags: extractLetterCashtags(text),
      isReply: /\breplying to\b/i.test(title) || /\breplying to\b/i.test(text),
      sourceProvider: "fxembed-rss",
      discoveredAt: new Date().toISOString(),
    });
  }
  return posts.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

async function fetchFxRss(account) {
  const query = new URLSearchParams({
    count: "100",
    with_replies: account.includeReplies === false ? "0" : "1",
    safe: "1",
  });
  const url = `https://fxtwitter.com/${encodeURIComponent(account.handle)}/feed.xml?${query}`;
  const xml = await fetchText(url, { attempts: 3, accept: "application/rss+xml, application/xml;q=0.9, text/xml;q=0.8, */*;q=0.5" });
  const posts = parseFxRss(xml, account);
  if (!/<rss\b|<feed\b/i.test(xml)) throw new Error("unexpected FxEmbed feed response");
  return posts;
}

function extractAttr(tag, name) {
  const match = tag.match(new RegExp(`${name}=["']([^"']+)["']`, "i"));
  return match ? decodeEntities(match[1]) : "";
}

function parseNitterHtml(html, account, instance = "nitter") {
  const cutoff = cutoffFor(account);
  const posts = [];
  const blocks = html.split(/(?=<div[^>]+class=["'][^"']*timeline-item)/i).slice(1);

  for (const block of blocks) {
    const linkTag = block.match(/<a[^>]+class=["'][^"']*tweet-link[^"']*["'][^>]*>/i)?.[0] || "";
    const href = extractAttr(linkTag, "href");
    const idMatch = href.match(/\/status\/(\d+)/);
    if (!idMatch) continue;

    const content = block.match(/<div[^>]+class=["'][^"']*tweet-content[^"']*["'][^>]*>([\s\S]*?)<\/div>/i)?.[1] || "";
    const text = stripHtml(content);
    if (!text) continue;

    const dateTag = block.match(/<a[^>]+class=["'][^"']*tweet-date[^"']*["'][^>]*>/i)?.[0]
      || block.match(/<span[^>]+class=["'][^"']*tweet-date[^"']*["'][^>]*>[\s\S]*?<a[^>]*>/i)?.[0]
      || "";
    const dateTitle = extractAttr(dateTag, "title");
    const created = parseLooseDate(dateTitle);
    if (!Number.isFinite(created.getTime()) || created.getTime() < cutoff) continue;

    posts.push({
      id: idMatch[1],
      person: account.person,
      platform: "x",
      handle: account.handle,
      createdAt: created.toISOString(),
      text,
      sourceUrl: canonicalXUrl(href, account.handle, idMatch[1]),
      cashtags: extractLetterCashtags(text),
      isReply: /replying-to/i.test(block),
      sourceProvider: `nitter-html:${instance}`,
      discoveredAt: new Date().toISOString(),
    });
  }
  return posts.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

async function fetchNitter(account) {
  const errors = [];
  for (const host of NITTER_INSTANCES) {
    const suffix = account.includeReplies === false ? "" : "/with_replies";
    const url = `https://${host}/${encodeURIComponent(account.handle)}${suffix}`;
    try {
      const html = await fetchText(url, { attempts: 2 });
      if (/cloudflare|cf-chl|just a moment/i.test(html.slice(0, 4000))) throw new Error("bot challenge");
      const posts = parseNitterHtml(html, account, host);
      if (posts.length) return posts;
      errors.push(`${host}: no recent posts parsed`);
    } catch (error) {
      errors.push(`${host}: ${error.message}`);
    }
  }
  throw new Error(`all Nitter instances failed (${errors.join("; ")})`);
}

async function fetchAccountWithFallback(account) {
  const providers = [
    ["x-syndication", fetchSyndication],
    ["fxembed-rss", fetchFxRss],
    ["nitter-html", fetchNitter],
  ];
  const attempts = [];
  let emptySuccess = null;

  for (const [name, fn] of providers) {
    const started = Date.now();
    try {
      const posts = await fn(account);
      attempts.push({ provider: name, ok: true, recent: posts.length, durationMs: Date.now() - started });
      if (posts.length) return { provider: name, posts, attempts };
      emptySuccess ||= { provider: name, posts, attempts: [...attempts] };
    } catch (error) {
      attempts.push({ provider: name, ok: false, error: error.message, durationMs: Date.now() - started });
    }
  }

  if (emptySuccess) return { ...emptySuccess, attempts };
  throw Object.assign(new Error("all collectors failed"), { attempts });
}

async function main() {
  const report = { startedAt: new Date().toISOString(), provider: "multi-source", accounts: [] };
  const config = await readJson(CONFIG_PATH, { accounts: [] });
  const existingPayload = await readJson(OUT_PATH, { schemaVersion: 1, posts: [] });
  const byId = new Map((existingPayload.posts || []).map((post) => [post.id, post]));
  let fetched = 0;

  for (const account of (config.accounts || []).filter((a) => a.enabled && a.platform === "x")) {
    const before = fetched;
    try {
      const result = await fetchAccountWithFallback(account);
      for (const post of result.posts) {
        if (!byId.has(post.id)) {
          byId.set(post.id, post);
          fetched += 1;
        }
      }
      report.accounts.push({
        handle: account.handle,
        ok: true,
        selectedProvider: result.provider,
        recent: result.posts.length,
        added: fetched - before,
        attempts: result.attempts,
      });
      console.log(`[source] ${account.handle}: ${result.posts.length} via ${result.provider}, ${fetched} new total`);
    } catch (error) {
      report.accounts.push({ handle: account.handle, ok: false, recent: 0, added: 0, error: error.message, attempts: error.attempts || [] });
      console.warn(`[source] ${account.handle}: ${error.message}`);
    }
    await sleep(800);
  }

  const posts = [...byId.values()]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, MAX_POSTS);

  report.completedAt = new Date().toISOString();
  report.added = fetched;
  report.totalStored = posts.length;
  await writeReport(report);

  if (fetched === 0) {
    console.log(`[source] raw store unchanged: ${posts.length} posts; 0 added`);
    return;
  }
  await fs.writeFile(OUT_PATH, JSON.stringify({ schemaVersion: 1, generatedAt: new Date().toISOString(), posts }, null, 2) + "\n");
  console.log(`[source] raw store: ${posts.length} posts; ${fetched} added`);
}

if (require.main === module) {
  main().catch(async (error) => {
    try {
      await writeReport({ startedAt: new Date().toISOString(), provider: "multi-source", fatal: error.message, accounts: [] });
    } catch {}
    console.error(error);
    process.exit(1);
  });
}

module.exports = {
  decodeEntities,
  stripHtml,
  extractLetterCashtags,
  parseSyndication,
  parseFxRss,
  parseNitterHtml,
  canonicalXUrl,
};

#!/usr/bin/env node
"use strict";

const fs = require("fs/promises");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const CONFIG_PATH = path.join(ROOT, "data", "source_accounts.json");
const OUT_PATH = path.join(ROOT, "data", "raw_posts.json");
const REPORT_PATH = process.env.POSITION_LEDGER_PORTFOLIO_REPORT_PATH || "";
const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/124 Safari/537.36 PositionLedger/1.0";
const MAX_POSTS = Number(process.env.POSITION_LEDGER_RAW_MAX || 500);

async function readJson(file, fallback) {
  try { return JSON.parse(await fs.readFile(file, "utf8")); }
  catch { return fallback; }
}

async function writeReport(report) {
  if (!REPORT_PATH) return;
  await fs.writeFile(REPORT_PATH, JSON.stringify(report, null, 2) + "\n", "utf8");
}

function decodeEntities(value = "") {
  return String(value)
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)));
}

function htmlToLines(html = "") {
  return decodeEntities(String(html))
    .replace(/<script\b[\s\S]*?<\/script>/gi, "\n")
    .replace(/<style\b[\s\S]*?<\/style>/gi, "\n")
    .replace(/<(?:br|hr)\b[^>]*>/gi, "\n")
    .replace(/<\/(?:p|div|li|h[1-6]|section|article|tr)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/\r/g, "")
    .split(/\n+/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

function periodFromUrl(url = "") {
  const match = String(url).match(/\/updates\/(\d{4})-(\d{2})(?:\b|\/|$)/);
  return match ? `${match[1]}-${match[2]}` : "";
}

function publishedAtFromHtml(html = "", lines = []) {
  const jsonLd = String(html).match(/["']datePublished["']\s*:\s*["']([^"']+)["']/i)?.[1];
  if (jsonLd) {
    const date = new Date(jsonLd);
    if (Number.isFinite(date.getTime())) return date.toISOString();
  }
  const time = String(html).match(/<time\b[^>]*datetime=["']([^"']+)["']/i)?.[1];
  if (time) {
    const date = new Date(time);
    if (Number.isFinite(date.getTime())) return date.toISOString();
  }
  for (const line of lines.slice(0, 80)) {
    if (!/^\d{1,2}\s+[A-Za-z]+\s+20\d{2}$/.test(line)) continue;
    const date = new Date(`${line} UTC`);
    if (Number.isFinite(date.getTime())) return date.toISOString();
  }
  return null;
}

function normalizeMarkers(tail = "") {
  const text = String(tail || "");
  const markers = [];
  if (/⭐/.test(text)) markers.push("high-conviction");
  if (/⬆(?:️)?/.test(text)) markers.push("bought-added");
  if (/⬇(?:️)?/.test(text)) markers.push("trimmed-sold");
  return markers;
}

function parsePortfolioLine(line = "") {
  const match = String(line).match(/^\s*(?:[-*•]\s*)?\$([A-Z][A-Z0-9.-]{0,14})\s*[-–—]\s*(.+?)\s*[-–—]\s*(\d+(?:\.\d+)?)%\s*(.*)$/i);
  if (!match) return null;
  const ticker = match[1].toUpperCase();
  if (ticker === "CASH") return null;
  return {
    ticker,
    name: match[2].trim(),
    weightPct: Number(match[3]),
    markers: normalizeMarkers(match[4]),
    raw: line.trim(),
  };
}

function parseTelescopePortfolio(html, account, sourceUrl) {
  const lines = htmlToLines(html);
  const completeLine = lines.find((line) => /here['’]s\s+everything\s+i\s+own\s+today/i.test(line));
  if (!completeLine) return null;

  const items = [];
  const seen = new Set();
  for (const line of lines) {
    const item = parsePortfolioLine(line);
    if (!item || seen.has(item.ticker)) continue;
    seen.add(item.ticker);
    items.push(item);
  }
  if (items.length < Number(account.minimumHoldings || 8)) return null;

  const period = periodFromUrl(sourceUrl) || completeLine.match(/\[(?:[A-Za-z]{3,9})\s+(20\d{2})\]/)?.[1] || "unknown";
  const createdAt = publishedAtFromHtml(html, lines);
  if (!createdAt) return null;
  const maxAgeDays = Number(account.maxAgeDays || 75);
  if (Date.now() - new Date(createdAt).getTime() > maxAgeDays * 86400000) return null;

  const text = [completeLine, ...items.map((item) => item.raw)].join("\n");
  return {
    id: `web-${account.creatorId}-${period}`,
    creatorId: account.creatorId,
    person: account.person,
    platform: "web",
    handle: account.handle,
    sourceAuthor: account.person,
    createdAt,
    text,
    sourceUrl,
    cashtags: items.map((item) => item.ticker),
    isReply: false,
    sourceProvider: "first-party-web:telescope-monthly",
    discoveredAt: new Date().toISOString(),
    portfolioSnapshot: {
      complete: true,
      period,
      statement: completeLine,
      items,
    },
  };
}

function monthOffset(base, offset) {
  return new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + offset, 1));
}

function renderMonthTemplate(template, date) {
  const year = String(date.getUTCFullYear());
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  return String(template).replaceAll("{YYYY}", year).replaceAll("{MM}", month);
}

function candidateUrls(account, now = new Date()) {
  if (account.url) return [account.url];
  if (!account.urlTemplate) return [];
  const count = Math.max(1, Number(account.lookbackMonths || 2));
  return Array.from({ length: count }, (_, index) => renderMonthTemplate(account.urlTemplate, monthOffset(now, -index)));
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: {
      "user-agent": UA,
      accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5",
      "accept-language": "en-US,en;q=0.8",
      "cache-control": "no-cache",
    },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return await response.text();
}

async function fetchWebPortfolio(account) {
  if (account.source !== "telescope-monthly") throw new Error(`unsupported web portfolio source: ${account.source || "missing"}`);
  const attempts = [];
  for (const url of candidateUrls(account)) {
    const started = Date.now();
    try {
      const html = await fetchText(url);
      const post = parseTelescopePortfolio(html, account, url);
      if (!post) throw new Error("no complete current portfolio snapshot parsed");
      attempts.push({ url, ok: true, holdings: post.portfolioSnapshot.items.length, durationMs: Date.now() - started });
      return { post, attempts };
    } catch (error) {
      attempts.push({ url, ok: false, error: error.message, durationMs: Date.now() - started });
    }
  }
  throw Object.assign(new Error("all first-party portfolio pages failed"), { attempts });
}

async function main() {
  const report = { startedAt: new Date().toISOString(), provider: "first-party-web", accounts: [] };
  const config = await readJson(CONFIG_PATH, { accounts: [] });
  const existing = await readJson(OUT_PATH, { schemaVersion: 1, posts: [] });
  const byId = new Map((existing.posts || []).map((post) => [post.id, post]));
  let added = 0;
  let updated = 0;

  for (const account of (config.accounts || []).filter((a) => a.enabled && a.platform === "web-portfolio")) {
    try {
      const result = await fetchWebPortfolio(account);
      const old = byId.get(result.post.id);
      const oldComparable = old ? JSON.stringify({ text: old.text, portfolioSnapshot: old.portfolioSnapshot, createdAt: old.createdAt, sourceUrl: old.sourceUrl }) : null;
      const newComparable = JSON.stringify({ text: result.post.text, portfolioSnapshot: result.post.portfolioSnapshot, createdAt: result.post.createdAt, sourceUrl: result.post.sourceUrl });
      if (!old) {
        byId.set(result.post.id, result.post);
        added += 1;
      } else if (oldComparable !== newComparable) {
        byId.set(result.post.id, { ...old, ...result.post, discoveredAt: new Date().toISOString() });
        updated += 1;
      }
      report.accounts.push({ creatorId: account.creatorId, ok: true, snapshotId: result.post.id, holdings: result.post.portfolioSnapshot.items.length, added: !old, updated: Boolean(old && oldComparable !== newComparable), attempts: result.attempts });
      console.log(`[portfolio] ${account.creatorId}: ${result.post.portfolioSnapshot.items.length} holdings from ${result.post.sourceUrl}`);
    } catch (error) {
      report.accounts.push({ creatorId: account.creatorId, ok: false, error: error.message, attempts: error.attempts || [] });
      console.warn(`[portfolio] ${account.creatorId}: ${error.message}`);
    }
  }

  const posts = [...byId.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, MAX_POSTS);
  report.completedAt = new Date().toISOString();
  report.added = added;
  report.updated = updated;
  report.totalStored = posts.length;
  await writeReport(report);

  if (added === 0 && updated === 0) {
    console.log(`[portfolio] raw store unchanged: ${posts.length} posts`);
    return;
  }
  await fs.writeFile(OUT_PATH, JSON.stringify({ schemaVersion: Math.max(Number(existing.schemaVersion || 1), 2), generatedAt: new Date().toISOString(), posts }, null, 2) + "\n", "utf8");
  console.log(`[portfolio] raw store: ${posts.length}; added=${added} updated=${updated}`);
}

if (require.main === module) {
  main().catch(async (error) => {
    try { await writeReport({ startedAt: new Date().toISOString(), provider: "first-party-web", fatal: error.message, accounts: [] }); } catch {}
    console.error(error);
    process.exit(1);
  });
}

module.exports = {
  htmlToLines,
  parsePortfolioLine,
  publishedAtFromHtml,
  parseTelescopePortfolio,
  candidateUrls,
  renderMonthTemplate,
};

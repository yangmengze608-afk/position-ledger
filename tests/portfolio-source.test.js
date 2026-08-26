"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  parsePortfolioLine,
  parseTelescopePortfolio,
  candidateUrls,
} = require("../scripts/fetch_public_portfolios.js");
const { classifyPortfolioSnapshot } = require("../scripts/lib/portfolio_snapshot_rules.js");
const { canonicalSourceType } = require("../scripts/propose_events.js");
const {
  normalizeFirstPartyDateOnlyPosts,
  reconcileSourceDates,
} = require("../scripts/reconcile_source_dates.js");

const account = {
  creatorId: "luke-hallard",
  person: "Luke Hallard",
  handle: "7LukeHallard",
  source: "telescope-monthly",
  maxAgeDays: 9999,
  minimumHoldings: 3,
};

test("portfolio line parser preserves weights and action markers", () => {
  assert.deepEqual(parsePortfolioLine("$AXON - Axon - 2.7% ⭐⬆️"), {
    ticker: "AXON",
    name: "Axon",
    weightPct: 2.7,
    markers: ["high-conviction", "bought-added"],
    raw: "$AXON - Axon - 2.7% ⭐⬆️",
  });
  assert.equal(parsePortfolioLine("$CASH - Cash - 20.3%"), null);
});

test("Telescope parser requires explicit complete-portfolio language and extracts first-party snapshot", () => {
  const html = `<!doctype html><html><head>
    <script type="application/ld+json">{"datePublished":"2026-08-15T00:00:00Z"}</script>
  </head><body>
    <h1>Portfolio Update (Aug 2026)</h1>
    <p>I've generated a strong long-term return. Here's everything I own today: [Aug 2026]</p>
    <p>⭐ = high conviction ⬆️ = bought / added ⬇️ = trimmed / sold</p>
    <ul>
      <li>$CASH - Cash - 20.3%</li>
      <li>$GOOGL - Alphabet - 11.8%</li>
      <li>$AXON - Axon - 2.7% ⭐⬆️</li>
      <li>$IIND - India ETF - 1.1% ⬇️</li>
    </ul>
  </body></html>`;
  const post = parseTelescopePortfolio(html, account, "https://telescopeinvesting.com/updates/2026-08");
  assert.ok(post);
  assert.equal(post.id, "web-luke-hallard-2026-08");
  assert.equal(post.creatorId, "luke-hallard");
  assert.equal(post.sourceProvider, "first-party-web:telescope-monthly");
  assert.equal(post.portfolioSnapshot.complete, true);
  assert.equal(post.portfolioSnapshot.period, "2026-08");
  assert.deepEqual(post.cashtags, ["GOOGL", "AXON", "IIND"]);
  assert.equal(post.portfolioSnapshot.items.length, 3);
  assert.equal(post.portfolioSnapshot.items[0].weightPct, 11.8);
});

test("Telescope parser fails closed without complete-portfolio language", () => {
  const html = `<html><body><time datetime="2026-08-15">15 August 2026</time><li>$GOOGL - Alphabet - 11.8%</li><li>$AXON - Axon - 2.7%</li><li>$IIND - India ETF - 1.1%</li></body></html>`;
  assert.equal(parseTelescopePortfolio(html, account, "https://telescopeinvesting.com/updates/2026-08"), null);
});

test("complete portfolio snapshot maps hold, add and reduce conservatively", () => {
  const post = {
    portfolioSnapshot: {
      complete: true,
      period: "2026-08",
      statement: "Here's everything I own today: [Aug 2026]",
      items: [
        { ticker: "GOOGL", name: "Alphabet", weightPct: 11.8, markers: [], raw: "$GOOGL - Alphabet - 11.8%" },
        { ticker: "ASTS", name: "AST SpaceMobile", weightPct: 2.8, markers: ["bought-added"], raw: "$ASTS - AST SpaceMobile - 2.8% ⬆️" },
        { ticker: "IIND", name: "India ETF", weightPct: 1.1, markers: ["trimmed-sold"], raw: "$IIND - India ETF - 1.1% ⬇️" },
        { ticker: "CASH", name: "Cash", weightPct: 20.3, markers: [], raw: "$CASH - Cash - 20.3%" },
      ],
    },
  };
  const results = classifyPortfolioSnapshot(post);
  assert.equal(results.length, 3);
  const byTicker = new Map(results.map((item) => [item.ticker, item]));
  assert.equal(byTicker.get("GOOGL").suggestedType, "HOLD");
  assert.equal(byTicker.get("ASTS").suggestedType, "ADD");
  assert.equal(byTicker.get("IIND").suggestedType, "REDUCE");
  assert.equal(byTicker.get("GOOGL").confidence, "A");
  assert.equal(byTicker.get("GOOGL").disclosedWeightPct, 11.8);
  assert.equal(byTicker.get("ASTS").snapshotPeriod, "2026-08");
});

test("date-only first-party portfolio disclosure normalizes to noon UTC and reconciles canonical timestamps", () => {
  const raw = {
    posts: [{
      id: "web-luke-hallard-2026-08",
      createdAt: "2026-08-15T00:00:00.000Z",
      sourceProvider: "first-party-web:telescope-monthly",
      portfolioSnapshot: { complete: true },
    }],
  };
  const events = {
    events: [{
      id: "luke-hallard-evt-spcx-web-luke-hallard-2026-08-add",
      sourcePostId: "web-luke-hallard-2026-08",
      date: "2026-08-15T00:00:00.000Z",
    }],
  };
  const queue = {
    items: [{
      id: "luke-hallard-cand-web-luke-hallard-2026-08-spcx-add",
      sourcePostId: "web-luke-hallard-2026-08",
      sourceDate: "2026-08-15T00:00:00.000Z",
    }],
  };

  const result = reconcileSourceDates(raw, events, queue);
  assert.equal(raw.posts[0].createdAt, "2026-08-15T12:00:00.000Z");
  assert.equal(raw.posts[0].sourceDatePrecision, "day");
  assert.equal(events.events[0].date, "2026-08-15T12:00:00.000Z");
  assert.equal(events.events[0].sourceDatePrecision, "day");
  assert.equal(queue.items[0].sourceDate, "2026-08-15T12:00:00.000Z");
  assert.equal(queue.items[0].sourceDatePrecision, "day");
  assert.ok(result.rawChanged > 0);
  assert.ok(result.eventsChanged > 0);
  assert.ok(result.queueChanged > 0);
});

test("precise non-midnight first-party disclosure timestamp is preserved", () => {
  const raw = {
    posts: [{
      id: "web-example-precise",
      createdAt: "2026-08-15T18:42:11.000Z",
      sourceProvider: "first-party-web:example",
      portfolioSnapshot: { complete: true },
    }],
  };
  assert.equal(normalizeFirstPartyDateOnlyPosts(raw), 0);
  assert.equal(raw.posts[0].createdAt, "2026-08-15T18:42:11.000Z");
  assert.equal(raw.posts[0].sourceDatePrecision, undefined);
});

test("web portfolio source is canonical first-party portfolio provenance", () => {
  assert.equal(canonicalSourceType({ sourceProvider: "first-party-web:telescope-monthly" }), "first-party-portfolio");
  assert.equal(canonicalSourceType({ sourceProvider: "fxembed-rss" }), "x-original");
});

test("monthly URL discovery tries current then previous month", () => {
  const urls = candidateUrls({ urlTemplate: "https://example.test/updates/{YYYY}-{MM}", lookbackMonths: 2 }, new Date("2026-08-26T00:00:00Z"));
  assert.deepEqual(urls, ["https://example.test/updates/2026-08", "https://example.test/updates/2026-07"]);
});

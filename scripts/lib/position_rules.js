"use strict";

const TICKER_RE = /\$([A-Z][A-Z0-9.-]{0,9})\b/g;
const POSITION_WORDS = /\b(position|positions|stake|stakes|shares?|longs?|bags?|holding|holdings|exposure)\b/i;

function extractTickers(text, entityTickers = []) {
  const found = [];
  const seen = new Set();
  for (const raw of entityTickers || []) {
    const ticker = String(raw || "").replace(/^\$/, "").toUpperCase();
    if (ticker && !seen.has(ticker)) { seen.add(ticker); found.push(ticker); }
  }
  for (const match of String(text || "").matchAll(TICKER_RE)) {
    const ticker = match[1].toUpperCase();
    if (!seen.has(ticker)) {
      seen.add(ticker);
      found.push(ticker);
    }
  }
  return found;
}

const RULES = [
  {
    type: "DENY",
    confidence: "A",
    score: 0.99,
    patterns: [
      /\b(?:i|we)\s+(?:do(?:n['’]?t| not)|did(?:n['’]?t| not))\s+(?:currently\s+)?(?:have|hold|own)\b/i,
      /\b(?:i|we)\s+(?:have|hold|own)\s+no\s+(?:position|stake|shares?)\b/i,
      /\bno\s+(?:position|stake|shares?)\s+(?:in|on)\b/i,
      /\b(?:not|never)\s+(?:a\s+)?(?:holder|owner)\b/i,
    ],
  },
  {
    type: "EXIT",
    confidence: "A",
    score: 0.98,
    patterns: [
      /\b(?:i|we)\s+(?:fully\s+)?(?:sold|exited|closed)\s+(?:out\s+of\s+)?(?:my|our|the)?\s*(?:position|stake|shares?)?\b/i,
      /\b(?:i|we)\s+(?:no\s+longer|don['’]?t\s+anymore)\s+(?:have|hold|own)\b/i,
      /\b(?:i|we)\s+am\s+out\s+of\b/i,
    ],
  },
  {
    type: "REDUCE",
    confidence: "A",
    score: 0.97,
    patterns: [
      /\b(?:i|we)\s+(?:trimmed|reduced|cut)\b/i,
      /\b(?:i|we)\s+sold\s+(?:some|part|a\s+portion)\b/i,
      /\btook\s+(?:some\s+)?profits?\b/i,
    ],
  },
  {
    type: "ADD",
    confidence: "A",
    score: 0.98,
    patterns: [
      /\b(?:i|we)\s+(?:actually\s+|recently\s+|also\s+)?(?:added|added\s+to|bought\s+more|increased)\b/i,
      /\b(?:i|we)\s+(?:have\s+)?been\s+adding\b/i,
    ],
  },
  {
    type: "OPEN",
    confidence: "A",
    score: 0.98,
    patterns: [
      /\b(?:i|we)\s+(?:actually\s+|recently\s+|also\s+)?(?:bought|opened|initiated|started|took)\b/i,
      /\b(?:i|we)\s+(?:am|are|'m|'re)\s+(?:now\s+)?long\b/i,
      /\b(?:new|small|starter)\s+(?:position|stake)\b/i,
    ],
  },
  {
    type: "HOLD",
    confidence: "A",
    score: 0.98,
    patterns: [
      /\b(?:i|we)\s+(?:still\s+|currently\s+)?(?:have|hold|own)\b/i,
      /\b(?:i|we)\s+(?:am|are|'m|'re)\s+still\s+long\b/i,
      /\b(?:my|our)\s+(?:position|stake|shares?|longs?)\b/i,
    ],
  },
];

const SOFT_RULES = [
  {
    type: "HOLD",
    confidence: "B",
    score: 0.78,
    patterns: [
      /\b(?:my|our)\s+bags?\b/i,
      /\bsizeable\s+(?:position|stake)\b/i,
      /\bpersonal\s+long\b/i,
      /\b(?:one\s+of\s+)?my\s+favorite\s+(?:stocks?|positions?)\b/i,
    ],
  },
];

function firstMatch(text, rules) {
  for (const rule of rules) {
    for (const pattern of rule.patterns) {
      const match = String(text || "").match(pattern);
      if (match) return { ...rule, evidence: match[0] };
    }
  }
  return null;
}

function classifyPost(post) {
  const text = String(post?.text || "").trim();
  const tickers = extractTickers(text, post?.cashtags || []);
  if (!text || tickers.length === 0) return [];

  const clauses = text
    .split(/(?:[.!?;\n]+|\s+(?:but|while|whereas|however)\s+)/i)
    .map((x) => x.trim())
    .filter(Boolean);

  const results = [];
  for (const ticker of tickers) {
    const scope = tickers.length === 1
      ? text
      : (clauses.find((clause) => clause.toUpperCase().includes(`$${ticker}`)) || "");
    if (!scope) continue;
    const strong = firstMatch(scope, RULES);
    const soft = strong ? null : firstMatch(scope, SOFT_RULES);
    const selected = strong || soft;
    if (!selected) continue;

    const multiTickerPenalty = tickers.length > 1 && !POSITION_WORDS.test(scope);
    const confidence = multiTickerPenalty && selected.confidence === "A" ? "B" : selected.confidence;
    const score = multiTickerPenalty ? Math.min(selected.score, 0.82) : selected.score;
    results.push({
      ticker,
      suggestedType: selected.type,
      confidence,
      score,
      evidence: selected.evidence,
      classifier: "rules-v2",
    });
  }
  return results;
}

module.exports = { extractTickers, classifyPost };

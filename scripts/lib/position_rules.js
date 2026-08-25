"use strict";

const TICKER_RE = /\$([A-Z][A-Z0-9.-]{0,9})\b/g;
const ANY_CASHTAG_RE = /\$([A-Z0-9][A-Z0-9.-]{0,14})\b/gi;
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

function cashtagsInClause(text) {
  return [...String(text || "").matchAll(ANY_CASHTAG_RE)].map((m) => m[1].toUpperCase());
}

function clauseHasTicker(clause, ticker) {
  return cashtagsInClause(clause).includes(String(ticker).toUpperCase());
}

function localScopeForTicker(text, ticker) {
  const clauses = String(text || "")
    .split(/(?:[.!?;\n]+|\s+(?:but|while|whereas|however)\s+)/i)
    .map((x) => x.trim())
    .filter(Boolean);

  const indexes = clauses
    .map((clause, index) => clauseHasTicker(clause, ticker) ? index : -1)
    .filter((index) => index >= 0);
  if (!indexes.length) return "";

  const selected = new Set();
  for (const index of indexes) {
    selected.add(index);
    for (const neighbor of [index - 1, index + 1]) {
      if (neighbor < 0 || neighbor >= clauses.length) continue;
      if (cashtagsInClause(clauses[neighbor]).length === 0) selected.add(neighbor);
    }
  }
  return [...selected].sort((a, b) => a - b).map((index) => clauses[index]).join(". ");
}

const LIST_ACTIONS = [
  { type: "ADD", verb: "added", score: 0.99, pattern: /\b(?:i|we)\s+(?:have\s+)?added\b.*\bfollowing\b.*\b(?:stocks?|positions?|names?)\b/i },
  { type: "ADD", verb: "bought more", score: 0.99, pattern: /\b(?:i|we)\s+bought\s+more\b.*\bfollowing\b.*\b(?:stocks?|positions?|names?)\b/i },
  { type: "OPEN", verb: "bought", score: 0.99, pattern: /\b(?:i|we)\s+bought\b.*\bfollowing\b.*\b(?:stocks?|positions?|names?)\b/i },
  { type: "REDUCE", verb: "trimmed", score: 0.99, pattern: /\b(?:i|we)\s+(?:trimmed|reduced|cut)\b.*\bfollowing\b.*\b(?:stocks?|positions?|names?)\b/i },
  { type: "EXIT", verb: "sold", score: 0.99, pattern: /\b(?:i|we)\s+(?:sold|exited|closed)\b.*\bfollowing\b.*\b(?:stocks?|positions?|names?)\b/i },
];

function explicitListActions(text, allowedTickers = []) {
  const lines = String(text || "").split(/\r?\n/);
  const allowed = new Set((allowedTickers || []).map((x) => String(x).toUpperCase()));
  const results = new Map();

  for (let i = 0; i < lines.length; i += 1) {
    const header = LIST_ACTIONS.find((rule) => rule.pattern.test(lines[i]));
    if (!header) continue;

    let sawItem = false;
    for (let j = i + 1; j < Math.min(lines.length, i + 25); j += 1) {
      const line = lines[j].trim();
      if (!line) {
        if (sawItem) break;
        continue;
      }
      const match = line.match(/^[-*•]?\s*\$([A-Z][A-Z0-9.-]{0,9})\b/i);
      if (!match) {
        if (sawItem) break;
        continue;
      }
      sawItem = true;
      const ticker = match[1].toUpperCase();
      if (allowed.size && !allowed.has(ticker)) continue;
      results.set(ticker, {
        ticker,
        suggestedType: header.type,
        confidence: "A",
        score: header.score,
        evidence: lines[i].trim(),
        classifier: "rules-v2.2-list",
      });
    }
  }
  return results;
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
      /\b(?:i|we)\s+(?:still|currently)\s+(?:have|hold|own)\b/i,
      /\b(?:i|we)\s+(?:hold|own)\b/i,
      /\b(?:i|we)\s+have\s+(?:(?:a|an|the|my|our|large|small|sizeable|sizable|significant)\s+){0,3}(?:position|positions|stake|stakes|shares?|longs?)\b/i,
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

  const listResults = explicitListActions(text, tickers);
  const results = [];
  for (const ticker of tickers) {
    if (listResults.has(ticker)) {
      results.push(listResults.get(ticker));
      continue;
    }

    const scope = localScopeForTicker(text, ticker);
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
      classifier: "rules-v2.1-local",
    });
  }
  return results;
}

module.exports = { extractTickers, classifyPost, localScopeForTicker, explicitListActions };

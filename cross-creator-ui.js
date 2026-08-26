"use strict";

const CCI_DEFAULT_CREATOR = "serenity";
const CCI_EVENT_LABELS = {
  OPEN: "建仓",
  ADD: "加仓",
  HOLD: "确认持有",
  REDUCE: "减仓",
  EXIT: "清仓",
  DENY: "明确否认",
  HISTORICAL: "历史披露"
};
const CCI_STATE_LABELS = {
  live: "在持",
  unconfirmed: "历史",
  archive: "清仓",
  denial: "否认"
};
let cciDataPromise = null;

function cciCreatorId(value) {
  return String(value?.creatorId || value || CCI_DEFAULT_CREATOR).trim().toLowerCase() || CCI_DEFAULT_CREATOR;
}
function cciActiveCreator() {
  return window.POSITION_LEDGER_RUNTIME?.activeCreatorId?.() || new URL(location.href).searchParams.get("creator") || CCI_DEFAULT_CREATOR;
}
function cciUrl(name) {
  const g = window.POSITION_LEDGER_CONFIG?.github || {};
  if (g.enabled && g.owner && g.repo && g.branch && g.dataDir) {
    return `https://raw.githubusercontent.com/${g.owner}/${g.repo}/${g.branch}/${g.dataDir}/${name}.json?v=${Date.now()}`;
  }
  return `./data/${name}.json?v=${Date.now()}`;
}
function loadCciData(force = false) {
  if (!cciDataPromise || force) {
    cciDataPromise = Promise.all([
      fetch(cciUrl("holdings"), { cache: "no-store" }).then(r => r.json()),
      fetch(cciUrl("events"), { cache: "no-store" }).then(r => r.json()),
      fetch(cciUrl("market"), { cache: "no-store" }).then(r => r.json()),
      fetch(cciUrl("creators"), { cache: "no-store" }).then(r => r.json())
    ]).then(([holdings, events, market, creators]) => ({
      holdings: holdings.holdings || [],
      events: events.events || [],
      market: market.quotes || {},
      creators: creators.creators || []
    })).catch(error => {
      console.warn("Cross-creator intelligence unavailable", error);
      return { holdings: [], events: [], market: {}, creators: [] };
    });
  }
  return cciDataPromise;
}
function cciEsc(value) {
  return String(value ?? "").replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);
}
function cciCreatorName(id, creators) {
  return creators.find(c => String(c.id).toLowerCase() === id)?.displayName || id;
}
function cciDeepLink(ticker, creatorId) {
  if (window.POSITION_LEDGER_RUNTIME?.deepLink) return window.POSITION_LEDGER_RUNTIME.deepLink(ticker, creatorId);
  const u = new URL(location.href);
  u.searchParams.set("creator", creatorId);
  u.searchParams.set("ticker", ticker);
  return u.toString();
}
function cciGroupHoldings(holdings) {
  const groups = new Map();
  holdings.forEach(h => {
    if (!groups.has(h.ticker)) groups.set(h.ticker, []);
    groups.get(h.ticker).push(h);
  });
  return groups;
}
function cciLatestDate(rows) {
  return Math.max(0, ...rows.map(h => Date.parse(h.lastConfirmedAt || h.firstRecordedAt || 0)).filter(Number.isFinite));
}
function cciDayPct(quote) {
  if (!quote || quote.price == null || quote.previousClose == null || Number(quote.previousClose) === 0) return null;
  return (Number(quote.price) / Number(quote.previousClose) - 1) * 100;
}
function cciPct(value) {
  if (value == null || !Number.isFinite(Number(value))) return { text: "—", cls: "neutral" };
  const n = Number(value);
  return { text: `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`, cls: n > 0 ? "positive" : n < 0 ? "negative" : "neutral" };
}
function cciMoney(value, currency) {
  if (value == null || !Number.isFinite(Number(value))) return "—";
  const n = Number(value);
  try {
    if (currency === "GBp") return `${n.toFixed(2)}p`;
    return new Intl.NumberFormat("en-US", { style: "currency", currency: currency || "USD", maximumFractionDigits: Math.abs(n) >= 100 ? 0 : 2 }).format(n);
  } catch {
    return `${n.toFixed(2)} ${currency || ""}`.trim();
  }
}
function cciAge(value) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  const days = Math.max(0, Math.floor((Date.now() - d.getTime()) / 86400000));
  if (days === 0) return "今天";
  if (days === 1) return "1 天前";
  return `${days} 天前`;
}
function cciCompany(rows) {
  return rows.map(h => h.company).find(name => name && name !== rows[0]?.ticker) || "";
}
function cciPill(holding, creators) {
  const cid = cciCreatorId(holding);
  const state = holding.state || "unconfirmed";
  return `<a class="cross-creator-pill cross-state-${cciEsc(state)}" href="${cciEsc(cciDeepLink(holding.ticker, cid))}"><i class="cross-state-dot"></i>${cciEsc(cciCreatorName(cid, creators))} · ${cciEsc(CCI_STATE_LABELS[state] || state)}</a>`;
}
function cciConsensusCard(ticker, rows, market, creators) {
  const live = rows.filter(h => h.state === "live");
  const quote = market[ticker];
  const day = cciPct(cciDayPct(quote));
  const company = cciCompany(rows);
  return `<article class="cross-card cross-card-consensus">
    <div class="cross-card-top"><strong class="cross-card-ticker">${cciEsc(ticker)}</strong><span class="cross-card-company">${cciEsc(company)}</span><span class="cross-card-price">${cciEsc(cciMoney(quote?.price, quote?.currency))}</span></div>
    <div class="cross-card-sub"><span>${live.length} 位 Creator 当前共同在持</span><span class="${day.cls}">${day.text} 今日</span></div>
    <div class="cross-creator-pills">${live.map(h => cciPill(h, creators)).join("")}</div>
  </article>`;
}
function cciDivergenceCard(ticker, rows, market, creators) {
  const quote = market[ticker];
  const day = cciPct(cciDayPct(quote));
  const company = cciCompany(rows);
  return `<article class="cross-card cross-card-divergence">
    <div class="cross-card-top"><strong class="cross-card-ticker">${cciEsc(ticker)}</strong><span class="cross-card-company">${cciEsc(company)}</span><span class="cross-card-price">${cciEsc(cciMoney(quote?.price, quote?.currency))}</span></div>
    <div class="cross-card-sub"><span>已核验状态出现分歧</span><span class="${day.cls}">${day.text} 今日</span></div>
    <div class="cross-creator-pills">${[...rows].sort((a,b) => String(a.state).localeCompare(String(b.state))).map(h => cciPill(h, creators)).join("")}</div>
  </article>`;
}
function cciFreshCard(event, creators) {
  const cid = cciCreatorId(event);
  const type = String(event.type || "").toLowerCase();
  const summary = String(event.summary || event.note || "公开披露事件").replace(/\s+/g, " ").trim();
  return `<article class="cross-card cross-card-fresh">
    <div class="cross-card-top"><a class="cross-card-ticker" href="${cciEsc(cciDeepLink(event.ticker, cid))}">${cciEsc(event.ticker)}</a><span class="cross-card-company">${cciEsc(cciCreatorName(cid, creators))}</span></div>
    <div class="cross-fresh-meta"><span class="cross-event-chip cross-event-${cciEsc(type)}">${cciEsc(CCI_EVENT_LABELS[event.type] || event.type)}</span><span class="cross-card-sub">${cciEsc(cciAge(event.date))} · 证据 ${cciEsc(event.confidence || "C")}</span></div>
    <p class="cross-card-summary">${cciEsc(summary.length > 105 ? `${summary.slice(0, 104)}…` : summary)}</p>
  </article>`;
}

async function renderCrossCreatorIntel(force = false) {
  const host = document.querySelector("#cross-creator-intel");
  if (!host) return;
  const data = await loadCciData(force);
  const active = cciActiveCreator();
  const groups = cciGroupHoldings(data.holdings);
  const activeTickers = new Set(data.holdings.filter(h => cciCreatorId(h) === active).map(h => h.ticker));
  const inScope = rows => active === "all" || rows.some(h => cciCreatorId(h) === active);

  const consensus = [...groups.entries()]
    .filter(([, rows]) => inScope(rows) && rows.filter(h => h.state === "live").length >= 2)
    .sort((a,b) => b[1].filter(h => h.state === "live").length - a[1].filter(h => h.state === "live").length || cciLatestDate(b[1]) - cciLatestDate(a[1]))
    .slice(0, 5);

  const divergence = [...groups.entries()]
    .filter(([, rows]) => inScope(rows) && rows.length >= 2 && new Set(rows.map(h => h.state)).size >= 2)
    .sort((a,b) => {
      const aLiveSplit = a[1].some(h => h.state === "live") && a[1].some(h => h.state !== "live");
      const bLiveSplit = b[1].some(h => h.state === "live") && b[1].some(h => h.state !== "live");
      return Number(bLiveSplit) - Number(aLiveSplit) || cciLatestDate(b[1]) - cciLatestDate(a[1]);
    })
    .slice(0, 5);

  const cutoff = Date.now() - 7 * 86400000;
  const fresh = [...data.events]
    .filter(e => Date.parse(e.date) >= cutoff)
    .filter(e => active === "all" || cciCreatorId(e) === active || activeTickers.has(e.ticker))
    .sort((a,b) => new Date(b.date) - new Date(a.date))
    .slice(0, 7);

  const scopeLabel = active === "all" ? "全网络" : cciCreatorName(active, data.creators);
  host.innerHTML = `<div class="cross-intel-head">
    <div class="cross-intel-head-copy"><span class="cross-intel-kicker">CROSS-CREATOR INTELLIGENCE</span><h2>跨大 V 持仓情报</h2><p>${cciEsc(scopeLabel)} · 只比较已经进入 canonical ledger 的持仓状态，不使用 pending / raw mentions 凑共识。</p></div>
    <div class="cross-intel-summary"><span>Consensus ${consensus.length}</span><span>Divergence ${divergence.length}</span><span>7D Actions ${fresh.length}</span></div>
  </div>
  <div class="cross-intel-grid">
    <section class="cross-intel-column"><div class="cross-intel-column-head"><strong>Consensus · 共同在持</strong><span>2+ LIVE</span></div><div class="cross-intel-list">${consensus.map(([ticker, rows]) => cciConsensusCard(ticker, rows, data.market, data.creators)).join("") || `<div class="cross-empty">当前范围还没有两位以上 Creator 同时处于 live 的标的。</div>`}</div></section>
    <section class="cross-intel-column"><div class="cross-intel-column-head"><strong>Divergence · 状态分歧</strong><span>STATE SPLIT</span></div><div class="cross-intel-list">${divergence.map(([ticker, rows]) => cciDivergenceCard(ticker, rows, data.market, data.creators)).join("") || `<div class="cross-empty">当前范围没有已核验的跨 Creator 状态分歧。</div>`}</div></section>
    <section class="cross-intel-column"><div class="cross-intel-column-head"><strong>Fresh Actions · 近 7 天</strong><span>CANONICAL EVENTS</span></div><div class="cross-intel-list">${fresh.map(e => cciFreshCard(e, data.creators)).join("") || `<div class="cross-empty">近 7 天暂无符合当前范围的 canonical 动作。</div>`}</div></section>
  </div>`;
}

window.addEventListener("position-ledger:creatorchange", () => renderCrossCreatorIntel(false));
window.addEventListener("position-ledger:asset-tones", () => renderCrossCreatorIntel(false));
document.querySelector("#refresh-btn")?.addEventListener("click", () => renderCrossCreatorIntel(true));
setTimeout(() => renderCrossCreatorIntel(false), 80);

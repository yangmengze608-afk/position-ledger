"use strict";

const TUI_EVENT_LABELS = {
  OPEN: "建仓",
  ADD: "加仓",
  HOLD: "确认持有",
  REDUCE: "减仓",
  EXIT: "清仓",
  DENY: "明确否认",
  HISTORICAL: "历史披露"
};

let tuiDataPromise = null;
let tuiSort = "confirmed";

function tuiDataUrl(name) {
  const g = window.POSITION_LEDGER_CONFIG?.github || {};
  if (g.enabled && g.owner && g.repo && g.branch && g.dataDir) {
    return `https://raw.githubusercontent.com/${g.owner}/${g.repo}/${g.branch}/${g.dataDir}/${name}.json?v=${Date.now()}`;
  }
  return `./data/${name}.json?v=${Date.now()}`;
}

function loadTuiData(force = false) {
  if (!tuiDataPromise || force) {
    tuiDataPromise = Promise.all([
      fetch(tuiDataUrl("holdings"), { cache: "no-store" }).then(r => r.json()),
      fetch(tuiDataUrl("events"), { cache: "no-store" }).then(r => r.json()),
      fetch(tuiDataUrl("market"), { cache: "no-store" }).then(r => r.json())
    ]).then(([holdings, events, market]) => ({
      holdings: holdings.holdings || [],
      events: events.events || [],
      market: market || { quotes: {} }
    })).catch(error => {
      console.warn("Terminal enhancement data unavailable", error);
      return { holdings: [], events: [], market: { quotes: {} } };
    });
  }
  return tuiDataPromise;
}

function tuiEsc(value) {
  return String(value ?? "").replace(/[&<>\"']/g, ch => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;"
  })[ch]);
}

function tuiPct(value) {
  if (value == null || !Number.isFinite(Number(value))) return { text: "—", cls: "move-flat", n: null };
  const n = Number(value);
  return { text: `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`, cls: n > 0 ? "move-up" : n < 0 ? "move-down" : "move-flat", n };
}

function tuiDayPct(quote) {
  if (!quote || quote.price == null || quote.previousClose == null || Number(quote.previousClose) === 0) return null;
  return (Number(quote.price) / Number(quote.previousClose) - 1) * 100;
}

function tuiMoney(value, currency) {
  if (value == null || !Number.isFinite(Number(value))) return "—";
  const n = Number(value);
  const digits = Math.abs(n) >= 100 ? 0 : 2;
  const number = n.toLocaleString("zh-CN", { minimumFractionDigits: digits, maximumFractionDigits: digits });
  if (currency === "USD") return `$${number}`;
  if (currency === "JPY") return `¥${number}`;
  if (currency === "TWD") return `NT$${number}`;
  if (currency === "SEK") return `${number} SEK`;
  if (currency === "GBp") return `${number}p`;
  if (currency === "CHF") return `CHF ${number}`;
  return currency ? `${number} ${currency}` : number;
}

function tuiDate(value, withTime = false) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("zh-CN", withTime ? {
    month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false
  } : { year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

function latestEventByTicker(events) {
  const map = new Map();
  [...events].sort((a, b) => new Date(b.date) - new Date(a.date)).forEach(event => {
    if (!map.has(event.ticker)) map.set(event.ticker, event);
  });
  return map;
}

async function renderPortfolioRibbon() {
  const host = document.querySelector("#portfolio-ribbon");
  if (!host) return;
  const { holdings, events, market } = await loadTuiData();
  const counts = {
    live: holdings.filter(h => h.state === "live").length,
    denial: holdings.filter(h => h.state === "denial").length,
    archive: holdings.filter(h => h.state === "archive").length,
    historical: holdings.filter(h => h.state === "unconfirmed").length,
    events: events.length,
    tracked: holdings.length
  };
  const latestEvent = [...events].sort((a, b) => new Date(b.date) - new Date(a.date))[0];
  const marketTime = market.updatedAt ? tuiDate(market.updatedAt, true) : "—";
  host.innerHTML = `
    <div class="portfolio-ribbon-head">
      <div>
        <span class="portfolio-ribbon-kicker">PORTFOLIO · DAILY AUTO UPDATE</span>
        <strong>白毛公开持仓 · 证据追踪台</strong>
        <p>只统计已经进入本账本的公开披露；没有披露，不推断账户变化。</p>
      </div>
      <div class="portfolio-ribbon-links">
        <a href="https://x.com/aleabitoreddit" target="_blank" rel="noreferrer">@aleabitoreddit ↗</a>
        <a href="https://github.com/yangmengze608-afk/position-ledger" target="_blank" rel="noreferrer">GitHub ↗</a>
      </div>
    </div>
    <div class="portfolio-count-grid">
      <div class="portfolio-count primary"><span>当前在持</span><strong>${counts.live}</strong><small>LIVE</small></div>
      <div class="portfolio-count negative"><span>明确否认</span><strong>${counts.denial}</strong><small>DENIAL</small></div>
      <div class="portfolio-count"><span>已清仓</span><strong>${counts.archive}</strong><small>EXIT</small></div>
      <div class="portfolio-count caution"><span>历史 / 未确认</span><strong>${counts.historical}</strong><small>HISTORICAL</small></div>
      <div class="portfolio-count"><span>已核验标的</span><strong>${counts.tracked}</strong><small>TRACKED</small></div>
      <div class="portfolio-count"><span>事件证据</span><strong>${counts.events}</strong><small>EVENTS</small></div>
    </div>
    <div class="portfolio-ribbon-foot">
      <span>最新事件 ${latestEvent ? `${tuiEsc(latestEvent.ticker)} · ${tuiEsc(TUI_EVENT_LABELS[latestEvent.type] || latestEvent.type)} · ${tuiDate(latestEvent.date, true)}` : "—"}</span>
      <span>行情刷新 ${marketTime}</span>
      <span class="ribbon-caveat">数量代表本项目已核验证据覆盖，不代表完整券商账户。</span>
    </div>`;
}

async function renderMarketTape() {
  const host = document.querySelector("#market-tape");
  if (!host) return;
  const { holdings, market } = await loadTuiData();
  const quotes = market.quotes || {};
  const rows = holdings
    .filter(h => h.state === "live" && quotes[h.ticker]?.price != null)
    .map(h => {
      const q = quotes[h.ticker];
      return {
        ticker: h.ticker,
        company: h.company,
        price: q.price,
        currency: q.currency,
        day: tuiDayPct(q),
        disclosure: q.firstDisclosureAnchor?.performancePct ?? null
      };
    })
    .sort((a, b) => Math.abs(b.day ?? -Infinity) - Math.abs(a.day ?? -Infinity))
    .slice(0, 6);

  host.innerHTML = rows.map(item => {
    const day = tuiPct(item.day);
    const disclosure = tuiPct(item.disclosure);
    return `<a class="tape-item" href="?ticker=${encodeURIComponent(item.ticker)}" title="打开 ${tuiEsc(item.ticker)} 证据档案">
      <div><strong>${tuiEsc(item.ticker)}</strong><span>${tuiEsc(item.company || "")}</span></div>
      <div class="tape-price">${tuiEsc(tuiMoney(item.price, item.currency))}</div>
      <div class="tape-move ${day.cls}">${day.text}<small>今日</small></div>
      <div class="tape-move ${disclosure.cls}">${disclosure.text}<small>披露后</small></div>
    </a>`;
  }).join("") || `<div class="tape-empty">行情更新后显示当前在持标的。</div>`;
}

async function renderEvidenceTape() {
  const host = document.querySelector("#recent-feed");
  if (!host) return;
  const { events } = await loadTuiData();
  const recent = [...events].sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 10);
  const signature = recent.map(e => `${e.id}:${e.date}`).join("|");
  if (host.dataset.tuiSignature === signature) return;
  host.dataset.tuiSignature = signature;

  host.innerHTML = recent.map(event => {
    const original = event.sourceText && event.sourceText !== event.summary
      ? event.sourceText.replace(/\s+/g, " ").trim().slice(0, 160)
      : "";
    const sourceDomain = event.sourceType === "x-original" ? "X 原帖" : event.sourceType === "secondary-mirror" ? "镜像来源" : "公开来源";
    return `<article class="evidence-tape-card">
      <div class="evidence-tape-top">
        <a class="evidence-ticker" href="?ticker=${encodeURIComponent(event.ticker)}">${tuiEsc(event.ticker)}</a>
        <span class="event-pill event-${String(event.type || "").toLowerCase()}">${tuiEsc(TUI_EVENT_LABELS[event.type] || event.type)}</span>
        <span class="evidence-grade grade-${String(event.confidence || "C").toLowerCase()}">${tuiEsc(event.confidence || "C")}</span>
        <time>${tuiDate(event.date, true)}</time>
      </div>
      <p class="evidence-cn">${tuiEsc(event.summary || event.note || "公开披露事件")}</p>
      ${original ? `<p class="evidence-original"><span>EN</span>${tuiEsc(original)}${event.sourceText.length > 160 ? "…" : ""}</p>` : ""}
      <div class="evidence-tape-foot">
        <span>${tuiEsc(sourceDomain)}</span>
        ${event.sourceUrl ? `<a href="${tuiEsc(event.sourceUrl)}" target="_blank" rel="noreferrer">打开原始证据 ↗</a>` : ""}
      </div>
    </article>`;
  }).join("");
}

async function decorateLedgerRows() {
  const body = document.querySelector("#ledger-body");
  if (!body) return;
  const { holdings, events, market } = await loadTuiData();
  const latest = latestEventByTicker(events);
  const holdingsMap = new Map(holdings.map(h => [h.ticker, h]));

  body.querySelectorAll("tr[data-ticker]").forEach(row => {
    const ticker = row.dataset.ticker;
    const holding = holdingsMap.get(ticker);
    const event = latest.get(ticker);
    row.classList.toggle("row-explicit", holding?.confidence === "A");
    row.classList.toggle("row-human-reviewed", holding?.confidence === "B" && /人工/.test(holding?.note || ""));

    const actionCell = [...row.children].find(td => td.dataset.label === "最后动作");
    if (actionCell && event?.sourceUrl && !actionCell.querySelector(".source-jump")) {
      const link = document.createElement("a");
      link.className = "source-jump";
      link.href = event.sourceUrl;
      link.target = "_blank";
      link.rel = "noreferrer";
      link.textContent = "原推 ↗";
      link.addEventListener("click", e => e.stopPropagation());
      actionCell.appendChild(link);
    }

    const asset = row.querySelector(".asset-cell");
    if (asset && holding && !asset.querySelector(".asset-submeta")) {
      const sub = document.createElement("small");
      sub.className = "asset-submeta";
      const exchange = holding.exchange || market.quotes?.[ticker]?.exchange || "";
      sub.textContent = [exchange, `${holding.eventCount ?? 0} 条证据`].filter(Boolean).join(" · ");
      asset.appendChild(sub);
    }
  });
  sortLedgerRows();
}

async function sortLedgerRows() {
  const body = document.querySelector("#ledger-body");
  if (!body) return;
  const { holdings, market } = await loadTuiData();
  const map = new Map(holdings.map(h => [h.ticker, h]));
  const currentRows = [...body.querySelectorAll("tr[data-ticker]")];
  const valueFor = ticker => {
    const h = map.get(ticker) || {};
    const q = market.quotes?.[ticker] || {};
    if (tuiSort === "ticker") return ticker;
    if (tuiSort === "daily") return tuiDayPct(q) ?? -Infinity;
    if (tuiSort === "disclosure") return q.firstDisclosureAnchor?.performancePct ?? -Infinity;
    if (tuiSort === "first") return new Date(h.firstRecordedAt || 0).getTime();
    return new Date(h.lastConfirmedAt || 0).getTime();
  };
  const desiredRows = [...currentRows].sort((a, b) => {
    const av = valueFor(a.dataset.ticker);
    const bv = valueFor(b.dataset.ticker);
    if (typeof av === "string") return av.localeCompare(bv);
    return bv - av;
  });
  const currentSignature = currentRows.map(row => row.dataset.ticker).join("|");
  const desiredSignature = desiredRows.map(row => row.dataset.ticker).join("|");
  if (currentSignature === desiredSignature) return;
  const fragment = document.createDocumentFragment();
  desiredRows.forEach(row => fragment.appendChild(row));
  body.appendChild(fragment);
}

function bindSortControl() {
  const select = document.querySelector("#sort-order");
  if (!select || select.dataset.bound) return;
  select.dataset.bound = "1";
  select.addEventListener("change", () => {
    tuiSort = select.value;
    sortLedgerRows();
  });
}

function addTopSourceLinks() {
  const actions = document.querySelector(".top-actions");
  if (!actions || actions.querySelector(".source-nav")) return;
  const wrap = document.createElement("div");
  wrap.className = "source-nav";
  wrap.innerHTML = `<a href="https://x.com/aleabitoreddit" target="_blank" rel="noreferrer">X 原始源</a><a href="https://github.com/yangmengze608-afk/position-ledger" target="_blank" rel="noreferrer">Repo</a>`;
  actions.prepend(wrap);
}

function scheduleTui() {
  queueMicrotask(() => {
    decorateLedgerRows();
    renderEvidenceTape();
  });
}

async function initTerminalUi() {
  addTopSourceLinks();
  bindSortControl();
  await Promise.all([renderPortfolioRibbon(), renderMarketTape(), renderEvidenceTape()]);
  await decorateLedgerRows();

  const body = document.querySelector("#ledger-body");
  if (body) new MutationObserver(scheduleTui).observe(body, { childList: true, subtree: true });
  const feed = document.querySelector("#recent-feed");
  if (feed) new MutationObserver(() => renderEvidenceTape()).observe(feed, { childList: true });

  const refresh = document.querySelector("#refresh-btn");
  if (refresh) refresh.addEventListener("click", () => {
    loadTuiData(true);
    setTimeout(() => Promise.all([renderPortfolioRibbon(), renderMarketTape(), renderEvidenceTape(), decorateLedgerRows()]), 450);
    setTimeout(() => Promise.all([renderPortfolioRibbon(), renderMarketTape(), renderEvidenceTape(), decorateLedgerRows()]), 1200);
  });
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initTerminalUi, { once: true });
else initTerminalUi();

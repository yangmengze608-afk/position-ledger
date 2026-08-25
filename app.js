const CONFIG = window.POSITION_LEDGER_CONFIG || {};

const state = {
  profile: null,
  holdings: [],
  events: [],
  market: {},
  filter: "live",
  search: "",
  backend: "local"
};

const els = {
  ledgerBody: document.querySelector("#ledger-body"),
  empty: document.querySelector("#empty-state"),
  search: document.querySelector("#search"),
  tabs: document.querySelector("#tabs"),
  resultCount: document.querySelector("#result-count"),
  recentFeed: document.querySelector("#recent-feed"),
  backendPill: document.querySelector("#backend-pill"),
  refreshBtn: document.querySelector("#refresh-btn"),
  drawer: document.querySelector("#drawer"),
  drawerBackdrop: document.querySelector("#drawer-backdrop"),
  drawerClose: document.querySelector("#drawer-close"),
  drawerContent: document.querySelector("#drawer-content")
};

const EVENT_LABELS = {
  OPEN: "建仓",
  ADD: "加仓",
  HOLD: "确认持有",
  REDUCE: "减仓",
  EXIT: "清仓",
  DENY: "明确否认",
  HISTORICAL: "历史披露"
};

function githubRawBase() {
  const g = CONFIG.github || {};
  return `https://raw.githubusercontent.com/${g.owner}/${g.repo}/${g.branch}/${g.dataDir}`;
}

async function fetchJSON(name, bust = false) {
  const suffix = bust ? `?v=${Date.now()}` : "";
  if (CONFIG.github?.enabled) {
    try {
      const res = await fetch(`${githubRawBase()}/${name}.json${suffix}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`GitHub ${res.status}`);
      state.backend = "github";
      return await res.json();
    } catch (err) {
      if (!CONFIG.fallbackToLocal) throw err;
      console.warn(`GitHub backend unavailable for ${name}; falling back to local data.`, err);
    }
  }
  const local = await fetch(`./data/${name}.json${suffix}`, { cache: "no-store" });
  if (!local.ok) throw new Error(`Local ${name} ${local.status}`);
  return await local.json();
}

async function loadData(bust = false) {
  els.refreshBtn.disabled = true;
  els.refreshBtn.textContent = "读取中…";
  try {
    state.backend = "local";
    const [profile, holdings, events, market] = await Promise.all([
      fetchJSON("profile", bust),
      fetchJSON("holdings", bust),
      fetchJSON("events", bust),
      fetchJSON("market", bust)
    ]);
    state.profile = profile;
    state.holdings = holdings.holdings || [];
    state.events = events.events || [];
    state.market = market.quotes || {};
    hydrateProfile();
    renderStats();
    renderLedger();
    renderRecentFeed();
    updateBackendBadge();
    openTickerFromURL();
  } catch (err) {
    console.error(err);
    els.ledgerBody.innerHTML = `<tr><td colspan="9"><div class="error-box"><strong>数据读取失败</strong><span>${escapeHTML(err.message)}</span></div></td></tr>`;
  } finally {
    els.refreshBtn.disabled = false;
    els.refreshBtn.textContent = "刷新";
  }
}

function hydrateProfile() {
  const p = state.profile || {};
  document.querySelector("#profile-name").textContent = `${p.name || "Serenity"} · 持仓追踪台`;
  document.querySelector("#profile-desc").textContent = p.description || "公开披露事件账本";
  document.querySelector("#profile-handle").textContent = p.handle || "";
  const eventDates = state.events.map(e => Date.parse(e.date)).filter(Number.isFinite);
  const newestEvent = eventDates.length ? Math.max(...eventDates) : 0;
  const profileTime = Date.parse(p.updatedAt || "") || 0;
  const freshness = Math.max(newestEvent, profileTime);
  document.querySelector("#last-updated").textContent = freshness ? `账本更新 ${formatDateTime(freshness)}` : "账本更新时间未知";
}

function updateBackendBadge() {
  els.backendPill.textContent = state.backend === "github" ? "GitHub Live" : "Local fallback";
}

function renderStats() {
  const now = new Date();
  const live = state.holdings.filter(h => h.state === "live").length;
  const aGrade = state.holdings.filter(h => h.confidence === "A").length;
  const events7d = state.events.filter(e => daysBetween(e.date, now) <= 7).length;
  const unconfirmed = state.holdings.filter(h => h.state === "unconfirmed").length;
  const closed = state.holdings.filter(h => ["archive", "denial"].includes(h.state)).length;
  document.querySelector("#stat-live").textContent = live;
  document.querySelector("#stat-a").textContent = aGrade;
  document.querySelector("#stat-7d").textContent = events7d;
  document.querySelector("#stat-unconfirmed").textContent = unconfirmed;
  document.querySelector("#stat-closed").textContent = closed;
}

function renderLedger() {
  const list = filteredHoldings();
  els.resultCount.textContent = list.length;
  els.ledgerBody.innerHTML = list.map(rowHTML).join("");
  els.empty.classList.toggle("hidden", list.length !== 0);
  document.querySelector(".table-wrap").classList.toggle("hidden", list.length === 0);

  els.ledgerBody.querySelectorAll("tr[data-ticker]").forEach(row => {
    row.addEventListener("click", () => openDrawer(row.dataset.ticker));
    row.addEventListener("keydown", e => {
      if (e.key === "Enter" || e.key === " ") openDrawer(row.dataset.ticker);
    });
  });
}

function filteredHoldings() {
  const q = state.search.trim().toLowerCase();
  return state.holdings
    .filter(h => {
      if (state.filter !== "all" && h.state !== state.filter) return false;
      if (!q) return true;
      return [h.ticker, h.company, h.exchange, h.note, h.thesis]
        .filter(Boolean).join(" ").toLowerCase().includes(q);
    })
    .sort((a, b) => new Date(b.lastConfirmedAt || 0) - new Date(a.lastConfirmedAt || 0));
}

function rowHTML(h) {
  const quote = state.market[h.ticker];
  const events = eventsForTicker(h.ticker);
  const lastEvent = events[0];
  const status = statusMeta(h.state);
  const move = dayMove(quote);
  const price = quote?.price != null ? formatMoney(quote.price, quote.currency) : "—";
  const company = h.company && h.company !== h.ticker ? h.company : marketNameFallback(h.ticker);
  return `
    <tr data-ticker="${escapeAttr(h.ticker)}" tabindex="0" role="button" aria-label="查看 ${escapeAttr(h.ticker)} 证据详情">
      <td data-label="标的"><div class="asset-cell"><strong>${escapeHTML(h.ticker)}</strong><span>${escapeHTML(company || h.exchange || "")}</span></div></td>
      <td data-label="状态"><span class="state-badge ${status.className}">${status.label}</span></td>
      <td data-label="最后动作"><span class="event-chip">${escapeHTML(EVENT_LABELS[lastEvent?.type] || lastEvent?.type || "—")}</span></td>
      <td data-label="最后确认"><div class="date-cell"><strong>${formatDate(h.lastConfirmedAt)}</strong><span>${relativeAge(h.lastConfirmedAt)}</span></div></td>
      <td data-label="首次披露"><span class="mono-soft">${formatDate(h.firstRecordedAt)}</span></td>
      <td data-label="现价" class="num"><strong>${escapeHTML(price)}</strong></td>
      <td data-label="日涨跌" class="num"><span class="move ${move.className}">${move.text}</span></td>
      <td data-label="事件" class="num"><span class="event-count">${h.eventCount ?? events.length}</span></td>
      <td data-label="证据"><span class="grade grade-${escapeAttr((h.confidence || "C").toLowerCase())}">${escapeHTML(h.confidence || "C")}</span></td>
    </tr>`;
}

function renderRecentFeed() {
  const recent = [...state.events]
    .sort((a, b) => new Date(b.date) - new Date(a.date))
    .slice(0, 8);
  els.recentFeed.innerHTML = recent.map(e => {
    const label = EVENT_LABELS[e.type] || e.type;
    return `
      <button class="feed-item" type="button" data-ticker="${escapeAttr(e.ticker)}">
        <span class="feed-rail"></span>
        <div class="feed-main">
          <div class="feed-top"><strong>${escapeHTML(e.ticker)}</strong><span class="feed-type">${escapeHTML(label)}</span><time>${formatDateShort(e.date)}</time></div>
          <p>${escapeHTML(shorten(e.summary || e.note || "公开披露事件", 108))}</p>
          <div class="feed-foot"><span>证据 ${escapeHTML(e.confidence || "C")}</span><span>查看台账 →</span></div>
        </div>
      </button>`;
  }).join("") || `<div class="feed-empty">暂无事件</div>`;
  els.recentFeed.querySelectorAll(".feed-item").forEach(item => item.addEventListener("click", () => openDrawer(item.dataset.ticker)));
}

function openDrawer(ticker) {
  const h = state.holdings.find(x => x.ticker === ticker);
  if (!h) return;
  const events = eventsForTicker(ticker);
  const quote = state.market[ticker];
  const status = statusMeta(h.state);
  const move = dayMove(quote);
  const latest = events[0];

  els.drawerContent.innerHTML = `
    <div class="drawer-hero">
      <div class="drawer-kicker">POSITION EVIDENCE FILE</div>
      <div class="drawer-title-row">
        <div><h2>${escapeHTML(h.ticker)}</h2><p>${escapeHTML(h.company || "")}</p></div>
        <span class="state-badge ${status.className}">${status.label}</span>
      </div>
      <div class="drawer-price">
        <strong>${quote?.price != null ? escapeHTML(formatMoney(quote.price, quote.currency)) : "行情待更新"}</strong>
        <span class="move ${move.className}">${move.text}</span>
        ${quote?.exchange ? `<small>${escapeHTML(quote.exchange)} · ${escapeHTML(quote.currency || "")}</small>` : ""}
      </div>
    </div>

    <div class="drawer-metrics">
      <div><span>证据等级</span><strong>${escapeHTML(h.confidence || "C")}</strong></div>
      <div><span>最后动作</span><strong>${escapeHTML(EVENT_LABELS[latest?.type] || latest?.type || "—")}</strong></div>
      <div><span>最后确认</span><strong>${formatDate(h.lastConfirmedAt)}</strong></div>
      <div><span>首次披露</span><strong>${formatDate(h.firstRecordedAt)}</strong></div>
      <div><span>事件数量</span><strong>${events.length}</strong></div>
      <div><span>状态年龄</span><strong>${relativeAge(h.lastConfirmedAt)}</strong></div>
    </div>

    ${latest ? `
      <section class="latest-evidence">
        <div class="drawer-section-label">LATEST EVIDENCE</div>
        <div class="evidence-card">
          <div class="evidence-head"><span>${escapeHTML(EVENT_LABELS[latest.type] || latest.type)}</span><time>${formatDateTime(latest.date)}</time></div>
          <p>${escapeHTML(latest.summary || latest.note || "")}</p>
          ${latest.sourceUrl ? `<a href="${escapeAttr(latest.sourceUrl)}" target="_blank" rel="noreferrer">打开原始来源 ↗</a>` : ""}
        </div>
      </section>` : ""}

    <section class="timeline-section">
      <div class="drawer-section-label">EVENT TIMELINE · ${events.length}</div>
      <div class="timeline">
        ${events.map(eventHTML).join("") || `<div class="timeline-empty">暂无事件。</div>`}
      </div>
    </section>

    <div class="drawer-disclaimer">这里记录的是公开披露及其证据链，不是券商账户证明。长期未提及只会降低时效性，不会自动生成 EXIT。</div>
  `;

  els.drawer.classList.add("open");
  els.drawer.setAttribute("aria-hidden", "false");
  els.drawerBackdrop.classList.remove("hidden");
  const url = new URL(window.location.href);
  url.searchParams.set("ticker", ticker);
  history.replaceState(null, "", url);
}

function eventHTML(e) {
  return `
    <article class="timeline-event">
      <span class="timeline-dot"></span>
      <div class="timeline-body">
        <div class="timeline-meta"><time>${formatDateTime(e.date)}</time><span>${escapeHTML(EVENT_LABELS[e.type] || e.type)}</span><b>${escapeHTML(e.confidence || "C")}</b></div>
        <p>${escapeHTML(e.summary || e.note || "")}</p>
        ${e.sourceUrl ? `<a href="${escapeAttr(e.sourceUrl)}" target="_blank" rel="noreferrer">证据来源 ↗</a>` : ""}
      </div>
    </article>`;
}

function eventsForTicker(ticker) {
  return state.events.filter(e => e.ticker === ticker).sort((a, b) => new Date(b.date) - new Date(a.date));
}

function statusMeta(s) {
  if (s === "live") return { label: "在持", className: "state-live" };
  if (s === "unconfirmed") return { label: "历史", className: "state-unconfirmed" };
  if (s === "archive") return { label: "清仓", className: "state-archive" };
  if (s === "denial") return { label: "否认", className: "state-denial" };
  return { label: s || "未知", className: "state-unconfirmed" };
}

function dayMove(quote) {
  if (!quote || quote.price == null || quote.previousClose == null || Number(quote.previousClose) === 0) return { text: "—", className: "move-flat" };
  const pct = (Number(quote.price) / Number(quote.previousClose) - 1) * 100;
  return { text: `${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%`, className: pct > 0 ? "move-up" : pct < 0 ? "move-down" : "move-flat" };
}

function relativeAge(value) {
  if (!value) return "—";
  const days = daysBetween(value, new Date());
  if (days <= 0) return "今天";
  if (days === 1) return "1 天前";
  if (days < 30) return `${days} 天前`;
  const months = Math.floor(days / 30);
  return `${months} 个月前`;
}

function closeDrawer() {
  els.drawer.classList.remove("open");
  els.drawer.setAttribute("aria-hidden", "true");
  els.drawerBackdrop.classList.add("hidden");
  const url = new URL(window.location.href);
  url.searchParams.delete("ticker");
  history.replaceState(null, "", url);
}

function openTickerFromURL() {
  const t = new URL(window.location.href).searchParams.get("ticker");
  if (t) openDrawer(t.toUpperCase());
}

function daysBetween(date, b) {
  if (!date) return Infinity;
  const a = new Date(date);
  const end = b instanceof Date ? b : new Date(b);
  return Math.max(0, Math.floor((end - a) / 86400000));
}

function formatDate(value) {
  if (!value) return "—";
  const d = new Date(value);
  return new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

function formatDateShort(value) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit" }).format(new Date(value));
}

function formatDateTime(value) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

function formatMoney(value, currency = "USD") {
  if (currency === "GBp") return `${Number(value).toFixed(2)}p`;
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: currency || "USD", maximumFractionDigits: 2 }).format(value);
  } catch {
    return `${Number(value).toFixed(2)} ${currency || ""}`.trim();
  }
}

function marketNameFallback(ticker) {
  return ticker === "SPCX" ? "SpaceX exposure" : ticker;
}

function shorten(text, max) {
  const s = String(text || "").trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

function escapeHTML(v) {
  return String(v ?? "").replace(/[&<>'"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[c]));
}
function escapeAttr(v) { return escapeHTML(v); }

els.tabs.addEventListener("click", e => {
  const btn = e.target.closest(".tab");
  if (!btn) return;
  state.filter = btn.dataset.filter;
  els.tabs.querySelectorAll(".tab").forEach(x => x.classList.toggle("active", x === btn));
  renderLedger();
});
els.search.addEventListener("input", e => { state.search = e.target.value; renderLedger(); });
els.refreshBtn.addEventListener("click", () => loadData(true));
els.drawerClose.addEventListener("click", closeDrawer);
els.drawerBackdrop.addEventListener("click", closeDrawer);
document.addEventListener("keydown", e => { if (e.key === "Escape") closeDrawer(); });

loadData();

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
  cards: document.querySelector("#cards"),
  empty: document.querySelector("#empty-state"),
  search: document.querySelector("#search"),
  tabs: document.querySelector("#tabs"),
  resultCount: document.querySelector("#result-count"),
  sectionTitle: document.querySelector("#section-title"),
  sectionEyebrow: document.querySelector("#section-eyebrow"),
  backendPill: document.querySelector("#backend-pill"),
  refreshBtn: document.querySelector("#refresh-btn"),
  drawer: document.querySelector("#drawer"),
  drawerBackdrop: document.querySelector("#drawer-backdrop"),
  drawerClose: document.querySelector("#drawer-close"),
  drawerContent: document.querySelector("#drawer-content")
};

const FILTER_META = {
  live: ["LIVE POSITIONS", "当前公开持仓"],
  new: ["NEW DISCLOSURES · 60D", "近 60 天新披露"],
  all: ["ALL LEDGER STATES", "全部记录"],
  silent: ["SILENT · 120D+", "120 天以上未确认"],
  archive: ["ARCHIVE", "已清仓"],
  denials: ["DENIALS", "明确否认持有"]
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
    render();
    updateBackendBadge();
    openTickerFromURL();
  } catch (err) {
    console.error(err);
    els.cards.innerHTML = `<div class="empty-state"><strong>数据读取失败</strong><p>${escapeHTML(err.message)}</p></div>`;
  } finally {
    els.refreshBtn.disabled = false;
    els.refreshBtn.textContent = "刷新数据";
  }
}

function hydrateProfile() {
  const p = state.profile;
  document.querySelector("#profile-name").textContent = `${p.name} · 持仓追踪台`;
  document.querySelector("#profile-desc").textContent = p.description;
  document.querySelector("#profile-handle").textContent = p.handle;
  const latestEventMs = state.events.reduce((latest, event) => {
    const value = Date.parse(event.date || "");
    return Number.isFinite(value) ? Math.max(latest, value) : latest;
  }, 0);
  const profileMs = Date.parse(p.updatedAt || "");
  const latestMs = Math.max(Number.isFinite(profileMs) ? profileMs : 0, latestEventMs);
  document.querySelector("#last-updated").textContent = `账本更新 ${formatDateTime(latestMs ? new Date(latestMs).toISOString() : p.updatedAt)}`;
}

function updateBackendBadge() {
  els.backendPill.textContent = state.backend === "github" ? "数据源 · GitHub Live" : "数据源 · 本地回退";
}

function renderStats() {
  const today = new Date();
  const live = state.holdings.filter(h => h.state === "live").length;
  const fresh = state.holdings.filter(h => daysBetween(h.firstRecordedAt, today) <= 60 && h.state === "live").length;
  const silent = state.holdings.filter(h => h.state === "live" && daysBetween(h.lastConfirmedAt, today) > 120).length;
  const closed = state.holdings.filter(h => ["archive", "denial"].includes(h.state)).length;
  document.querySelector("#stat-live").textContent = live;
  document.querySelector("#stat-new").textContent = fresh;
  document.querySelector("#stat-silent").textContent = silent;
  document.querySelector("#stat-closed").textContent = closed;
}

function render() {
  const [eyebrow, title] = FILTER_META[state.filter];
  els.sectionEyebrow.textContent = eyebrow;
  els.sectionTitle.textContent = title;

  const list = filteredHoldings();
  els.resultCount.textContent = `${list.length} 项`;
  els.cards.innerHTML = list.map(cardHTML).join("");
  els.empty.classList.toggle("hidden", list.length !== 0);

  els.cards.querySelectorAll(".position-card").forEach(card => {
    card.addEventListener("click", () => openDrawer(card.dataset.ticker));
    card.addEventListener("keydown", e => {
      if (e.key === "Enter" || e.key === " ") openDrawer(card.dataset.ticker);
    });
  });
}

function filteredHoldings() {
  const today = new Date();
  const q = state.search.trim().toLowerCase();
  return state.holdings
    .filter(h => {
      if (state.filter === "live" && h.state !== "live") return false;
      if (state.filter === "new" && !(h.state === "live" && daysBetween(h.firstRecordedAt, today) <= 60)) return false;
      if (state.filter === "silent" && !(h.state === "live" && daysBetween(h.lastConfirmedAt, today) > 120)) return false;
      if (state.filter === "archive" && h.state !== "archive") return false;
      if (state.filter === "denials" && h.state !== "denial") return false;
      if (!q) return true;
      return [h.ticker, h.company, h.exchange, h.note, h.thesis]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(q);
    })
    .sort((a, b) => new Date(b.lastConfirmedAt) - new Date(a.lastConfirmedAt));
}

function cardHTML(h) {
  const quote = state.market[h.ticker];
  const badge = badgeMeta(h);
  const last = h.lastConfirmedAt ? formatDate(h.lastConfirmedAt) : "—";
  const first = h.firstRecordedAt ? formatDate(h.firstRecordedAt) : "—";
  const price = quote?.price != null ? formatMoney(quote.price, quote.currency) : "待行情任务更新";
  return `
    <article class="position-card" data-ticker="${escapeAttr(h.ticker)}" tabindex="0" role="button" aria-label="查看 ${escapeAttr(h.ticker)} 详情">
      <div class="card-top">
        <div>
          <div class="ticker">${escapeHTML(h.ticker)}</div>
          <div class="company">${escapeHTML(h.company || "")}</div>
        </div>
        <span class="badge ${badge.className}">${badge.label}</span>
      </div>
      <div class="card-metrics">
        <div class="metric"><span>最后确认</span><strong>${last}</strong></div>
        <div class="metric"><span>记录起点</span><strong>${first}</strong></div>
        <div class="metric"><span>市场价格</span><strong>${escapeHTML(price)}</strong></div>
        <div class="metric"><span>市场</span><strong>${escapeHTML(h.exchange || "—")}</strong></div>
      </div>
      <div class="card-foot">
        <span class="confidence">置信度 <b>${escapeHTML(h.confidence || "—")}</b></span>
        <span>${escapeHTML(h.note || h.thesis || "查看证据链")}</span>
        <span class="card-chevron">›</span>
      </div>
    </article>`;
}

function badgeMeta(h) {
  if (h.state === "denial") return { label: "明确否认", className: "badge-denial" };
  if (h.state === "archive") return { label: "已清仓", className: "badge-archive" };
  if (h.state === "unconfirmed") return { label: "历史披露", className: "badge-silent" };
  if (h.state === "live" && daysBetween(h.lastConfirmedAt, new Date()) > 120) return { label: "静默", className: "badge-silent" };
  return { label: "在持", className: "badge-live" };
}

function openDrawer(ticker) {
  const h = state.holdings.find(x => x.ticker === ticker);
  if (!h) return;
  const events = state.events
    .filter(e => e.ticker === ticker)
    .sort((a, b) => new Date(b.date) - new Date(a.date));
  const quote = state.market[ticker];
  const badge = badgeMeta(h);

  els.drawerContent.innerHTML = `
    <div class="drawer-head">
      <div class="drawer-kicker">POSITION EVIDENCE FILE</div>
      <h2 class="drawer-title">${escapeHTML(h.ticker)}</h2>
      <div class="drawer-company">${escapeHTML(h.company || "")}</div>
      <div class="drawer-summary">
        <div class="summary-tile"><span>状态</span><strong>${badge.label}</strong></div>
        <div class="summary-tile"><span>置信度</span><strong>${escapeHTML(h.confidence || "—")}</strong></div>
        <div class="summary-tile"><span>最后确认</span><strong>${formatDate(h.lastConfirmedAt)}</strong></div>
        <div class="summary-tile"><span>市场价格</span><strong>${quote?.price != null ? escapeHTML(formatMoney(quote.price, quote.currency)) : "待更新"}</strong></div>
      </div>
      ${h.thesis ? `<p class="hero-desc">${escapeHTML(h.thesis)}</p>` : ""}
    </div>
    <div class="timeline-title">公开事件时间线 · ${events.length} 条</div>
    <div class="timeline">
      ${events.map(eventHTML).join("") || `<div class="event"><p>暂无事件。</p></div>`}
    </div>
    <div class="drawer-note">重要：这里记录的是“公开披露发生过什么”，不是对真实券商账户的证明。没有新披露时，只能降低置信度，不能自动推断已经卖出。</div>
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
    <article class="event">
      <div class="event-meta">
        <span>${formatDate(e.date)}</span>
        <span class="event-type">${escapeHTML(e.type)}</span>
        <span>置信度 ${escapeHTML(e.confidence || "—")}</span>
      </div>
      <p>${escapeHTML(e.summary)}</p>
      ${e.sourceUrl ? `<a class="source-link" href="${escapeAttr(e.sourceUrl)}" target="_blank" rel="noreferrer">打开证据来源 ↗</a>` : ""}
    </article>`;
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
  return Math.floor((end - a) / 86400000);
}

function formatDate(value) {
  if (!value) return "—";
  const d = new Date(value);
  return new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

function formatDateTime(value) {
  if (!value) return "—";
  const d = new Date(value);
  return new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(d);
}

function formatMoney(value, currency = "USD") {
  try { return new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 2 }).format(value); }
  catch { return `${value}`; }
}

function escapeHTML(v) {
  return String(v ?? "").replace(/[&<>'"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;","\"":"&quot;"}[c]));
}
function escapeAttr(v) { return escapeHTML(v); }

els.tabs.addEventListener("click", e => {
  const btn = e.target.closest(".tab");
  if (!btn) return;
  state.filter = btn.dataset.filter;
  els.tabs.querySelectorAll(".tab").forEach(x => x.classList.toggle("active", x === btn));
  render();
});
els.search.addEventListener("input", e => { state.search = e.target.value; render(); });
els.refreshBtn.addEventListener("click", () => loadData(true));
els.drawerClose.addEventListener("click", closeDrawer);
els.drawerBackdrop.addEventListener("click", closeDrawer);
document.addEventListener("keydown", e => { if (e.key === "Escape") closeDrawer(); });

loadData();

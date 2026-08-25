const CONFIG = window.POSITION_LEDGER_CONFIG || {};
const DEFAULT_CREATOR_ID = "serenity";

const initialCreator = new URL(window.location.href).searchParams.get("creator") || DEFAULT_CREATOR_ID;

const state = {
  profile: null,
  creators: [],
  holdings: [],
  events: [],
  market: {},
  creatorFilter: initialCreator,
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
  creatorSwitcher: document.querySelector("#creator-switcher"),
  creatorSwitcherTitle: document.querySelector("#creator-switcher-title"),
  creatorProfileLink: document.querySelector("#creator-profile-link"),
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

function creatorIdOf(value) {
  const id = String(value?.creatorId || DEFAULT_CREATOR_ID).trim().toLowerCase();
  return id || DEFAULT_CREATOR_ID;
}

function creatorById(id) {
  return state.creators.find(c => String(c.id).toLowerCase() === String(id).toLowerCase()) || null;
}

function creatorName(id) {
  if (id === "all") return "全部研究对象";
  return creatorById(id)?.displayName || id || "Serenity";
}

function normalizeCreatorFilter(value) {
  if (value === "all") return "all";
  const normalized = String(value || DEFAULT_CREATOR_ID).trim().toLowerCase();
  if (state.creators.some(c => String(c.id).toLowerCase() === normalized)) return normalized;
  return DEFAULT_CREATOR_ID;
}

function matchesCreator(value, creatorId = state.creatorFilter) {
  return creatorId === "all" || creatorIdOf(value) === creatorId;
}

function activeHoldings() {
  return state.holdings.filter(h => matchesCreator(h));
}

function activeEvents() {
  return state.events.filter(e => matchesCreator(e));
}

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
    const [profile, creators, holdings, events, market] = await Promise.all([
      fetchJSON("profile", bust),
      fetchJSON("creators", bust),
      fetchJSON("holdings", bust),
      fetchJSON("events", bust),
      fetchJSON("market", bust)
    ]);
    state.profile = profile;
    state.creators = (creators.creators || []).filter(c => c.status !== "disabled");
    state.holdings = holdings.holdings || [];
    state.events = events.events || [];
    state.market = market.quotes || {};
    state.creatorFilter = normalizeCreatorFilter(state.creatorFilter);
    publishRuntime();
    renderCreatorSwitcher();
    hydrateProfile();
    renderStats();
    renderLedger();
    renderRecentFeed();
    updateBackendBadge();
    openTickerFromURL();
    dispatchCreatorChange();
  } catch (err) {
    console.error(err);
    els.ledgerBody.innerHTML = `<tr><td colspan="10"><div class="error-box"><strong>数据读取失败</strong><span>${escapeHTML(err.message)}</span></div></td></tr>`;
  } finally {
    els.refreshBtn.disabled = false;
    els.refreshBtn.textContent = "刷新";
  }
}

function publishRuntime() {
  window.POSITION_LEDGER_RUNTIME = {
    defaultCreatorId: DEFAULT_CREATOR_ID,
    creatorIdOf,
    activeCreatorId: () => state.creatorFilter,
    creatorName,
    creatorById,
    matchesCreator,
    getCreators: () => [...state.creators],
    creatorTickerKey: (value, ticker = value?.ticker) => `${creatorIdOf(value)}|${ticker || ""}`,
    deepLink: (ticker, creatorId = state.creatorFilter) => {
      const url = new URL(window.location.href);
      const cid = creatorId === "all" ? DEFAULT_CREATOR_ID : creatorId;
      url.searchParams.set("creator", cid);
      if (ticker) url.searchParams.set("ticker", ticker);
      else url.searchParams.delete("ticker");
      return url.toString();
    }
  };
}

function dispatchCreatorChange() {
  document.body.dataset.creatorView = state.creatorFilter;
  window.dispatchEvent(new CustomEvent("position-ledger:creatorchange", {
    detail: { creatorId: state.creatorFilter, creator: creatorById(state.creatorFilter) }
  }));
}

function renderCreatorSwitcher() {
  if (!els.creatorSwitcher) return;
  const options = [{ id: "all", displayName: "全部", handle: `${state.creators.length} creators` }, ...state.creators];
  els.creatorSwitcher.innerHTML = options.map(creator => {
    const id = String(creator.id).toLowerCase();
    const active = id === state.creatorFilter;
    const handle = creator.handle ? `@${String(creator.handle).replace(/^@/, "")}` : (creator.handle || "");
    return `<button class="creator-tab ${active ? "active" : ""}" type="button" role="tab" aria-selected="${active ? "true" : "false"}" data-creator="${escapeAttr(id)}">${escapeHTML(creator.displayName || id)}${handle ? `<span class="creator-handle">${escapeHTML(handle)}</span>` : ""}</button>`;
  }).join("");

  const selected = creatorById(state.creatorFilter);
  els.creatorSwitcherTitle.textContent = state.creatorFilter === "all"
    ? `全部研究对象 · ${state.creators.length}`
    : `${selected?.displayName || creatorName(state.creatorFilter)} · 独立账本`;

  if (selected?.profileUrl) {
    els.creatorProfileLink.href = selected.profileUrl;
    els.creatorProfileLink.textContent = `${selected.primaryPlatform === "x" ? "X" : "原始"} 主页 ↗`;
    els.creatorProfileLink.classList.remove("is-hidden");
  } else {
    els.creatorProfileLink.href = "#";
    els.creatorProfileLink.classList.add("is-hidden");
  }
}

function setCreatorFilter(creatorId, { updateUrl = true, rerender = true } = {}) {
  const next = normalizeCreatorFilter(creatorId);
  if (next === state.creatorFilter && !rerender) return;
  state.creatorFilter = next;
  publishRuntime();
  renderCreatorSwitcher();
  hydrateProfile();
  if (rerender) {
    renderStats();
    renderLedger();
    renderRecentFeed();
  }
  if (updateUrl) {
    const url = new URL(window.location.href);
    url.searchParams.set("creator", next);
    url.searchParams.delete("ticker");
    history.replaceState(null, "", url);
  }
  dispatchCreatorChange();
}

function hydrateProfile() {
  const selected = creatorById(state.creatorFilter);
  const p = state.profile || {};
  const events = activeEvents();
  const isAll = state.creatorFilter === "all";
  const isLegacySerenity = state.creatorFilter === DEFAULT_CREATOR_ID;

  document.querySelector("#profile-eyebrow").textContent = isAll
    ? "MULTI-CREATOR · PUBLIC PORTFOLIO INTELLIGENCE"
    : `${String(selected?.displayName || creatorName(state.creatorFilter)).toUpperCase()} · PUBLIC PORTFOLIO INTELLIGENCE`;
  document.querySelector("#profile-name").textContent = isAll
    ? "公开持仓证据网络"
    : `${selected?.displayName || creatorName(state.creatorFilter)} · 持仓追踪台`;
  document.querySelector("#profile-desc").textContent = isAll
    ? "把多个公开研究对象的持仓披露放进同一套证据标准；每个人独立记账，同一 ticker 不会跨人串联。"
    : (isLegacySerenity ? p.description : "把该研究对象的公开持仓披露拆成可核对事件；普通讨论与真实持仓声明严格分开。");
  document.querySelector("#profile-handle").textContent = isAll
    ? `${state.creators.length} 个研究对象`
    : (selected?.handle ? `@${String(selected.handle).replace(/^@/, "")}` : (isLegacySerenity ? p.handle || "" : ""));
  document.querySelector("#profile-scope").textContent = isAll ? "跨 Creator 证据视图" : "独立 Creator 账本";

  const eventDates = events.map(e => Date.parse(e.date)).filter(Number.isFinite);
  const newestEvent = eventDates.length ? Math.max(...eventDates) : 0;
  const profileTime = isLegacySerenity ? (Date.parse(p.updatedAt || "") || 0) : 0;
  const freshness = Math.max(newestEvent, profileTime);
  document.querySelector("#last-updated").textContent = freshness ? `账本更新 ${formatDateTime(freshness)}` : "账本更新时间未知";

  const coverageCopy = document.querySelector("#coverage-copy");
  if (coverageCopy) {
    if (isLegacySerenity) {
      coverageCopy.textContent = "Serenity 存在 X 订阅内容；非订阅者无法保证看到全部订阅专属帖子。本账本使用可观察公开源 + 可审计公开镜像补漏，任何二手搬运都不会静默升级为 A 级证据。";
    } else if (isAll) {
      coverageCopy.textContent = "不同研究对象的公开可见性并不相同；可能存在订阅、延迟披露或平台缺口。跨 Creator 视图只汇总已经进入 canonical ledger 的证据，不把缺失内容当作卖出或无仓位。";
    } else {
      coverageCopy.textContent = selected?.subscriberCoverage === "not-guaranteed"
        ? "该研究对象可能存在非公开或订阅内容；当前视图只代表已观察和已核验的公开披露。"
        : "当前视图只代表已经观察和核验的公开披露，不等于完整账户。";
    }
  }
}

function updateBackendBadge() {
  els.backendPill.textContent = state.backend === "github" ? "GitHub Live" : "Local fallback";
}

function renderStats() {
  const now = new Date();
  const holdings = activeHoldings();
  const events = activeEvents();
  const live = holdings.filter(h => h.state === "live").length;
  const aGrade = holdings.filter(h => h.confidence === "A").length;
  const events7d = events.filter(e => daysBetween(e.date, now) <= 7).length;
  const unconfirmed = holdings.filter(h => h.state === "unconfirmed").length;
  const closed = holdings.filter(h => ["archive", "denial"].includes(h.state)).length;
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
    const open = () => {
      const creatorId = row.dataset.creator || DEFAULT_CREATOR_ID;
      if (state.creatorFilter === "all") setCreatorFilter(creatorId, { updateUrl: true, rerender: true });
      openDrawer(row.dataset.ticker, creatorId);
    };
    row.addEventListener("click", open);
    row.addEventListener("keydown", e => {
      if (e.key === "Enter" || e.key === " ") open();
    });
  });
}

function filteredHoldings() {
  const q = state.search.trim().toLowerCase();
  return activeHoldings()
    .filter(h => {
      if (state.filter !== "all" && h.state !== state.filter) return false;
      if (!q) return true;
      return [h.ticker, h.company, h.exchange, h.note, h.thesis, creatorName(creatorIdOf(h))]
        .filter(Boolean).join(" ").toLowerCase().includes(q);
    })
    .sort((a, b) => new Date(b.lastConfirmedAt || 0) - new Date(a.lastConfirmedAt || 0));
}

function rowHTML(h) {
  const creatorId = creatorIdOf(h);
  const quote = state.market[h.ticker];
  const events = eventsForTicker(h.ticker, creatorId);
  const lastEvent = events[0];
  const status = statusMeta(h.state);
  const move = dayMove(quote);
  const price = quote?.price != null ? formatMoney(quote.price, quote.currency) : "—";
  const company = h.company && h.company !== h.ticker ? h.company : marketNameFallback(h.ticker);
  const creatorBadge = state.creatorFilter === "all" ? `<small class="creator-inline">${escapeHTML(creatorName(creatorId))}</small>` : "";
  return `
    <tr data-ticker="${escapeAttr(h.ticker)}" data-creator="${escapeAttr(creatorId)}" tabindex="0" role="button" aria-label="查看 ${escapeAttr(creatorName(creatorId))} · ${escapeAttr(h.ticker)} 证据详情">
      <td data-label="标的"><div class="asset-cell"><strong>${escapeHTML(h.ticker)}</strong><span>${escapeHTML(company || h.exchange || "")}</span>${creatorBadge}</div></td>
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
  const recent = [...activeEvents()]
    .sort((a, b) => new Date(b.date) - new Date(a.date))
    .slice(0, 8);
  els.recentFeed.innerHTML = recent.map(e => {
    const label = EVENT_LABELS[e.type] || e.type;
    const cid = creatorIdOf(e);
    const creator = state.creatorFilter === "all" ? `<span>${escapeHTML(creatorName(cid))}</span>` : "";
    return `
      <button class="feed-item" type="button" data-ticker="${escapeAttr(e.ticker)}" data-creator="${escapeAttr(cid)}">
        <span class="feed-rail"></span>
        <div class="feed-main">
          <div class="feed-top"><strong>${escapeHTML(e.ticker)}</strong>${creator}<span class="feed-type">${escapeHTML(label)}</span><time>${formatDateShort(e.date)}</time></div>
          <p>${escapeHTML(shorten(e.summary || e.note || "公开披露事件", 108))}</p>
          <div class="feed-foot"><span>证据 ${escapeHTML(e.confidence || "C")}</span><span>查看台账 →</span></div>
        </div>
      </button>`;
  }).join("") || `<div class="feed-empty">暂无事件</div>`;
  els.recentFeed.querySelectorAll(".feed-item").forEach(item => item.addEventListener("click", () => {
    const cid = item.dataset.creator || DEFAULT_CREATOR_ID;
    if (state.creatorFilter === "all") setCreatorFilter(cid, { updateUrl: true, rerender: true });
    openDrawer(item.dataset.ticker, cid);
  }));
}

function findHolding(ticker, creatorId) {
  return state.holdings.find(x => x.ticker === ticker && creatorIdOf(x) === creatorId) || null;
}

function openDrawer(ticker, creatorId = state.creatorFilter === "all" ? DEFAULT_CREATOR_ID : state.creatorFilter) {
  const cid = creatorId === "all" ? DEFAULT_CREATOR_ID : creatorId;
  const h = findHolding(ticker, cid);
  if (!h) return;
  const events = eventsForTicker(ticker, cid);
  const quote = state.market[ticker];
  const status = statusMeta(h.state);
  const move = dayMove(quote);
  const latest = events[0];

  els.drawerContent.dataset.creatorId = cid;
  els.drawerContent.dataset.ticker = ticker;
  els.drawerContent.innerHTML = `
    <div class="drawer-hero">
      <div class="drawer-kicker">POSITION EVIDENCE FILE</div>
      <div class="drawer-title-row">
        <div><h2>${escapeHTML(h.ticker)}</h2><p>${escapeHTML(h.company || "")}</p><div class="drawer-creator-line">Creator <b>${escapeHTML(creatorName(cid))}</b></div></div>
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

    <div class="drawer-disclaimer">这里记录的是 ${escapeHTML(creatorName(cid))} 的公开披露及其证据链，不是券商账户证明。长期未提及只会降低时效性，不会自动生成 EXIT。</div>
  `;

  els.drawer.classList.add("open");
  els.drawer.setAttribute("aria-hidden", "false");
  els.drawerBackdrop.classList.remove("hidden");
  const url = new URL(window.location.href);
  url.searchParams.set("creator", cid);
  url.searchParams.set("ticker", ticker);
  history.replaceState(null, "", url);
}

function eventHTML(e) {
  return `
    <article class="timeline-event" data-event-id="${escapeAttr(e.id)}" data-creator="${escapeAttr(creatorIdOf(e))}">
      <span class="timeline-dot"></span>
      <div class="timeline-body">
        <div class="timeline-meta"><time>${formatDateTime(e.date)}</time><span>${escapeHTML(EVENT_LABELS[e.type] || e.type)}</span><b>${escapeHTML(e.confidence || "C")}</b></div>
        <p>${escapeHTML(e.summary || e.note || "")}</p>
        ${e.sourceUrl ? `<a href="${escapeAttr(e.sourceUrl)}" target="_blank" rel="noreferrer">证据来源 ↗</a>` : ""}
      </div>
    </article>`;
}

function eventsForTicker(ticker, creatorId = state.creatorFilter) {
  const cid = creatorId === "all" ? DEFAULT_CREATOR_ID : creatorId;
  return state.events
    .filter(e => e.ticker === ticker && creatorIdOf(e) === cid)
    .sort((a, b) => new Date(b.date) - new Date(a.date));
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
  delete els.drawerContent.dataset.creatorId;
  delete els.drawerContent.dataset.ticker;
  const url = new URL(window.location.href);
  url.searchParams.delete("ticker");
  history.replaceState(null, "", url);
}

function openTickerFromURL() {
  const url = new URL(window.location.href);
  const t = url.searchParams.get("ticker");
  if (!t) return;
  const requestedCreator = normalizeCreatorFilter(url.searchParams.get("creator") || state.creatorFilter);
  const cid = requestedCreator === "all" ? DEFAULT_CREATOR_ID : requestedCreator;
  if (state.creatorFilter !== cid) setCreatorFilter(cid, { updateUrl: false, rerender: true });
  openDrawer(t.toUpperCase(), cid);
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
els.creatorSwitcher?.addEventListener("click", e => {
  const btn = e.target.closest(".creator-tab");
  if (!btn) return;
  closeDrawer();
  setCreatorFilter(btn.dataset.creator, { updateUrl: true, rerender: true });
});
els.refreshBtn.addEventListener("click", () => loadData(true));
els.drawerClose.addEventListener("click", closeDrawer);
els.drawerBackdrop.addEventListener("click", closeDrawer);
document.addEventListener("keydown", e => { if (e.key === "Escape") closeDrawer(); });

loadData();

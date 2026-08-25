"use strict";

let marketPromise = null;

function githubMarketUrl() {
  const g = window.POSITION_LEDGER_CONFIG?.github || {};
  if (g.enabled && g.owner && g.repo && g.branch && g.dataDir) {
    return `https://raw.githubusercontent.com/${g.owner}/${g.repo}/${g.branch}/${g.dataDir}/market.json?v=${Date.now()}`;
  }
  return `./data/market.json?v=${Date.now()}`;
}

async function loadMarket(force = false) {
  if (!marketPromise || force) {
    marketPromise = fetch(githubMarketUrl(), { cache: "no-store" })
      .then((res) => {
        if (!res.ok) throw new Error(`market ${res.status}`);
        return res.json();
      })
      .catch((error) => {
        console.warn("Disclosure performance data unavailable", error);
        return { quotes: {} };
      });
  }
  return marketPromise;
}

function pctMeta(value) {
  if (value == null || Number.isNaN(Number(value))) {
    return { text: "—", className: "move-flat" };
  }
  const n = Number(value);
  return {
    text: `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`,
    className: n > 0 ? "move-up" : n < 0 ? "move-down" : "move-flat"
  };
}

function anchorTitle(anchor, label) {
  if (!anchor) return `${label}暂无可用市场锚点`;
  const date = anchor.sessionDate || "未知交易日";
  const price = anchor.price == null ? "—" : anchor.price;
  return `${label}：${date} 调整后收盘 ${price}；仅为公开披露后的市场表现，不是投资者真实成本收益率。`;
}

async function decorateLedger() {
  const table = document.querySelector(".ledger-table");
  const body = document.querySelector("#ledger-body");
  if (!table || !body) return;

  const payload = await loadMarket();
  const quotes = payload.quotes || {};

  body.querySelectorAll("tr[data-ticker]").forEach((row) => {
    const ticker = row.dataset.ticker;
    const anchor = quotes[ticker]?.firstDisclosureAnchor || null;
    const meta = pctMeta(anchor?.performancePct);
    const signature = `${ticker}|${anchor?.sessionDate || ""}|${anchor?.performancePct ?? ""}`;

    let cell = row.querySelector(".disclosure-performance-cell");
    if (!cell) {
      cell = document.createElement("td");
      cell.className = "num disclosure-performance-cell";
      cell.dataset.label = "披露后";
      const daily = [...row.children].find((td) => td.dataset.label === "日涨跌");
      if (daily?.nextSibling) row.insertBefore(cell, daily.nextSibling);
      else row.appendChild(cell);
    }
    if (cell.dataset.signature === signature) return;
    cell.dataset.signature = signature;
    cell.title = anchorTitle(anchor, "首次披露锚点");
    cell.innerHTML = `<span class="move ${meta.className}">${meta.text}</span><small>非成本</small>`;
  });

  body.querySelectorAll("td[colspan]").forEach((cell) => cell.setAttribute("colspan", "10"));
}

async function decorateDrawer() {
  const content = document.querySelector("#drawer-content");
  if (!content) return;
  const ticker = content.querySelector(".drawer-title-row h2")?.textContent?.trim();
  if (!ticker) return;

  const payload = await loadMarket();
  const quote = payload.quotes?.[ticker];
  if (!quote) return;

  const first = quote.firstDisclosureAnchor || null;
  const last = quote.lastActionAnchor || null;
  const firstMeta = pctMeta(first?.performancePct);
  const lastMeta = pctMeta(last?.performancePct);
  const signature = `${ticker}|${first?.performancePct ?? ""}|${last?.performancePct ?? ""}`;

  let panel = content.querySelector(".disclosure-performance-panel");
  if (!panel) {
    panel = document.createElement("section");
    panel.className = "disclosure-performance-panel";
    const metrics = content.querySelector(".drawer-metrics");
    if (metrics?.nextSibling) metrics.parentNode.insertBefore(panel, metrics.nextSibling);
    else content.appendChild(panel);
  }
  if (panel.dataset.signature === signature) return;
  panel.dataset.signature = signature;
  panel.innerHTML = `
    <div class="drawer-section-label">MARKET PERFORMANCE SINCE DISCLOSURE</div>
    <div class="performance-grid">
      <div title="${escapeAttr(anchorTitle(first, "首次披露锚点"))}">
        <span>首次披露后</span>
        <strong class="${firstMeta.className}">${firstMeta.text}</strong>
        <small>${first?.sessionDate || "无市场锚点"}</small>
      </div>
      <div title="${escapeAttr(anchorTitle(last, "最后动作锚点"))}">
        <span>最后动作后</span>
        <strong class="${lastMeta.className}">${lastMeta.text}</strong>
        <small>${last?.sessionDate || "无市场锚点"}</small>
      </div>
    </div>
    <p class="performance-disclaimer">这是公开披露日期对应交易日收盘价到当前价的市场表现，用于研究披露后的价格路径；不是 Serenity 的真实成本价或账户收益率。</p>
  `;
}

function escapeAttr(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    "\"": "&quot;"
  })[c]);
}

function markGitHubPagesHost() {
  if (location.hostname.endsWith("github.io")) {
    const pill = document.querySelector("#backend-pill");
    if (pill) pill.textContent = "GitHub Pages · Live";
  }
}

function scheduleDecorate() {
  queueMicrotask(() => {
    decorateLedger();
    decorateDrawer();
  });
}

function init() {
  markGitHubPagesHost();

  const body = document.querySelector("#ledger-body");
  const drawer = document.querySelector("#drawer-content");
  if (body) new MutationObserver(scheduleDecorate).observe(body, { childList: true, subtree: true });
  if (drawer) new MutationObserver(scheduleDecorate).observe(drawer, { childList: true, subtree: true });

  const refresh = document.querySelector("#refresh-btn");
  if (refresh) {
    refresh.addEventListener("click", () => {
      loadMarket(true);
      setTimeout(scheduleDecorate, 250);
      setTimeout(scheduleDecorate, 1000);
    });
  }

  scheduleDecorate();
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
else init();

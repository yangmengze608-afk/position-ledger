"use strict";

let auditEventsPromise = null;
let auditScheduled = false;

function auditDataUrl(name) {
  const g = window.POSITION_LEDGER_CONFIG?.github || {};
  if (g.enabled && g.owner && g.repo && g.branch && g.dataDir) {
    return `https://raw.githubusercontent.com/${g.owner}/${g.repo}/${g.branch}/${g.dataDir}/${name}.json?v=${Date.now()}`;
  }
  return `./data/${name}.json?v=${Date.now()}`;
}

function loadAuditEvents(force = false) {
  if (!auditEventsPromise || force) {
    auditEventsPromise = fetch(auditDataUrl("events"), { cache: "no-store" })
      .then(res => {
        if (!res.ok) throw new Error(`events ${res.status}`);
        return res.json();
      })
      .then(payload => payload.events || [])
      .catch(error => {
        console.warn("Evidence audit data unavailable", error);
        return [];
      });
  }
  return auditEventsPromise;
}

function auditEsc(value) {
  return String(value ?? "").replace(/[&<>"']/g, ch => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[ch]);
}

function auditDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false
  }).format(date);
}

function sourceTypeLabel(type) {
  const labels = {
    "x-original": "X 原始披露",
    "secondary-mirror": "二级镜像",
    "manual-resolution": "人工裁决",
    "manual-resolution-v1": "人工裁决",
    "x-syndication": "X Syndication",
    "fxembed-rss": "FxEmbed RSS"
  };
  return labels[type] || type || "公开来源";
}

function sourceLinkLabel(event) {
  if (!event?.sourceUrl) return "";
  if (event.sourceType === "x-original" || /x\.com\//.test(event.sourceUrl)) return "在 X 打开 ↗";
  return "打开来源 ↗";
}

function auditSignature(ticker, events) {
  return `${ticker}|${events.map(event => [
    event.id,
    event.sourceUrl,
    event.sourceType,
    event.sourcePostId,
    event.classifier,
    event.resolutionId,
    event.entityWarning,
    event.sourceHistory?.length || 0,
    event.sourceText?.length || 0
  ].join(":" )).join("|")}`;
}

function provenanceRows(events) {
  const rows = [];
  const seen = new Set();
  events.forEach(event => {
    const currentKey = `${event.id}|${event.sourceType}|${event.sourceUrl || ""}`;
    if (!seen.has(currentKey)) {
      seen.add(currentKey);
      rows.push({
        kind: "current",
        label: sourceTypeLabel(event.sourceType),
        date: event.date,
        url: event.sourceUrl,
        eventId: event.id
      });
    }
    (event.sourceHistory || []).forEach((item, index) => {
      const key = `${event.id}|history|${index}|${item.sourceUrl || ""}|${item.date || ""}`;
      if (seen.has(key)) return;
      seen.add(key);
      rows.push({
        kind: "history",
        label: sourceTypeLabel(item.sourceType),
        date: item.date,
        url: item.sourceUrl,
        eventId: event.id
      });
    });
  });
  return rows;
}

function resolutionCards(events) {
  return events.filter(event => event.resolutionId || event.resolutionSources?.length || event.entityWarning).map(event => {
    const officialSources = (event.resolutionSources || []).map((url, index) =>
      `<a href="${auditEsc(url)}" target="_blank" rel="noreferrer">核验来源 ${index + 1} ↗</a>`
    ).join("");
    return `
      <article class="resolution-card">
        <div class="resolution-top">
          <span>MANUAL RESOLUTION</span>
          <strong>${auditEsc(event.resolutionId || "entity review")}</strong>
        </div>
        ${event.entityWarning ? `<div class="entity-warning">⚠ ${auditEsc(event.entityWarning)}</div>` : ""}
        <dl class="resolution-meta">
          ${event.sourceEntityMention ? `<div><dt>原始实体</dt><dd>${auditEsc(event.sourceEntityMention)}</dd></div>` : ""}
          ${event.sourceCode ? `<div><dt>原始代码</dt><dd>${auditEsc(event.sourceCode)}</dd></div>` : ""}
          <div><dt>最终记录</dt><dd>${auditEsc(event.ticker)}</dd></div>
          <div><dt>证据等级</dt><dd>${auditEsc(event.confidence || "—")}</dd></div>
        </dl>
        ${event.note ? `<p class="resolution-reason">${auditEsc(event.note)}</p>` : ""}
        ${officialSources ? `<div class="resolution-links">${officialSources}</div>` : ""}
      </article>`;
  }).join("");
}

function provenanceHtml(events) {
  const rows = provenanceRows(events).slice(0, 12);
  if (!rows.length) return "";
  return `
    <section class="audit-provenance">
      <div class="audit-subhead"><span>PROVENANCE</span><small>canonical source trail</small></div>
      <div class="provenance-list">
        ${rows.map(row => `
          <div class="provenance-row ${row.kind === "history" ? "is-history" : ""}">
            <span class="provenance-node"></span>
            <div><strong>${auditEsc(row.label)}</strong><small>${auditDate(row.date)} · ${auditEsc(row.eventId)}</small></div>
            ${row.url ? `<a href="${auditEsc(row.url)}" target="_blank" rel="noreferrer">来源 ↗</a>` : ""}
          </div>`).join("")}
      </div>
    </section>`;
}

function latestOriginalHtml(event) {
  const hasOriginal = Boolean(event?.sourceText);
  const text = event?.sourceText || event?.summary || event?.note || "暂无文本记录";
  const sourceLink = event?.sourceUrl
    ? `<a class="audit-primary-link" href="${auditEsc(event.sourceUrl)}" target="_blank" rel="noreferrer">${auditEsc(sourceLinkLabel(event))}</a>`
    : "";
  return `
    <section class="audit-original">
      <div class="audit-subhead"><span>ORIGINAL DISCLOSURE</span><small>${hasOriginal ? "verbatim source text" : "摘要记录 · 非原文"}</small></div>
      <blockquote class="original-text ${hasOriginal ? "is-verbatim" : "is-summary"}">${auditEsc(text)}</blockquote>
      <div class="original-meta">
        <span>${auditEsc(sourceTypeLabel(event?.sourceType))}</span>
        <span>${auditDate(event?.date)}</span>
        <span>Evidence ${auditEsc(event?.confidence || "C")}</span>
        ${event?.classifier ? `<span>${auditEsc(event.classifier)}</span>` : ""}
        ${event?.sourcePostId ? `<span>Post ${auditEsc(event.sourcePostId)}</span>` : ""}
        ${sourceLink}
      </div>
    </section>`;
}

function deepLinkForTicker(ticker) {
  const url = new URL(window.location.href);
  url.searchParams.set("ticker", ticker);
  return url.toString();
}

async function copyText(text, button) {
  let ok = false;
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      ok = true;
    }
  } catch (_) {}
  if (!ok) {
    const input = document.createElement("textarea");
    input.value = text;
    input.setAttribute("readonly", "");
    input.style.position = "fixed";
    input.style.opacity = "0";
    document.body.appendChild(input);
    input.select();
    try { ok = document.execCommand("copy"); } catch (_) {}
    input.remove();
  }
  const original = button.textContent;
  button.textContent = ok ? "已复制 ✓" : "复制失败";
  setTimeout(() => { button.textContent = original; }, 1500);
}

function attachCopyButton(panel, ticker) {
  const button = panel.querySelector(".copy-deep-link");
  if (!button || button.dataset.bound) return;
  button.dataset.bound = "1";
  button.addEventListener("click", event => {
    event.preventDefault();
    event.stopPropagation();
    copyText(deepLinkForTicker(ticker), button);
  });
}

function timelineSourceHtml(event) {
  const text = event.sourceText || event.summary || event.note || "暂无文本记录";
  const original = Boolean(event.sourceText);
  return `
    <details class="timeline-source-details" data-event-id="${auditEsc(event.id)}">
      <summary>${original ? "查看原始披露" : "查看摘要记录"}<span>${auditEsc(sourceTypeLabel(event.sourceType))}</span></summary>
      <div class="timeline-source-body">
        <pre>${auditEsc(text)}</pre>
        <div class="timeline-source-meta">
          ${event.classifier ? `<span>${auditEsc(event.classifier)}</span>` : ""}
          ${event.sourcePostId ? `<span>Post ${auditEsc(event.sourcePostId)}</span>` : ""}
          ${event.entityWarning ? `<span class="inline-warning">${auditEsc(event.entityWarning)}</span>` : ""}
          ${event.sourceUrl ? `<a href="${auditEsc(event.sourceUrl)}" target="_blank" rel="noreferrer">${auditEsc(sourceLinkLabel(event))}</a>` : ""}
        </div>
      </div>
    </details>`;
}

function decorateTimeline(content, events) {
  const nodes = [...content.querySelectorAll(".timeline-event")];
  nodes.forEach((node, index) => {
    const event = events[index];
    if (!event) return;
    const existing = node.querySelector(".timeline-source-details");
    if (existing?.dataset.eventId === event.id) return;
    existing?.remove();
    node.insertAdjacentHTML("beforeend", timelineSourceHtml(event));
  });
}

function insertAuditPanel(content, panel) {
  const performance = content.querySelector(".disclosure-performance-panel");
  const latest = content.querySelector(".latest-evidence");
  const timeline = content.querySelector(".timeline-section");
  if (performance) performance.insertAdjacentElement("afterend", panel);
  else if (latest) latest.insertAdjacentElement("afterend", panel);
  else if (timeline) timeline.insertAdjacentElement("beforebegin", panel);
  else content.appendChild(panel);
}

async function decorateEvidenceDrawer() {
  const content = document.querySelector("#drawer-content");
  if (!content) return;
  const ticker = content.querySelector(".drawer-title-row h2")?.textContent?.trim();
  if (!ticker) return;

  const allEvents = await loadAuditEvents();
  const events = allEvents
    .filter(event => String(event.ticker).toUpperCase() === ticker.toUpperCase())
    .sort((a, b) => new Date(b.date) - new Date(a.date));
  if (!events.length) return;

  const signature = auditSignature(ticker, events);
  let panel = content.querySelector(".evidence-audit-panel");
  if (!panel) {
    panel = document.createElement("section");
    panel.className = "evidence-audit-panel";
    insertAuditPanel(content, panel);
  }

  if (panel.dataset.signature !== signature) {
    const latest = events[0];
    const resolutions = resolutionCards(events);
    panel.dataset.signature = signature;
    panel.innerHTML = `
      <div class="audit-header">
        <div><span class="drawer-section-label">EVIDENCE AUDIT</span><h3>原始披露与证据来源</h3></div>
        <button class="copy-deep-link" type="button">复制档案链接</button>
      </div>
      ${latestOriginalHtml(latest)}
      ${provenanceHtml(events)}
      ${resolutions ? `<section class="audit-resolutions"><div class="audit-subhead"><span>RESOLUTION</span><small>human-reviewed entity decisions</small></div>${resolutions}</section>` : ""}
      <p class="audit-footnote">Canonical 事件保留公开来源、分类器和人工裁决痕迹。这里展示的是证据链，不是券商账户对账单。</p>`;
  }
  attachCopyButton(panel, ticker);
  decorateTimeline(content, events);
}

function scheduleAudit() {
  if (auditScheduled) return;
  auditScheduled = true;
  queueMicrotask(async () => {
    auditScheduled = false;
    await decorateEvidenceDrawer();
  });
}

function initEvidenceDrawer() {
  const content = document.querySelector("#drawer-content");
  if (content) new MutationObserver(scheduleAudit).observe(content, { childList: true, subtree: true });
  const refresh = document.querySelector("#refresh-btn");
  if (refresh) refresh.addEventListener("click", () => {
    loadAuditEvents(true);
    setTimeout(scheduleAudit, 400);
  });
  scheduleAudit();
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initEvidenceDrawer, { once: true });
else initEvidenceDrawer();

"use strict";

let mentionsDataPromise = null;
let mentionsScheduled = false;

function mentionsDataUrl(name) {
  const g = window.POSITION_LEDGER_CONFIG?.github || {};
  if (g.enabled && g.owner && g.repo && g.branch && g.dataDir) {
    return `https://raw.githubusercontent.com/${g.owner}/${g.repo}/${g.branch}/${g.dataDir}/${name}.json?v=${Date.now()}`;
  }
  return `./data/${name}.json?v=${Date.now()}`;
}

function loadMentionsData(force = false) {
  if (!mentionsDataPromise || force) {
    mentionsDataPromise = Promise.all([
      fetch(mentionsDataUrl("raw_posts"), { cache: "no-store" }).then(res => res.ok ? res.json() : { posts: [] }),
      fetch(mentionsDataUrl("events"), { cache: "no-store" }).then(res => res.ok ? res.json() : { events: [] })
    ]).then(([raw, events]) => ({ posts: raw.posts || [], events: events.events || [] }))
      .catch(error => {
        console.warn("Related mentions unavailable", error);
        return { posts: [], events: [] };
      });
  }
  return mentionsDataPromise;
}

function mentionsEsc(value) {
  return String(value ?? "").replace(/[&<>"']/g, ch => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[ch]);
}

function mentionsDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false
  }).format(date);
}

function regexEscape(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function postMentionsTicker(post, ticker) {
  const normalized = String(ticker).toUpperCase();
  const cashtags = (post.cashtags || []).map(tag => String(tag).toUpperCase());
  if (cashtags.includes(normalized)) return true;

  const text = String(post.text || "");
  if (/^\d+$/.test(normalized)) {
    const escaped = regexEscape(normalized);
    return new RegExp(`\\(${escaped}(?:[),\\s])`, "i").test(text) || new RegExp(`\\$${escaped}\\b`, "i").test(text);
  }
  return new RegExp(`\\$${regexEscape(normalized)}\\b`, "i").test(text);
}

function excerpt(text, max = 240) {
  const clean = String(text || "").replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  return `${clean.slice(0, max - 1)}…`;
}

function insertMentionsPanel(content, panel) {
  const audit = content.querySelector(".evidence-audit-panel");
  const timeline = content.querySelector(".timeline-section");
  if (audit) audit.insertAdjacentElement("afterend", panel);
  else if (timeline) timeline.insertAdjacentElement("beforebegin", panel);
  else content.appendChild(panel);
}

async function decorateRelatedMentions() {
  const content = document.querySelector("#drawer-content");
  if (!content) return;
  const ticker = content.querySelector(".drawer-title-row h2")?.textContent?.trim();
  if (!ticker) return;

  const { posts, events } = await loadMentionsData();
  const eventUrls = new Set(events.filter(event => String(event.ticker).toUpperCase() === ticker.toUpperCase()).map(event => event.sourceUrl).filter(Boolean));
  const related = posts
    .filter(post => postMentionsTicker(post, ticker))
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, 6);

  let panel = content.querySelector(".related-mentions-panel");
  if (!related.length) {
    panel?.remove();
    return;
  }

  const signature = `${ticker}|${related.map(post => `${post.id}:${post.createdAt}`).join("|")}`;
  if (!panel) {
    panel = document.createElement("section");
    panel.className = "related-mentions-panel";
    insertMentionsPanel(content, panel);
  }
  if (panel.dataset.signature === signature) return;
  panel.dataset.signature = signature;

  panel.innerHTML = `
    <div class="mentions-head">
      <div><span class="drawer-section-label">RECENT PUBLIC MENTIONS</span><h3>近期相关公开讨论</h3></div>
      <span class="mentions-count">${related.length} / cache</span>
    </div>
    <p class="mentions-disclaimer">这里是与 ${mentionsEsc(ticker)} 相关的近期公开帖子上下文。普通提及不会改变持仓状态；只有通过事件分类与审核的披露才进入 canonical ledger。</p>
    <div class="mentions-list">
      ${related.map(post => {
        const isEvidence = eventUrls.has(post.sourceUrl);
        return `<article class="mention-card ${isEvidence ? "is-evidence" : ""}">
          <div class="mention-meta">
            <time>${mentionsDate(post.createdAt)}</time>
            <span>${post.isReply ? "回复" : "原创/帖子"}</span>
            <span>${mentionsEsc(post.sourceProvider || "public source")}</span>
            <b>${isEvidence ? "持仓证据" : "研究提及"}</b>
          </div>
          <p>${mentionsEsc(excerpt(post.text))}</p>
          <div class="mention-foot">
            <span>${(post.cashtags || []).slice(0, 6).map(tag => `$${tag}`).join(" · ") || "context"}</span>
            ${post.sourceUrl ? `<a href="${mentionsEsc(post.sourceUrl)}" target="_blank" rel="noreferrer">在 X 打开 ↗</a>` : ""}
          </div>
        </article>`;
      }).join("")}
    </div>`;
}

function scheduleMentions() {
  if (mentionsScheduled) return;
  mentionsScheduled = true;
  queueMicrotask(async () => {
    mentionsScheduled = false;
    await decorateRelatedMentions();
  });
}

function initMentions() {
  const content = document.querySelector("#drawer-content");
  if (content) new MutationObserver(scheduleMentions).observe(content, { childList: true, subtree: true });
  const refresh = document.querySelector("#refresh-btn");
  if (refresh) refresh.addEventListener("click", () => {
    loadMentionsData(true);
    setTimeout(scheduleMentions, 450);
  });
  scheduleMentions();
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initMentions, { once: true });
else initMentions();

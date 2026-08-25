"use strict";

const TUI_DEFAULT_CREATOR = "serenity";
const TUI_EVENT_LABELS = { OPEN:"建仓", ADD:"加仓", HOLD:"确认持有", REDUCE:"减仓", EXIT:"清仓", DENY:"明确否认", HISTORICAL:"历史披露" };
let tuiDataPromise = null;
let tuiSort = "confirmed";
let tuiScheduled = false;

function tuiCreatorId(value) {
  return String(value?.creatorId || value || TUI_DEFAULT_CREATOR).trim().toLowerCase() || TUI_DEFAULT_CREATOR;
}
function tuiActiveCreator() {
  return window.POSITION_LEDGER_RUNTIME?.activeCreatorId?.() || new URL(location.href).searchParams.get("creator") || TUI_DEFAULT_CREATOR;
}
function tuiCreatorName(id) {
  return window.POSITION_LEDGER_RUNTIME?.creatorName?.(id) || id || "Serenity";
}
function tuiMatchesCreator(value, filter = tuiActiveCreator()) {
  return filter === "all" || tuiCreatorId(value) === filter;
}
function tuiKey(value, ticker = value?.ticker) { return `${tuiCreatorId(value)}|${ticker || ""}`; }

function tuiDataUrl(name) {
  const g = window.POSITION_LEDGER_CONFIG?.github || {};
  if (g.enabled && g.owner && g.repo && g.branch && g.dataDir) return `https://raw.githubusercontent.com/${g.owner}/${g.repo}/${g.branch}/${g.dataDir}/${name}.json?v=${Date.now()}`;
  return `./data/${name}.json?v=${Date.now()}`;
}
function loadTuiData(force = false) {
  if (!tuiDataPromise || force) {
    tuiDataPromise = Promise.all([
      fetch(tuiDataUrl("holdings"), { cache:"no-store" }).then(r => r.json()),
      fetch(tuiDataUrl("events"), { cache:"no-store" }).then(r => r.json()),
      fetch(tuiDataUrl("market"), { cache:"no-store" }).then(r => r.json()),
      fetch(tuiDataUrl("creators"), { cache:"no-store" }).then(r => r.json())
    ]).then(([holdings, events, market, creators]) => ({
      holdings: holdings.holdings || [], events: events.events || [], market: market || { quotes:{} }, creators: creators.creators || []
    })).catch(error => {
      console.warn("Terminal enhancement data unavailable", error);
      return { holdings:[], events:[], market:{quotes:{}}, creators:[] };
    });
  }
  return tuiDataPromise;
}
function scopedTuiData(data) {
  const filter = tuiActiveCreator();
  return {
    ...data,
    holdings: data.holdings.filter(h => tuiMatchesCreator(h, filter)),
    events: data.events.filter(e => tuiMatchesCreator(e, filter))
  };
}
function tuiEsc(value) { return String(value ?? "").replace(/[&<>"']/g, ch => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[ch]); }
function tuiPct(value) {
  if (value == null || !Number.isFinite(Number(value))) return { text:"—", cls:"move-flat", n:null };
  const n = Number(value); return { text:`${n >= 0 ? "+" : ""}${n.toFixed(2)}%`, cls:n > 0 ? "move-up" : n < 0 ? "move-down" : "move-flat", n };
}
function tuiDayPct(quote) {
  if (!quote || quote.price == null || quote.previousClose == null || Number(quote.previousClose) === 0) return null;
  return (Number(quote.price) / Number(quote.previousClose) - 1) * 100;
}
function tuiMoney(value, currency) {
  if (value == null || !Number.isFinite(Number(value))) return "—";
  const n = Number(value); const digits = Math.abs(n) >= 100 ? 0 : 2;
  const number = n.toLocaleString("zh-CN", { minimumFractionDigits:digits, maximumFractionDigits:digits });
  if (currency === "USD") return `$${number}`; if (currency === "JPY") return `¥${number}`; if (currency === "TWD") return `NT$${number}`;
  if (currency === "SEK") return `${number} SEK`; if (currency === "GBp") return `${number}p`; if (currency === "CHF") return `CHF ${number}`;
  return currency ? `${number} ${currency}` : number;
}
function tuiDate(value, withTime = false) {
  const d = new Date(value); if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("zh-CN", withTime ? { month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hour12:false } : { year:"numeric",month:"2-digit",day:"2-digit" }).format(d);
}
function creatorAnchor(quote, creatorId, kind) {
  const cid = tuiCreatorId(creatorId);
  return quote?.creatorAnchors?.[cid]?.[kind] || (cid === TUI_DEFAULT_CREATOR ? quote?.[kind] : null) || null;
}
function creatorDeepLink(ticker, creatorId) {
  if (window.POSITION_LEDGER_RUNTIME?.deepLink) return window.POSITION_LEDGER_RUNTIME.deepLink(ticker, creatorId);
  const u = new URL(location.href); u.searchParams.set("creator", creatorId); u.searchParams.set("ticker", ticker); return u.toString();
}
function latestEventByKey(events) {
  const map = new Map();
  [...events].sort((a,b) => new Date(b.date)-new Date(a.date)).forEach(e => { const key = tuiKey(e); if (!map.has(key)) map.set(key,e); });
  return map;
}

async function renderPortfolioRibbon() {
  const host = document.querySelector("#portfolio-ribbon"); if (!host) return;
  const data = scopedTuiData(await loadTuiData());
  const { holdings, events, market, creators } = data;
  const filter = tuiActiveCreator();
  const counts = {
    live: holdings.filter(h=>h.state==="live").length,
    denial: holdings.filter(h=>h.state==="denial").length,
    archive: holdings.filter(h=>h.state==="archive").length,
    historical: holdings.filter(h=>h.state==="unconfirmed").length,
    events: events.length,
    tracked: holdings.length
  };
  const latestEvent = [...events].sort((a,b)=>new Date(b.date)-new Date(a.date))[0];
  const marketTime = market.updatedAt ? tuiDate(market.updatedAt,true) : "—";
  const creator = creators.find(c => c.id === filter);
  const title = filter === "all" ? "跨 Creator 公开持仓 · 证据追踪台" : `${tuiCreatorName(filter)} · 公开持仓证据台`;
  const source = creator?.profileUrl ? `<a href="${tuiEsc(creator.profileUrl)}" target="_blank" rel="noreferrer">原始主页 ↗</a>` : "";
  host.innerHTML = `
    <div class="portfolio-ribbon-head"><div><span class="portfolio-ribbon-kicker">PORTFOLIO · DAILY AUTO UPDATE</span><strong>${tuiEsc(title)}</strong><p>只统计已进入 canonical ledger 的公开披露；每个 Creator 独立记账，沉默不推断账户变化。</p></div>
      <div class="portfolio-ribbon-links">${source}<a href="https://github.com/yangmengze608-afk/position-ledger" target="_blank" rel="noreferrer">GitHub ↗</a></div></div>
    <div class="portfolio-count-grid">
      <div class="portfolio-count primary"><span>当前在持</span><strong>${counts.live}</strong><small>LIVE</small></div>
      <div class="portfolio-count negative"><span>明确否认</span><strong>${counts.denial}</strong><small>DENIAL</small></div>
      <div class="portfolio-count"><span>已清仓</span><strong>${counts.archive}</strong><small>EXIT</small></div>
      <div class="portfolio-count caution"><span>历史 / 未确认</span><strong>${counts.historical}</strong><small>HISTORICAL</small></div>
      <div class="portfolio-count"><span>已核验标的</span><strong>${counts.tracked}</strong><small>TRACKED</small></div>
      <div class="portfolio-count"><span>事件证据</span><strong>${counts.events}</strong><small>EVENTS</small></div>
    </div>
    <div class="portfolio-ribbon-foot"><span>最新事件 ${latestEvent ? `${tuiEsc(tuiCreatorName(tuiCreatorId(latestEvent)))} · ${tuiEsc(latestEvent.ticker)} · ${tuiEsc(TUI_EVENT_LABELS[latestEvent.type] || latestEvent.type)} · ${tuiDate(latestEvent.date,true)}` : "—"}</span><span>行情刷新 ${marketTime}</span><span class="ribbon-caveat">数量代表已核验证据覆盖，不代表完整券商账户。</span></div>`;
}

async function renderMarketTape() {
  const host = document.querySelector("#market-tape"); if (!host) return;
  const { holdings, market } = scopedTuiData(await loadTuiData()); const quotes = market.quotes || {};
  const rows = holdings.filter(h=>h.state==="live" && quotes[h.ticker]?.price != null).map(h => {
    const q = quotes[h.ticker], cid = tuiCreatorId(h), anchor = creatorAnchor(q,cid,"firstDisclosureAnchor");
    return { creatorId:cid, ticker:h.ticker, company:h.company, price:q.price, currency:q.currency, day:tuiDayPct(q), disclosure:anchor?.performancePct ?? null };
  }).sort((a,b)=>Math.abs(b.day ?? -Infinity)-Math.abs(a.day ?? -Infinity)).slice(0,6);
  host.innerHTML = rows.map(item => {
    const day=tuiPct(item.day), disclosure=tuiPct(item.disclosure);
    return `<a class="tape-item" href="${tuiEsc(creatorDeepLink(item.ticker,item.creatorId))}" title="打开 ${tuiEsc(tuiCreatorName(item.creatorId))} · ${tuiEsc(item.ticker)} 证据档案"><div><strong>${tuiEsc(item.ticker)}</strong><span>${tuiEsc(item.company||"")}</span></div><div class="tape-price">${tuiEsc(tuiMoney(item.price,item.currency))}</div><div class="tape-move ${day.cls}">${day.text}<small>今日</small></div><div class="tape-move ${disclosure.cls}">${disclosure.text}<small>${disclosure.n == null ? "待锚定" : "披露后"}</small></div></a>`;
  }).join("") || `<div class="tape-empty">行情更新后显示当前在持标的。</div>`;
}

async function renderEvidenceTape() {
  const host = document.querySelector("#recent-feed"); if (!host) return;
  const { events } = scopedTuiData(await loadTuiData());
  const filter=tuiActiveCreator(); const recent=[...events].sort((a,b)=>new Date(b.date)-new Date(a.date)).slice(0,10);
  const signature=`${filter}|${recent.map(e=>`${e.id}:${e.date}`).join("|")}`; if (host.dataset.tuiSignature===signature) return; host.dataset.tuiSignature=signature;
  host.innerHTML = recent.map(event => {
    const original=event.sourceText&&event.sourceText!==event.summary ? event.sourceText.replace(/\s+/g," ").trim().slice(0,160) : "";
    const sourceDomain=event.sourceType==="x-original"?"X 原帖":event.sourceType==="secondary-mirror"?"镜像来源":"公开来源";
    const cid=tuiCreatorId(event); const creatorTag=filter==="all"?`<span class="evidence-creator">${tuiEsc(tuiCreatorName(cid))}</span>`:"";
    return `<article class="evidence-tape-card"><div class="evidence-tape-top"><a class="evidence-ticker" href="${tuiEsc(creatorDeepLink(event.ticker,cid))}">${tuiEsc(event.ticker)}</a>${creatorTag}<span class="event-pill event-${String(event.type||"").toLowerCase()}">${tuiEsc(TUI_EVENT_LABELS[event.type]||event.type)}</span><span class="evidence-grade grade-${String(event.confidence||"C").toLowerCase()}">${tuiEsc(event.confidence||"C")}</span><time>${tuiDate(event.date,true)}</time></div><p class="evidence-cn">${tuiEsc(event.summary||event.note||"公开披露事件")}</p>${original?`<p class="evidence-original"><span>EN</span>${tuiEsc(original)}${event.sourceText.length>160?"…":""}</p>`:""}<div class="evidence-tape-foot"><span>${tuiEsc(sourceDomain)}</span>${event.sourceUrl?`<a href="${tuiEsc(event.sourceUrl)}" target="_blank" rel="noreferrer">打开原始证据 ↗</a>`:""}</div></article>`;
  }).join("");
}

async function decorateLedgerRows() {
  const body=document.querySelector("#ledger-body"); if(!body) return;
  const data=scopedTuiData(await loadTuiData()); const latest=latestEventByKey(data.events); const holdingsMap=new Map(data.holdings.map(h=>[tuiKey(h),h]));
  body.querySelectorAll("tr[data-ticker]").forEach(row=>{
    const cid=tuiCreatorId(row.dataset.creator), ticker=row.dataset.ticker, key=`${cid}|${ticker}`;
    const holding=holdingsMap.get(key), event=latest.get(key);
    row.classList.toggle("row-explicit",holding?.confidence==="A"); row.classList.toggle("row-human-reviewed",holding?.confidence==="B"&&/人工/.test(holding?.note||""));
    const actionCell=[...row.children].find(td=>td.dataset.label==="最后动作");
    if(actionCell&&event?.sourceUrl&&!actionCell.querySelector(".source-jump")){const link=document.createElement("a");link.className="source-jump";link.href=event.sourceUrl;link.target="_blank";link.rel="noreferrer";link.textContent="原推 ↗";link.addEventListener("click",e=>e.stopPropagation());actionCell.appendChild(link);}
    const asset=row.querySelector(".asset-cell"); if(asset&&holding&&!asset.querySelector(".asset-submeta")){const sub=document.createElement("small");sub.className="asset-submeta";const exchange=holding.exchange||data.market.quotes?.[ticker]?.exchange||"";sub.textContent=[exchange,`${holding.eventCount??0} 条证据`].filter(Boolean).join(" · ");asset.appendChild(sub);}
  });
  sortLedgerRows();
}

async function sortLedgerRows() {
  const body=document.querySelector("#ledger-body"); if(!body) return;
  const {holdings,market}=scopedTuiData(await loadTuiData()); const map=new Map(holdings.map(h=>[tuiKey(h),h])); const currentRows=[...body.querySelectorAll("tr[data-ticker]")];
  const valueFor=row=>{const cid=tuiCreatorId(row.dataset.creator),ticker=row.dataset.ticker,h=map.get(`${cid}|${ticker}`)||{},q=market.quotes?.[ticker]||{};if(tuiSort==="ticker")return `${ticker}|${cid}`;if(tuiSort==="daily")return tuiDayPct(q)??-Infinity;if(tuiSort==="disclosure")return creatorAnchor(q,cid,"firstDisclosureAnchor")?.performancePct??-Infinity;if(tuiSort==="first")return new Date(h.firstRecordedAt||0).getTime();return new Date(h.lastConfirmedAt||0).getTime();};
  const desired=[...currentRows].sort((a,b)=>{const av=valueFor(a),bv=valueFor(b);if(typeof av==="string")return av.localeCompare(bv);return bv-av;});
  const sig=rows=>rows.map(r=>`${r.dataset.creator}|${r.dataset.ticker}`).join("|"); if(sig(currentRows)===sig(desired)) return; const fragment=document.createDocumentFragment(); desired.forEach(r=>fragment.appendChild(r)); body.appendChild(fragment);
}

function bindSortControl(){const select=document.querySelector("#sort-order");if(!select||select.dataset.bound)return;select.dataset.bound="1";select.addEventListener("change",()=>{tuiSort=select.value;sortLedgerRows();});}
async function addTopSourceLinks(){const actions=document.querySelector(".top-actions");if(!actions)return;let wrap=actions.querySelector(".source-nav");if(!wrap){wrap=document.createElement("div");wrap.className="source-nav";actions.prepend(wrap);}const data=await loadTuiData();const filter=tuiActiveCreator();const creator=data.creators.find(c=>c.id===filter);wrap.innerHTML=`${creator?.profileUrl?`<a href="${tuiEsc(creator.profileUrl)}" target="_blank" rel="noreferrer">原始源</a>`:""}<a href="https://github.com/yangmengze608-afk/position-ledger" target="_blank" rel="noreferrer">Repo</a>`;}

function scheduleTui(){if(tuiScheduled)return;tuiScheduled=true;queueMicrotask(async()=>{tuiScheduled=false;await Promise.all([decorateLedgerRows(),renderEvidenceTape()]);});}
async function renderAllTui(force=false){if(force)loadTuiData(true);await Promise.all([renderPortfolioRibbon(),renderMarketTape(),renderEvidenceTape(),decorateLedgerRows(),addTopSourceLinks()]);}
async function initTerminalUi(){bindSortControl();await renderAllTui();const body=document.querySelector("#ledger-body");if(body)new MutationObserver(scheduleTui).observe(body,{childList:true,subtree:true});window.addEventListener("position-ledger:creatorchange",()=>renderAllTui());const refresh=document.querySelector("#refresh-btn");if(refresh)refresh.addEventListener("click",()=>{loadTuiData(true);setTimeout(()=>renderAllTui(),450);setTimeout(()=>renderAllTui(),1200);});}
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",initTerminalUi,{once:true});else initTerminalUi();

const ASSET_META = {
  AAOI: { name: "Applied Optoelectronics, Inc.", exchange: "NASDAQ" },
  AEHR: { name: "Aehr Test Systems", exchange: "NASDAQ" },
  CBRS: { name: "Cerebras Systems, Inc.", exchange: "NASDAQ" },
  CCXI: { name: "Churchill Capital Corp XI", exchange: "NASDAQ", context: "Agility Robotics SPAC" },
  MRNA: { name: "Moderna, Inc.", exchange: "NASDAQ" },
  MRVL: { name: "Marvell Technology, Inc.", exchange: "NASDAQ" },
  NVTS: { name: "Navitas Semiconductor Corporation", exchange: "NASDAQ" },
  ORCL: { name: "Oracle Corporation", exchange: "NYSE" },
  SPCX: { name: "Space Exploration Technologies Corp.", exchange: "NASDAQ" }
};

const TONE_CLASSES = Array.from({ length: 8 }, (_, i) => `tone-${i}`);

function stableToneIndex(ticker) {
  const text = String(ticker || "").toUpperCase();
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash >>> 0) % TONE_CLASSES.length;
}

function applyTone(element, ticker) {
  if (!element || !ticker) return;
  element.classList.remove(...TONE_CLASSES);
  element.classList.add("asset-tone", TONE_CLASSES[stableToneIndex(ticker)]);
  element.dataset.assetToneTicker = String(ticker).toUpperCase();
}

function enrichLedgerRow(row) {
  const ticker = String(row?.dataset?.ticker || "").toUpperCase();
  if (!ticker) return;
  applyTone(row, ticker);

  const meta = ASSET_META[ticker];
  if (!meta) return;
  const companyLine = row.querySelector(".asset-cell span");
  if (!companyLine) return;
  const next = `${meta.name} · ${meta.exchange}`;
  if (companyLine.textContent !== next) companyLine.textContent = next;
  if (meta.context) companyLine.title = meta.context;
}

function enrichFeedItem(item) {
  const ticker = String(item?.dataset?.ticker || "").toUpperCase();
  if (ticker) applyTone(item, ticker);
}

function enrichDrawer() {
  const drawerContent = document.querySelector("#drawer-content");
  const ticker = String(drawerContent?.dataset?.ticker || "").toUpperCase();
  if (!drawerContent || !ticker) return;
  applyTone(drawerContent, ticker);

  const meta = ASSET_META[ticker];
  if (!meta) return;
  const companyLine = drawerContent.querySelector(".drawer-title-row p");
  if (companyLine) {
    const context = meta.context ? ` · ${meta.context}` : "";
    const next = `${meta.name} · ${meta.exchange}${context}`;
    if (companyLine.textContent !== next) companyLine.textContent = next;
  }
}

function decorateAll() {
  document.querySelectorAll("#ledger-body tr[data-ticker]").forEach(enrichLedgerRow);
  document.querySelectorAll("#recent-feed .feed-item[data-ticker]").forEach(enrichFeedItem);
  enrichDrawer();
}

let scheduled = false;
function scheduleDecorate() {
  if (scheduled) return;
  scheduled = true;
  queueMicrotask(() => {
    scheduled = false;
    decorateAll();
  });
}

const observer = new MutationObserver(scheduleDecorate);
observer.observe(document.body, {
  childList: true,
  subtree: true,
  attributes: true,
  attributeFilter: ["data-ticker", "data-creator"]
});

window.addEventListener("position-ledger:creatorchange", scheduleDecorate);
window.addEventListener("popstate", scheduleDecorate);
scheduleDecorate();

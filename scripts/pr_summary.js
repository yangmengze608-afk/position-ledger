#!/usr/bin/env node
"use strict";
const fs = require("fs");
const path = require("path");
const ROOT = path.resolve(__dirname, "..");
const queue = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "review_queue.json"), "utf8"));
const creators = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "creators.json"), "utf8"));
const batchId = process.env.POSITION_DISCOVERY_BATCH || "";
const items = batchId
  ? (queue.items || []).filter((x) => x.batchId === batchId)
  : (queue.items || []);
const creatorNames = new Map((creators.creators || []).map((x) => [x.id, x.displayName || x.id]));
const creatorLabel = (x) => creatorNames.get(x.creatorId || "serenity") || x.creatorId || x.person || "Serenity";
const weightLabel = (x) => x.disclosedWeightPct == null ? "" : ` · ${Number(x.disclosedWeightPct).toFixed(1)}%${x.snapshotPeriod ? ` @ ${x.snapshotPeriod}` : ""}`;
const proposed = items.filter((x) => x.status === "proposed");
const pending = items.filter((x) => x.status === "pending");
console.log("## Automated position discovery\n");
if (batchId) console.log(`Discovery batch: \`${batchId}\`\n`);
console.log(`Proposed ledger events: **${proposed.length}**  `);
console.log(`Needs manual review: **${pending.length}**\n`);
if (proposed.length) {
  console.log("### Proposed events\n");
  for (const x of proposed.slice(0, 40)) {
    console.log(`- **${creatorLabel(x)} · ${x.ticker} · ${x.llm?.event_type || x.suggestedType}${weightLabel(x)}** — ${x.sourceUrl}`);
    console.log(`  - Evidence: \`${String(x.llm?.evidence || x.evidence || "").replace(/`/g, "'").slice(0, 180)}\``);
  }
}
if (pending.length) {
  console.log("\n### Review queue\n");
  for (const x of pending.slice(0, 40)) {
    console.log(`- **${creatorLabel(x)} · ${x.ticker} · ${x.suggestedType}${weightLabel(x)}** (${x.confidence}/${Number(x.score || 0).toFixed(2)}) — ${x.sourceUrl}`);
  }
}
if (!proposed.length && !pending.length) {
  console.log("No review-worthy candidate changes were produced in this batch.\n");
}
console.log("\nMerging this PR is the human approval step. No bot PR is auto-merged.");

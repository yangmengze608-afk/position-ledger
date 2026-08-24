#!/usr/bin/env node
"use strict";
const fs = require("fs");
const path = require("path");
const ROOT = path.resolve(__dirname, "..");
const queue = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "review_queue.json"), "utf8"));
const proposed = (queue.items || []).filter((x) => x.status === "proposed");
const pending = (queue.items || []).filter((x) => x.status === "pending");
console.log("## Automated position discovery\n");
console.log(`Proposed ledger events: **${proposed.length}**  `);
console.log(`Needs manual review: **${pending.length}**\n`);
if (proposed.length) {
  console.log("### Proposed events\n");
  for (const x of proposed.slice(0, 20)) {
    console.log(`- **${x.ticker} · ${x.llm?.event_type || x.suggestedType}** — ${x.sourceUrl}`);
    console.log(`  - Evidence: \`${String(x.llm?.evidence || x.evidence || "").replace(/`/g, "'").slice(0, 140)}\``);
  }
}
if (pending.length) {
  console.log("\n### Review queue\n");
  for (const x of pending.slice(0, 20)) {
    console.log(`- **${x.ticker}** (${x.confidence}/${Number(x.score || 0).toFixed(2)}) — ${x.sourceUrl}`);
  }
}
console.log("\nMerging this PR is the human approval step. No bot PR is auto-merged.");

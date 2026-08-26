"use strict";

function classifyPortfolioSnapshot(post) {
  const snapshot = post?.portfolioSnapshot;
  if (!snapshot?.complete || !Array.isArray(snapshot.items)) return null;

  const statement = String(snapshot.statement || "Complete first-party portfolio snapshot").trim();
  const results = [];
  for (const item of snapshot.items) {
    const ticker = String(item?.ticker || "").replace(/^\$/, "").toUpperCase();
    if (!ticker || ticker === "CASH") continue;
    const markers = Array.isArray(item.markers) ? item.markers : [];
    let suggestedType = "HOLD";
    if (markers.includes("trimmed-sold")) suggestedType = "REDUCE";
    else if (markers.includes("bought-added")) suggestedType = "ADD";

    results.push({
      ticker,
      suggestedType,
      confidence: "A",
      score: 0.995,
      evidence: `${statement} · ${item.raw || `$${ticker}`}`.slice(0, 240),
      classifier: "rules-v2.5-complete-portfolio",
      company: item.name || ticker,
      exchange: item.exchange || "",
      marketSymbol: item.marketSymbol || null,
      disclosedWeightPct: Number.isFinite(Number(item.weightPct)) ? Number(item.weightPct) : null,
      sourceMarkers: markers,
      snapshotPeriod: snapshot.period || null,
    });
  }
  return results;
}

module.exports = { classifyPortfolioSnapshot };

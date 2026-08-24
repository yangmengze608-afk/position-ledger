"use strict";

const DEFAULT_WINDOW_MS = 3 * 60 * 60 * 1000;

function timestamp(value) {
  const t = new Date(value || "").getTime();
  return Number.isFinite(t) ? t : null;
}

function findMirrorMatch(events, item, type, windowMs = DEFAULT_WINDOW_MS) {
  const targetTime = timestamp(item?.sourceDate);
  if (targetTime === null) return null;

  let best = null;
  let bestDelta = Infinity;
  for (const event of events || []) {
    if (event?.sourceType !== "secondary-mirror") continue;
    if (event.ticker !== item.ticker || event.type !== type) continue;
    if (event.person && item.person && event.person !== item.person) continue;
    const eventTime = timestamp(event.date);
    if (eventTime === null) continue;
    const delta = Math.abs(eventTime - targetTime);
    if (delta <= windowMs && delta < bestDelta) {
      best = event;
      bestDelta = delta;
    }
  }
  return best;
}

function upgradeMirrorEvent(event, item, type, classifier) {
  const oldSource = {
    sourceUrl: event.sourceUrl || "",
    sourceType: event.sourceType || "",
    date: event.date || "",
    summary: event.summary || "",
  };
  const history = Array.isArray(event.sourceHistory) ? [...event.sourceHistory] : [];
  if (oldSource.sourceUrl || oldSource.sourceType) history.push(oldSource);

  event.type = type;
  event.date = item.sourceDate;
  event.confidence = "A";
  event.summary = `原始公开披露：${(item.llm?.reason || item.evidence || type).slice(0, 180)}`;
  event.sourceUrl = item.sourceUrl;
  event.sourceType = "x-original";
  event.sourcePostId = item.sourcePostId;
  event.sourceText = item.sourceText;
  event.note = "V2 原始证据升级；保留旧镜像来源于 sourceHistory";
  event.classifier = classifier;
  event.sourceHistory = history;
  return event;
}

module.exports = { DEFAULT_WINDOW_MS, findMirrorMatch, upgradeMirrorEvent };

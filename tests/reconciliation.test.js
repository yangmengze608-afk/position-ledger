"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { findMirrorMatch, upgradeMirrorEvent } = require("../scripts/lib/event_reconciliation");

test("matches same ticker/type mirror inside 3h", () => {
  const events = [{ id:"seed", person:"Serenity", ticker:"CCXI", type:"OPEN", date:"2026-08-16T17:04:00+10:00", sourceType:"secondary-mirror", sourceUrl:"https://mirror" }];
  const item = { person:"Serenity", ticker:"CCXI", sourceDate:"2026-08-16T09:04:18Z" };
  assert.equal(findMirrorMatch(events, item, "OPEN")?.id, "seed");
});

test("does not merge a different type", () => {
  const events = [{ ticker:"AAOI", type:"HOLD", date:"2026-08-22T23:02:00+10:00", sourceType:"secondary-mirror" }];
  const item = { ticker:"AAOI", sourceDate:"2026-08-22T15:02:03Z" };
  assert.equal(findMirrorMatch(events, item, "ADD"), null);
});

test("does not merge outside time window", () => {
  const events = [{ ticker:"AAOI", type:"HOLD", date:"2026-08-22T10:00:00Z", sourceType:"secondary-mirror" }];
  const item = { ticker:"AAOI", sourceDate:"2026-08-22T15:02:03Z" };
  assert.equal(findMirrorMatch(events, item, "HOLD"), null);
});

test("upgrading preserves old source in sourceHistory", () => {
  const event = { id:"seed", ticker:"CCXI", type:"OPEN", date:"2026-08-16T17:04:00+10:00", sourceType:"secondary-mirror", sourceUrl:"https://mirror", summary:"mirror summary" };
  const item = { ticker:"CCXI", sourceDate:"2026-08-16T09:04:18Z", sourceUrl:"https://x.com/a/status/1", sourcePostId:"1", sourceText:"I bought $CCXI", evidence:"I bought" };
  upgradeMirrorEvent(event, item, "OPEN", "rules-v2.1-local");
  assert.equal(event.id, "seed");
  assert.equal(event.sourceType, "x-original");
  assert.equal(event.sourceHistory[0].sourceUrl, "https://mirror");
  assert.equal(event.date, "2026-08-16T09:04:18Z");
});

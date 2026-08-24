"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { classifyPost, extractTickers } = require("../scripts/lib/position_rules");
const fixtures = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "posts.json"), "utf8"));

function first(id) { return classifyPost(fixtures.find((x) => x.id === id))[0]; }

test("extracts dollar tickers", () => assert.deepEqual(extractTickers("$AAOI / $MU and $AAOI"), ["AAOI", "MU"]));
test("explicit still-have => HOLD A", () => { const x=first("1"); assert.equal(x.suggestedType,"HOLD"); assert.equal(x.confidence,"A"); });
test("explicit added => ADD A", () => { const x=first("2"); assert.equal(x.suggestedType,"ADD"); assert.equal(x.confidence,"A"); });
test("explicit bought => OPEN A", () => { const x=first("3"); assert.equal(x.suggestedType,"OPEN"); });
test("still have sizeable => HOLD", () => { const x=first("4"); assert.equal(x.suggestedType,"HOLD"); });
test("research mention only => ignored", () => assert.equal(classifyPost(fixtures.find((x)=>x.id==="5")).length,0));
test("explicit don't hold => DENY", () => { const x=first("6"); assert.equal(x.suggestedType,"DENY"); });
test("trimmed => REDUCE", () => { const x=first("7"); assert.equal(x.suggestedType,"REDUCE"); });
test("mixed polarity stays ticker-specific", () => {
  const out=classifyPost(fixtures.find((x)=>x.id==="8"));
  const by=Object.fromEntries(out.map((x)=>[x.ticker,x.suggestedType]));
  assert.equal(by["AMS-OSRAM"],"DENY");
  assert.equal(by["SIVE"],"HOLD");
});
test("numeric cashtag comes from X entity, not dollar amount regex", () => {
  assert.deepEqual(extractTickers("paid $2000, bought $AAOI", ["2494"]), ["2494","AAOI"]);
});

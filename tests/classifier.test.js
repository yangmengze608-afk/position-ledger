"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { classifyPost, extractTickers, localScopeForTicker } = require("../scripts/lib/position_rules");
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

test("GOOGL humanoid 'we have' is not a holding", () => {
  const out = classifyPost({ text: "After watching clips... Still can't believe $GOOGL sold Boston Dynamics, don't think we have another humanoid that can backflip." });
  assert.deepEqual(out, []);
});

test("distant position disclosure does not attach to earlier MU ticker", () => {
  const text = "If you get Vietnam flashbacks like I do to $MU / Samsung / SK Hynix -> Legacy DRAM. My thesis is we'll see the same thing here maybe late H2, early 2027 with consumer MLCCs. Lots of supply discussion. More channel checks. Taiyo Yuden (6976, disclosure: I have positions) would be a major beneficiary.";
  assert.deepEqual(classifyPost({ text, cashtags: ["MU"] }), []);
});

test("single ticker may borrow the next tickerless clause for OPEN", () => {
  const out = classifyPost({ text: "I really like $CCXI. I bought around the announcement." });
  assert.equal(out[0].ticker, "CCXI");
  assert.equal(out[0].suggestedType, "OPEN");
});

test("numeric entity ticker may borrow adjacent clause for ADD", () => {
  const out = classifyPost({ text: "Walsin $2494 is top 4 globally. I actually added some recently.", cashtags: ["2494"] });
  assert.equal(out[0].ticker, "2494");
  assert.equal(out[0].suggestedType, "ADD");
});

test("mixed tickers do not borrow each other's clauses", () => {
  const out = classifyPost({ text: "I don't hold $AAA. I own $BBB." });
  const by = Object.fromEntries(out.map((x) => [x.ticker, x.suggestedType]));
  assert.equal(by.AAA, "DENY");
  assert.equal(by.BBB, "HOLD");
});

test("local scope stays near the target ticker", () => {
  const text = "$MU legacy DRAM. unrelated sentence. more unrelated. 6976 disclosure: I have positions.";
  assert.equal(localScopeForTicker(text, "MU"), "$MU legacy DRAM. unrelated sentence");
});

test("explicit multi-stock ADD list inherits the action for every listed ticker", () => {
  const text = "This week I added to the following amounts to the following stocks:\n$SPCX → $20,000\n$CBRS → $20,000\n$ORCL → $20,000\n$NVTS → $5,000\n$CCXI → $5,000";
  const out = classifyPost({ text });
  const by = Object.fromEntries(out.map((x) => [x.ticker, x]));
  for (const ticker of ["SPCX", "CBRS", "ORCL", "NVTS", "CCXI"]) {
    assert.equal(by[ticker].suggestedType, "ADD");
    assert.equal(by[ticker].confidence, "A");
    assert.equal(by[ticker].classifier, "rules-v2.2-list");
  }
});

test("ordinary ticker list without an explicit portfolio action stays ignored", () => {
  const out = classifyPost({ text: "Stocks I like this week:\n$AAOI\n$MU\n$ORCL" });
  assert.deepEqual(out, []);
});

test("explicit bought-following list becomes OPEN rather than generic mentions", () => {
  const out = classifyPost({ text: "I bought the following stocks:\n$AAA → starter\n$BBB → starter" });
  const by = Object.fromEntries(out.map((x) => [x.ticker, x.suggestedType]));
  assert.equal(by.AAA, "OPEN");
  assert.equal(by.BBB, "OPEN");
});

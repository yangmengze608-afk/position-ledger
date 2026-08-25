"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { classifyPost, extractTickers, localScopeForTicker, contextualSecurityMentions } = require("../scripts/lib/position_rules");
const { canPromote } = require("../scripts/propose_events");
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
  const text = "If you get Vietnam flashbacks like I do to $MU / Samsung / SK Hynix -> Legacy DRAM. My thesis is we'll see the same thing here maybe late H2, early 2027 with consumer MLCCs. Lots of supply discussion. More channel checks. Unknown Company (6976, disclosure: I have positions) would be a major beneficiary.";
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
  const text = "$MU legacy DRAM. unrelated sentence. more unrelated. Unknown Company 6976 disclosure: I have positions.";
  assert.equal(localScopeForTicker(text, "MU"), "$MU legacy DRAM. unrelated sentence");
});

test("explicit multi-stock ADD list inherits the action for every listed ticker", () => {
  const text = "This week I added to the following amounts to the following stocks:\n$SPCX → $20,000\n$CBRS → $20,000\n$ORCL → $20,000\n$NVTS → $5,000\n$CCXI → $5,000";
  const out = classifyPost({ text });
  const by = Object.fromEntries(out.map((x) => [x.ticker, x]));
  for (const ticker of ["SPCX", "CBRS", "ORCL", "NVTS", "CCXI"]) {
    assert.equal(by[ticker].suggestedType, "ADD");
    assert.equal(by[ticker].confidence, "A");
    assert.equal(by[ticker].classifier, "rules-v2.4-list");
  }
});

test("ordinary ticker list without an explicit portfolio action stays ignored", () => {
  const out = classifyPost({ text: "Stocks I like this week:\n$AAOI\n$MU\n$ORCL" });
  assert.deepEqual(out, []);
});

test("explicit bought-following list becomes OPEN rather than generic mentions", () => {
  const out = classifyPost({ text: "I bought the following stocks:\n$AAA → starter\n$BBB → starter" });
  const by = Object.fromEntries(out.map((x) => [x.ticker, x.suggestedType]));
  assert.equal(by.AAA,"OPEN");
  assert.equal(by.BBB,"OPEN");
});

test("catalog resolves Taiyo Yuden parenthetical numeric ticker without X cashtag entities", () => {
  const text = "Companies with large market share like Taiyo Yuden (6976, disclosure: I have positions) would be a major beneficiary.";
  assert.deepEqual(extractTickers(text), ["6976"]);
  const out = classifyPost({ text });
  assert.equal(out.length, 1);
  assert.equal(out[0].ticker, "6976");
  assert.equal(out[0].suggestedType, "HOLD");
  assert.equal(out[0].confidence, "A");
  assert.equal(out[0].company, "Taiyo Yuden Co., Ltd.");
  assert.equal(out[0].exchange, "TSE");
  assert.equal(out[0].entityWarning, null);
  assert.equal(out[0].classifier, "rules-v2.3-contextual-numeric");
});

test("Walsin source-code mismatch resolves canonical security but cannot auto-promote", () => {
  const text = "Walsin (2494) is top 4 globally in MLCC market share (I actually added some recently to track how this guess plays out).";
  const mentions = contextualSecurityMentions(text);
  assert.equal(mentions[0].ticker, "2492");
  assert.equal(mentions[0].rawCode, "2494");
  assert.match(mentions[0].entityWarning, /2494!=2492/);
  assert.deepEqual(extractTickers(text, ["2494"]), ["2492"]);
  const out = classifyPost({ text, cashtags: ["2494"] });
  assert.equal(out.length, 1);
  assert.equal(out[0].ticker, "2492");
  assert.equal(out[0].suggestedType, "ADD");
  assert.equal(out[0].confidence, "B");
  assert.equal(out[0].classifier, "rules-v2.3-entity-mismatch");
  assert.equal(canPromote({ ...out[0], llm: { explicit: true, event_type: "ADD", confidence: 0.99 } }), false);
});

test("unknown numbers, years and amounts never become contextual numeric tickers", () => {
  const text = "Acme (2026) shipped 3008 units and generated $4.5B; I added some recently.";
  assert.deepEqual(extractTickers(text), []);
  assert.deepEqual(classifyPost({ text }), []);
});

test("still have a sizeable EWY position remains explicit HOLD A", () => {
  const out = classifyPost({ text: "I still have a sizeable position in $EWY even after realizing gains." });
  assert.equal(out.length, 1);
  assert.equal(out[0].ticker, "EWY");
  assert.equal(out[0].suggestedType, "HOLD");
  assert.equal(out[0].confidence, "A");
});

test("first-person conviction position is an explicit HOLD A", () => {
  const out = classifyPost({ text: "$EOS.AX has been flying recently. One of my highest conviction positions. Surprised this name isn't talked about more." });
  assert.equal(out.length, 1);
  assert.equal(out[0].ticker, "EOS.AX");
  assert.equal(out[0].suggestedType, "HOLD");
  assert.equal(out[0].confidence, "A");
  assert.match(out[0].evidence, /my highest conviction positions/i);
});

test("first-person core or largest holding phrasing is an explicit HOLD", () => {
  for (const text of [
    "$AAA remains one of my largest holdings.",
    "$AAA is my core position.",
    "$AAA is one of our top positions.",
  ]) {
    const out = classifyPost({ text });
    assert.equal(out.length, 1, text);
    assert.equal(out[0].suggestedType, "HOLD", text);
    assert.equal(out[0].confidence, "A", text);
  }
});

test("second-person biggest-holding rhetoric does not become the author's position", () => {
  const out = classifyPost({ text: "Good day when one of your biggest holdings is up 13%. $EOS.AX." });
  assert.deepEqual(out, []);
});

test("third-party fund position language stays ignored", () => {
  const out = classifyPost({ text: "$EOS.AX is one of the largest positions in the fund." });
  assert.deepEqual(out, []);
});

test("explicit not-started position is a DENY when ticker-local", () => {
  const out = classifyPost({ text: "$ABC looks interesting. I have not started a position." });
  assert.equal(out.length, 1);
  assert.equal(out[0].ticker, "ABC");
  assert.equal(out[0].suggestedType, "DENY");
  assert.equal(out[0].confidence, "A");
});

test("future rotation targets do not inherit a current holding from an adjacent clause", () => {
  const text = "@CKCapitalxx one of my holdings! I'm incredibly curious as well and I may sell all my $AAOI holdings and move it to $CRDO & $ALAB ! Better management";
  const out = classifyPost({ text });
  const by = Object.fromEntries(out.map((x) => [x.ticker, x]));
  assert.equal(by.AAOI.suggestedType, "HOLD");
  assert.equal(by.AAOI.confidence, "A");
  assert.equal(by.CRDO, undefined);
  assert.equal(by.ALAB, undefined);
});

test("explicit own-none disclosure is DENY rather than HOLD", () => {
  const out = classifyPost({ text: "Incredible! Sadly I own none! $MRNA Moderna calls are up today." });
  assert.equal(out.length, 1);
  assert.equal(out[0].ticker, "MRNA");
  assert.equal(out[0].suggestedType, "DENY");
  assert.equal(out[0].confidence, "A");
});

test("selling an explicit percentage is REDUCE rather than EXIT", () => {
  const out = classifyPost({ text: "Also why I sold 50% of my $AEHR this morning at 128! Risk reward favors the sale and repurchase!" });
  assert.equal(out.length, 1);
  assert.equal(out[0].ticker, "AEHR");
  assert.equal(out[0].suggestedType, "REDUCE");
  assert.equal(out[0].confidence, "A");
});

test("selling all remains EXIT after partial-sale hardening", () => {
  const out = classifyPost({ text: "I sold all my $AEHR today and I'm out." });
  assert.equal(out.length, 1);
  assert.equal(out[0].ticker, "AEHR");
  assert.equal(out[0].suggestedType, "EXIT");
  assert.equal(out[0].confidence, "A");
});

test("inline explicit multi-stock ADD list is A-grade for every listed ticker", () => {
  const text = "After Unitrees phenomenal debut today, why are you still not buying $CCXI yet? This week I added to the following amounts to the following stocks: $SPCX → $20,000 $CBRS → $20,000 $ORCL → $20,000 $NVTS → $5,000 $CCXI → $5,000";
  const out = classifyPost({ text });
  const by = Object.fromEntries(out.map((x) => [x.ticker, x]));
  for (const ticker of ["SPCX", "CBRS", "ORCL", "NVTS", "CCXI"]) {
    assert.equal(by[ticker].suggestedType, "ADD", ticker);
    assert.equal(by[ticker].confidence, "A", ticker);
    assert.equal(by[ticker].classifier, "rules-v2.4-list", ticker);
  }
});

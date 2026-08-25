"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const read = (name) => fs.readFileSync(path.join(ROOT, name), "utf8");

test("core table and drawer preserve creator identity in DOM", () => {
  const app = read("app.js");
  assert.match(app, /data-creator=/);
  assert.match(app, /drawerContent\.dataset\.creatorId/);
  assert.match(app, /creatorIdOf\(e\) === cid/);
  assert.match(app, /url\.searchParams\.set\("creator"/);
});

test("evidence audit filters by creator and ticker", () => {
  const source = read("evidence-drawer-ui.js");
  assert.match(source, /auditCreatorId\(e\)===creatorId/);
  assert.match(source, /content\.dataset\.creatorId/);
  assert.match(source, /deepLinkForTicker\(ticker,creatorId\)/);
});

test("related mentions filter raw posts by creator", () => {
  const source = read("mentions-ui.js");
  assert.match(source, /mentionsCreatorId\(post\)===creatorId/);
  assert.match(source, /mentionsCreatorId\(e\)===creatorId/);
});

test("legacy market disclosure anchors cannot leak to another creator", () => {
  const performance = read("performance-ui.js");
  const terminal = read("terminal-ui.js");
  assert.match(performance, /cid === PERF_DEFAULT_CREATOR/);
  assert.match(terminal, /cid === TUI_DEFAULT_CREATOR/);
});

test("creator switcher is wired in the page", () => {
  const html = read("index.html");
  assert.match(html, /id="creator-switcher"/);
  assert.match(html, /creator-ui\.css/);
});

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  stripHtml,
  extractLetterCashtags,
  parseFxRss,
  parseNitterHtml,
} = require("../scripts/fetch_x_timeline.js");

const account = {
  person: "Serenity",
  handle: "aleabitoreddit",
  includeReplies: true,
  maxAgeDays: 9999,
};

test("stripHtml decodes entities and line breaks", () => {
  assert.equal(stripHtml("<![CDATA[<p>I still hold $AAOI &amp; $SIVE</p><br>yes]]>"), "I still hold $AAOI & $SIVE\nyes");
});

test("fallback cashtags only accept letter-led symbols", () => {
  assert.deepEqual(extractLetterCashtags("$AAOI $SIVE.ST $AMS-OSRAM $2494 $2000"), ["AAOI", "SIVE.ST", "AMS-OSRAM"]);
});

test("FxEmbed RSS parser returns canonical X posts", () => {
  const xml = `<?xml version="1.0"?><rss><channel>
    <item>
      <title><![CDATA[Replying to @someone]]></title>
      <guid>https://twitter.com/aleabitoreddit/status/1990000000000000001</guid>
      <link>https://twitter.com/aleabitoreddit/status/1990000000000000001</link>
      <pubDate>Mon, 24 Aug 2026 12:00:00 GMT</pubDate>
      <description><![CDATA[<p>I still hold $AAOI and $SIVE.</p>]]></description>
    </item>
  </channel></rss>`;
  const posts = parseFxRss(xml, account);
  assert.equal(posts.length, 1);
  assert.equal(posts[0].id, "1990000000000000001");
  assert.equal(posts[0].sourceUrl, "https://x.com/aleabitoreddit/status/1990000000000000001");
  assert.deepEqual(posts[0].cashtags, ["AAOI", "SIVE"]);
  assert.equal(posts[0].isReply, true);
  assert.equal(posts[0].sourceProvider, "fxembed-rss");
});

test("Nitter HTML parser extracts timeline item", () => {
  const html = `
    <div class="timeline-item">
      <a class="tweet-link" href="/aleabitoreddit/status/1990000000000000002"></a>
      <span class="tweet-date"><a href="/aleabitoreddit/status/1990000000000000002" title="Aug 24, 2026 · 12:10 PM UTC">now</a></span>
      <div class="replying-to">Replying to @x</div>
      <div class="tweet-content media-body">I added to $POET &amp; still hold $AAOI.</div>
    </div>`;
  const posts = parseNitterHtml(html, account, "xcancel.com");
  assert.equal(posts.length, 1);
  assert.equal(posts[0].id, "1990000000000000002");
  assert.deepEqual(posts[0].cashtags, ["POET", "AAOI"]);
  assert.equal(posts[0].isReply, true);
  assert.equal(posts[0].sourceProvider, "nitter-html:xcancel.com");
});

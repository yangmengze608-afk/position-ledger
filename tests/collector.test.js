"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  stripHtml,
  extractLetterCashtags,
  sourceStatusHandle,
  canonicalXUrl,
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

test("status author is derived from the source URL", () => {
  assert.equal(sourceStatusHandle("https://twitter.com/CKCapitalxx/status/2090877926774653345"), "CKCapitalxx");
  assert.equal(sourceStatusHandle("/aleabitoreddit/status/1990000000000000001"), "aleabitoreddit");
});

test("canonical URL never rewrites a foreign source author to the configured account", () => {
  assert.equal(
    canonicalXUrl("https://twitter.com/OtherInvestor/status/2090877926774653345", "CKCapitalxx", "2090877926774653345"),
    "https://x.com/OtherInvestor/status/2090877926774653345"
  );
});

test("FxEmbed RSS parser returns canonical X posts only for the configured author", () => {
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
  assert.equal(posts[0].sourceAuthor, "aleabitoreddit");
  assert.deepEqual(posts[0].cashtags, ["AAOI", "SIVE"]);
  assert.equal(posts[0].isReply, true);
  assert.equal(posts[0].sourceProvider, "fxembed-rss");
});

test("FxEmbed author comparison is case-insensitive", () => {
  const xml = `<?xml version="1.0"?><rss><channel>
    <item>
      <guid>https://twitter.com/CKCAPITALXX/status/2090000000000000001</guid>
      <link>https://twitter.com/CKCAPITALXX/status/2090000000000000001</link>
      <pubDate>Mon, 24 Aug 2026 12:00:00 GMT</pubDate>
      <description><![CDATA[<p>I bought $TEST.</p>]]></description>
    </item>
  </channel></rss>`;
  const posts = parseFxRss(xml, { ...account, person: "CK Capital", handle: "CKCapitalxx" });
  assert.equal(posts.length, 1);
  assert.equal(posts[0].sourceAuthor, "CKCAPITALXX");
});

test("FxEmbed RSS rejects a foreign author's reply instead of attributing it to the tracked creator", () => {
  const xml = `<?xml version="1.0"?><rss><channel>
    <item>
      <title><![CDATA[Replying to @CKCapitalxx]]></title>
      <guid>https://twitter.com/OtherInvestor/status/2090877926774653345</guid>
      <link>https://twitter.com/OtherInvestor/status/2090877926774653345</link>
      <pubDate>Fri, 21 Aug 2026 19:05:19 GMT</pubDate>
      <description><![CDATA[<p>@CKCapitalxx Solid names for sure. I own $FORM and $AMKR.</p>]]></description>
    </item>
  </channel></rss>`;
  const posts = parseFxRss(xml, { ...account, person: "CK Capital", handle: "CKCapitalxx" });
  assert.equal(posts.length, 0);
});

test("Nitter HTML parser extracts target-account timeline item", () => {
  const html = `
    <div class="timeline-item">
      <a class="tweet-link" href="/aleabitoreddit/status/1990000000000000002"></a>
      <span class="tweet-date"><a href="/aleabitoreddit/status/1990000000000000002" title="Aug 24, 2026 · 12:10 PM UTC">now</a></span>
      <div class="replying-to">Replying to @x</div>
      <div class="tweet-content media-body">I added to $POET &amp; still hold $AAOI.</div>
    </div>`;
  const posts = parseNitterHtml(html, account, "xcancel.com");
  assert.equal(posts.length, 1);
  assert.equal(posts[0].sourceAuthor, "aleabitoreddit");
  assert.equal(posts[0].id, "1990000000000000002");
  assert.deepEqual(posts[0].cashtags, ["POET", "AAOI"]);
  assert.equal(posts[0].isReply, true);
  assert.equal(posts[0].sourceProvider, "nitter-html:xcancel.com");
});

test("Nitter fallback rejects foreign-author timeline items", () => {
  const html = `
    <div class="timeline-item">
      <a class="tweet-link" href="/OtherInvestor/status/2090877926774653345"></a>
      <span class="tweet-date"><a href="/OtherInvestor/status/2090877926774653345" title="Aug 21, 2026 · 7:05 PM UTC">now</a></span>
      <div class="replying-to">Replying to @CKCapitalxx</div>
      <div class="tweet-content media-body">@CKCapitalxx I own $FORM and $AMKR.</div>
    </div>`;
  const posts = parseNitterHtml(html, { ...account, person: "CK Capital", handle: "CKCapitalxx" }, "xcancel.com");
  assert.equal(posts.length, 0);
});

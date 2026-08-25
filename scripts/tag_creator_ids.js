#!/usr/bin/env node
"use strict";

const fs = require("fs/promises");
const path = require("path");
const { DEFAULT_CREATOR_ID, normalizeCreatorId } = require("./lib/creator_identity");

const ROOT = path.resolve(__dirname, "..");
const RAW_PATH = path.join(ROOT, "data", "raw_posts.json");
const ACCOUNTS_PATH = path.join(ROOT, "data", "source_accounts.json");
const CREATORS_PATH = path.join(ROOT, "data", "creators.json");

async function readJson(file, fallback) {
  try { return JSON.parse(await fs.readFile(file, "utf8")); }
  catch { return fallback; }
}

function buildCreatorLookup(accountsPayload, creatorsPayload) {
  const byHandle = new Map();
  const byPerson = new Map();

  for (const creator of creatorsPayload.creators || []) {
    const id = normalizeCreatorId(creator.id);
    if (creator.handle) byHandle.set(String(creator.handle).toLowerCase(), id);
    if (creator.displayName) byPerson.set(String(creator.displayName).toLowerCase(), id);
    for (const alias of creator.aliases || []) byPerson.set(String(alias).toLowerCase(), id);
  }

  for (const account of accountsPayload.accounts || []) {
    const id = normalizeCreatorId(account.creatorId || byHandle.get(String(account.handle || "").toLowerCase()) || DEFAULT_CREATOR_ID);
    if (account.handle) byHandle.set(String(account.handle).toLowerCase(), id);
    if (account.person) byPerson.set(String(account.person).toLowerCase(), id);
  }

  return { byHandle, byPerson };
}

function resolveCreatorId(post, lookup) {
  if (post.creatorId) return normalizeCreatorId(post.creatorId);
  const handle = String(post.handle || "").toLowerCase();
  const person = String(post.person || "").toLowerCase();
  return lookup.byHandle.get(handle) || lookup.byPerson.get(person) || DEFAULT_CREATOR_ID;
}

async function main() {
  const [raw, accounts, creators] = await Promise.all([
    readJson(RAW_PATH, { schemaVersion: 1, posts: [] }),
    readJson(ACCOUNTS_PATH, { accounts: [] }),
    readJson(CREATORS_PATH, { creators: [] }),
  ]);
  const lookup = buildCreatorLookup(accounts, creators);
  let changed = 0;

  for (const post of raw.posts || []) {
    const creatorId = resolveCreatorId(post, lookup);
    if (post.creatorId !== creatorId) {
      post.creatorId = creatorId;
      changed += 1;
    }
  }

  if (!changed) {
    console.log(`[creator] raw posts already scoped; total=${(raw.posts || []).length}`);
    return;
  }
  raw.schemaVersion = Math.max(Number(raw.schemaVersion || 1), 2);
  await fs.writeFile(RAW_PATH, JSON.stringify(raw, null, 2) + "\n", "utf8");
  console.log(`[creator] tagged=${changed}; total=${(raw.posts || []).length}`);
}

if (require.main === module) {
  main().catch((error) => { console.error(error); process.exit(1); });
}

module.exports = { buildCreatorLookup, resolveCreatorId };

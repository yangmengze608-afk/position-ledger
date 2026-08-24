#!/usr/bin/env python3
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
raw = json.loads((ROOT / "data/raw_posts.json").read_text())
queue = json.loads((ROOT / "data/review_queue.json").read_text())
sources = json.loads((ROOT / "data/source_accounts.json").read_text())

post_ids = [p["id"] for p in raw.get("posts", [])]
assert len(post_ids) == len(set(post_ids)), "duplicate raw post ids"
item_ids = [i["id"] for i in queue.get("items", [])]
assert len(item_ids) == len(set(item_ids)), "duplicate review item ids"
assert all(i.get("status") in {"pending", "proposed", "rejected", "accepted"} for i in queue.get("items", []))
assert all(a.get("handle") and a.get("person") for a in sources.get("accounts", []))
print(f"automation OK: posts={len(post_ids)} queue={len(item_ids)} sources={len(sources.get('accounts', []))}")

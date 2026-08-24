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

# Parse the workflow itself in CI so changes to the automation control plane are
# validated too. BaseLoader avoids YAML 1.1 treating the key `on` as boolean.
try:
    import yaml
except ImportError:
    yaml = None

if yaml is not None:
    workflow_path = ROOT / ".github" / "workflows" / "discover-positions.yml"
    workflow = yaml.load(workflow_path.read_text(), Loader=yaml.BaseLoader)
    assert isinstance(workflow, dict), "discovery workflow must be a YAML mapping"
    triggers = workflow.get("on") or {}
    assert "schedule" in triggers and "workflow_dispatch" in triggers, "discovery workflow must remain scheduled and manually runnable"
    permissions = workflow.get("permissions") or {}
    assert permissions.get("contents") == "write", "discovery needs contents: write"
    assert permissions.get("pull-requests") == "write", "discovery needs pull-requests: write"
    assert permissions.get("issues") == "write", "fallback review delivery needs issues: write"
    workflow_text = workflow_path.read_text()
    assert "bot/position-discovery" in workflow_text, "review branch guard missing"
    assert "gh pr create" in workflow_text, "PR delivery missing"
    assert "gh issue create" in workflow_text, "issue fallback delivery missing"
    assert "merge" not in workflow_text.lower() or "auto-merge" not in workflow_text.lower(), "discovery workflow must not auto-merge review data"

print(f"automation OK: posts={len(post_ids)} queue={len(item_ids)} sources={len(sources.get('accounts', []))}")

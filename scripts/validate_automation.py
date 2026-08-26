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

accounts = sources.get("accounts", [])
assert all(a.get("handle") and a.get("person") and a.get("creatorId") for a in accounts), "every source account needs creatorId/person/handle"
for account in accounts:
    platform = account.get("platform")
    assert platform in {"x", "web-portfolio"}, f"unsupported source platform: {platform}"
    if platform == "web-portfolio":
        assert account.get("source"), "web-portfolio source adapter is required"
        assert account.get("url") or account.get("urlTemplate"), "web-portfolio source URL or template is required"
        assert str(account.get("url") or account.get("urlTemplate")).startswith("https://"), "web-portfolio source must use https"
        assert int(account.get("minimumHoldings", 0)) >= 3, "complete portfolio parser must require multiple holdings"

# Parse every workflow in CI so control-plane edits cannot bypass basic YAML QA.
# BaseLoader avoids YAML 1.1 treating the key `on` as boolean.
try:
    import yaml
except ImportError:
    yaml = None

if yaml is not None:
    workflow_dir = ROOT / ".github" / "workflows"
    for path in sorted([*workflow_dir.glob("*.yml"), *workflow_dir.glob("*.yaml")]):
        parsed = yaml.load(path.read_text(), Loader=yaml.BaseLoader)
        assert isinstance(parsed, dict), f"{path.name} must be a YAML mapping"
        assert parsed.get("name"), f"{path.name} must have a workflow name"
        assert parsed.get("on") is not None, f"{path.name} must declare triggers"
        assert parsed.get("jobs"), f"{path.name} must declare jobs"

    workflow_path = workflow_dir / "discover-positions.yml"
    workflow = yaml.load(workflow_path.read_text(), Loader=yaml.BaseLoader)
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
    assert "POSITION_DISCOVERY_BATCH" in workflow_text, "discovery batch isolation missing"
    assert "review_changed" in workflow_text and "raw_changed" in workflow_text, "raw cache and review changes must be separated"
    assert "Persist raw-only ingest cache without human review" in workflow_text, "raw-only cache persistence missing"
    assert "steps.diff.outputs.review_changed == 'true'" in workflow_text, "human review must be gated on review-worthy changes"
    assert "fetch_public_portfolios.js" in workflow_text, "first-party portfolio collector must remain wired into discovery"
    assert "reconcile_source_dates.js" in workflow_text, "date-only first-party source reconciliation missing"
    assert "POSITION_LEDGER_PORTFOLIO_REPORT_PATH" in workflow_text, "portfolio collector diagnostics missing"

print(f"automation OK: posts={len(post_ids)} queue={len(item_ids)} sources={len(accounts)}")

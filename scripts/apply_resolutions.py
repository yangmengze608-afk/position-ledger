#!/usr/bin/env python3
import argparse
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
EVENTS_PATH = ROOT / "data" / "events.json"
QUEUE_PATH = ROOT / "data" / "review_queue.json"
RESOLUTIONS_PATH = ROOT / "data" / "resolutions.json"
DEFAULT_CREATOR_ID = "serenity"


def load_json(path, fallback):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return fallback


def creator_id(value):
    return str(value.get("creatorId") or DEFAULT_CREATOR_ID).strip().lower() or DEFAULT_CREATOR_ID


def event_id(item, resolution):
    ticker = str(resolution.get("resolvedTicker") or item["ticker"]).lower()
    event_type = str(resolution.get("eventType") or item["suggestedType"]).lower()
    base = f"evt-{ticker}-{item['sourcePostId']}-{event_type}"
    creator = creator_id(item)
    return base if creator == DEFAULT_CREATOR_ID else f"{creator}-{base}"


def apply_resolutions(resolution_payload, queue_payload, event_payload):
    queue_items = queue_payload.get("items", [])
    queue_by_id = {item["id"]: item for item in queue_items}
    events = event_payload.get("events", [])
    event_ids = {event["id"] for event in events}
    changed = False

    for resolution in resolution_payload.get("resolutions", []):
        candidate_id = resolution.get("candidateId")
        item = queue_by_id.get(candidate_id)
        if not item:
            raise ValueError(f"resolution {resolution.get('id')} references missing candidate {candidate_id}")

        decision = resolution.get("decision")
        if decision == "reject":
            if item.get("status") != "rejected" or item.get("resolutionId") != resolution.get("id"):
                item["status"] = "rejected"
                item["resolutionId"] = resolution.get("id")
                item["resolvedAt"] = resolution.get("resolvedAt")
                item["resolutionReason"] = resolution.get("reason")
                changed = True
            continue

        if decision != "accept":
            raise ValueError(f"unsupported resolution decision: {decision}")

        eid = event_id(item, resolution)
        if eid not in event_ids:
            confidence = resolution.get("confidence") or item.get("confidence") or "C"
            reason = str(resolution.get("reason") or "人工审核接受该候选").strip()
            creator = creator_id(item)
            event = {
                "id": eid,
                "creatorId": creator,
                "person": item["person"],
                "ticker": str(resolution.get("resolvedTicker") or item["ticker"]).upper(),
                "company": resolution.get("company") or item.get("company") or item["ticker"],
                "exchange": resolution.get("exchange") or item.get("exchange") or "",
                "type": resolution.get("eventType") or item["suggestedType"],
                "date": item["sourceDate"],
                "confidence": confidence,
                "summary": f"人工实体解析：{reason}"[:500],
                "sourceUrl": item.get("sourceUrl"),
                "sourceType": "x-original",
                "sourcePostId": item.get("sourcePostId"),
                "sourceText": item.get("sourceText"),
                "note": f"人工裁决 {resolution.get('id')}: {reason}"[:500],
                "classifier": "manual-resolution-v1",
                "resolutionId": resolution.get("id"),
                "resolutionSources": resolution.get("evidenceUrls", []),
                "sourceEntityMention": item.get("entityMention"),
                "sourceCode": item.get("sourceCode"),
                "entityWarning": item.get("entityWarning"),
            }
            events.append(event)
            event_ids.add(eid)
            changed = True

        if item.get("status") != "accepted" or item.get("acceptedEventId") != eid:
            item["creatorId"] = creator_id(item)
            item["status"] = "accepted"
            item["acceptedEventId"] = eid
            item["resolutionId"] = resolution.get("id")
            item["resolvedAt"] = resolution.get("resolvedAt")
            item["resolutionReason"] = resolution.get("reason")
            item["resolvedTicker"] = str(resolution.get("resolvedTicker") or item["ticker"]).upper()
            changed = True

    events.sort(key=lambda e: (e.get("date", ""), e.get("id", "")))
    event_payload["events"] = events
    return changed


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true", help="validate/apply in memory without writing files")
    args = parser.parse_args()

    resolutions = load_json(RESOLUTIONS_PATH, {"schemaVersion": 1, "resolutions": []})
    queue_payload = load_json(QUEUE_PATH, {"schemaVersion": 1, "items": []})
    event_payload = load_json(EVENTS_PATH, {"schemaVersion": 1, "events": []})

    try:
        changed = apply_resolutions(resolutions, queue_payload, event_payload)
    except ValueError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        raise SystemExit(1)

    if args.check:
        print(f"resolution check OK: changed={changed} resolutions={len(resolutions.get('resolutions', []))}")
        return

    if changed:
        EVENTS_PATH.write_text(json.dumps(event_payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        queue_payload["generatedAt"] = resolutions.get("generatedAt") or queue_payload.get("generatedAt")
        QUEUE_PATH.write_text(json.dumps(queue_payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    subprocess.run([sys.executable, str(ROOT / "scripts" / "rebuild_holdings.py")], check=True)
    print(f"applied resolutions: changed={changed} total={len(resolutions.get('resolutions', []))}")


if __name__ == "__main__":
    main()

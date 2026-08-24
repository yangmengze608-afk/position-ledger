#!/usr/bin/env python3
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
EVENT_TYPES = {"OPEN", "ADD", "HOLD", "REDUCE", "EXIT", "DENY", "HISTORICAL"}
CONFIDENCE = {"A", "B", "C"}


def fail(msg):
    print(f"ERROR: {msg}", file=sys.stderr)
    raise SystemExit(1)


def main():
    for name in ["profile", "events", "holdings", "market", "symbols"]:
        path = ROOT / "data" / f"{name}.json"
        try:
            json.loads(path.read_text(encoding="utf-8"))
        except Exception as exc:
            fail(f"invalid {path}: {exc}")

    payload = json.loads((ROOT / "data" / "events.json").read_text(encoding="utf-8"))
    ids = set()
    for i, event in enumerate(payload.get("events", []), start=1):
        for field in ["id", "ticker", "type", "date", "confidence", "summary"]:
            if not event.get(field):
                fail(f"event #{i} missing {field}")
        if event["id"] in ids:
            fail(f"duplicate event id: {event['id']}")
        ids.add(event["id"])
        if event["type"] not in EVENT_TYPES:
            fail(f"unknown event type: {event['type']}")
        if event["confidence"] not in CONFIDENCE:
            fail(f"unknown confidence: {event['confidence']}")
        if len(event["summary"]) > 500:
            fail(f"summary too long: {event['id']}")
        source = event.get("sourceUrl", "")
        if source and not source.startswith("https://"):
            fail(f"sourceUrl must use https: {event['id']}")

    subprocess.run([sys.executable, str(ROOT / "scripts" / "rebuild_holdings.py")], check=True)
    print(f"OK: validated {len(ids)} events")


if __name__ == "__main__":
    main()

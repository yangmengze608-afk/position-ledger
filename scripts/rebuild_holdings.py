#!/usr/bin/env python3
import json
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
EVENTS_PATH = ROOT / "data" / "events.json"
OUT_PATH = ROOT / "data" / "holdings.json"

ACTIVE_TYPES = {"OPEN", "ADD", "HOLD", "REDUCE"}
DEFAULT_CREATOR_ID = "serenity"


def creator_id(value):
    return str(value.get("creatorId") or DEFAULT_CREATOR_ID).strip().lower() or DEFAULT_CREATOR_ID


def main():
    payload = json.loads(EVENTS_PATH.read_text(encoding="utf-8"))
    by_creator_ticker = defaultdict(list)
    for event in payload.get("events", []):
        by_creator_ticker[(creator_id(event), event["ticker"])].append(event)

    holdings = []
    for (creator, ticker), events in sorted(by_creator_ticker.items()):
        events.sort(key=lambda x: x["date"])
        first = events[0]
        last = events[-1]

        if last["type"] == "DENY":
            state = "denial"
        elif last["type"] == "EXIT":
            state = "archive"
        elif last["type"] == "HISTORICAL":
            state = "unconfirmed"
        elif last["type"] in ACTIVE_TYPES:
            state = "live"
        else:
            state = "unconfirmed"

        confirms = [e for e in events if e["type"] in ACTIVE_TYPES | {"DENY", "EXIT", "HISTORICAL"}]
        latest_confirm = confirms[-1] if confirms else last
        latest_active = next((e for e in reversed(events) if e["type"] in ACTIVE_TYPES), None)

        holding = {
            "ticker": ticker,
            "company": last.get("company") or first.get("company") or ticker,
            "exchange": last.get("exchange") or first.get("exchange") or "",
            "state": state,
            "confidence": latest_confirm.get("confidence", "C"),
            "firstRecordedAt": first["date"],
            "lastConfirmedAt": latest_confirm["date"],
            "lastActiveAt": latest_active["date"] if latest_active else None,
            "note": latest_confirm.get("note", ""),
            "thesis": latest_active.get("summary", "") if latest_active else latest_confirm.get("summary", ""),
            "eventCount": len(events)
        }
        # Preserve the existing Serenity JSON shape so the migration is non-breaking.
        # Additional creators are always explicit and therefore cannot collide by ticker.
        if creator != DEFAULT_CREATOR_ID:
            holding = {"creatorId": creator, **holding}
        holdings.append(holding)

    output = {"schemaVersion": 2, "defaultCreatorId": DEFAULT_CREATOR_ID, "holdings": holdings}
    OUT_PATH.write_text(json.dumps(output, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"wrote {len(holdings)} holdings -> {OUT_PATH}")


if __name__ == "__main__":
    main()

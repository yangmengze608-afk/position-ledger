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


def load_data(name):
    path = ROOT / "data" / f"{name}.json"
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception as exc:
        fail(f"invalid {path}: {exc}")


def validate_security_catalog(symbols):
    catalog = load_data("security_aliases")
    tickers = set()
    aliases = set()
    for i, security in enumerate(catalog.get("securities", []), start=1):
        ticker = str(security.get("ticker", "")).strip().upper()
        company = str(security.get("company", "")).strip()
        exchange = str(security.get("exchange", "")).strip()
        names = security.get("aliases", [])
        if not ticker or not company or not exchange or not names:
            fail(f"security alias #{i} missing ticker/company/exchange/aliases")
        if ticker in tickers:
            fail(f"duplicate security ticker: {ticker}")
        tickers.add(ticker)
        for alias in names:
            key = str(alias).strip().casefold()
            if not key:
                fail(f"empty alias for {ticker}")
            if key in aliases:
                fail(f"duplicate security alias: {alias}")
            aliases.add(key)
        market_symbol = security.get("marketSymbol")
        if market_symbol and symbols.get(ticker) != market_symbol:
            fail(f"market symbol mismatch for {ticker}: catalog={market_symbol} symbols={symbols.get(ticker)}")


def main():
    loaded = {}
    for name in ["profile", "events", "holdings", "market", "symbols", "security_aliases"]:
        loaded[name] = load_data(name)

    symbols = loaded["symbols"]
    validate_security_catalog(symbols)

    payload = loaded["events"]
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
    print(f"OK: validated {len(ids)} events and {len(loaded['security_aliases'].get('securities', []))} security aliases")


if __name__ == "__main__":
    main()

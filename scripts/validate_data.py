#!/usr/bin/env python3
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
EVENT_TYPES = {"OPEN", "ADD", "HOLD", "REDUCE", "EXIT", "DENY", "HISTORICAL"}
CONFIDENCE = {"A", "B", "C"}
RESOLUTION_DECISIONS = {"accept", "reject"}
DEFAULT_CREATOR_ID = "serenity"


def fail(msg):
    print(f"ERROR: {msg}", file=sys.stderr)
    raise SystemExit(1)


def load_data(name):
    path = ROOT / "data" / f"{name}.json"
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception as exc:
        fail(f"invalid {path}: {exc}")


def creator_id(value):
    return str(value.get("creatorId") or DEFAULT_CREATOR_ID).strip().lower() or DEFAULT_CREATOR_ID


def validate_creators(creators, source_accounts):
    ids = set()
    handles = set()
    for i, creator in enumerate(creators.get("creators", []), start=1):
        cid = str(creator.get("id", "")).strip().lower()
        name = str(creator.get("displayName", "")).strip()
        if not cid or not name:
            fail(f"creator #{i} missing id/displayName")
        if cid in ids:
            fail(f"duplicate creator id: {cid}")
        ids.add(cid)
        handle = str(creator.get("handle", "")).strip().lower()
        if handle:
            if handle in handles:
                fail(f"duplicate creator handle: {handle}")
            handles.add(handle)
    if DEFAULT_CREATOR_ID not in ids:
        fail(f"default creator missing from registry: {DEFAULT_CREATOR_ID}")

    for i, account in enumerate(source_accounts.get("accounts", []), start=1):
        cid = str(account.get("creatorId", "")).strip().lower()
        if not cid:
            fail(f"source account #{i} missing creatorId")
        if cid not in ids:
            fail(f"source account #{i} references unknown creatorId: {cid}")
    return ids


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


def validate_resolutions(resolutions, queue):
    candidate_ids = {item.get("id") for item in queue.get("items", [])}
    resolution_ids = set()
    for i, resolution in enumerate(resolutions.get("resolutions", []), start=1):
        rid = str(resolution.get("id", "")).strip()
        candidate_id = str(resolution.get("candidateId", "")).strip()
        decision = resolution.get("decision")
        reason = str(resolution.get("reason", "")).strip()
        resolved_at = str(resolution.get("resolvedAt", "")).strip()
        if not rid or not candidate_id or not reason or not resolved_at:
            fail(f"resolution #{i} missing id/candidateId/reason/resolvedAt")
        if rid in resolution_ids:
            fail(f"duplicate resolution id: {rid}")
        resolution_ids.add(rid)
        if candidate_id not in candidate_ids:
            fail(f"resolution {rid} references missing candidate: {candidate_id}")
        if decision not in RESOLUTION_DECISIONS:
            fail(f"resolution {rid} has invalid decision: {decision}")
        if decision == "accept":
            if not resolution.get("resolvedTicker"):
                fail(f"accepted resolution {rid} missing resolvedTicker")
            if resolution.get("confidence") not in CONFIDENCE:
                fail(f"accepted resolution {rid} has invalid confidence")
            if resolution.get("eventType") not in EVENT_TYPES:
                fail(f"accepted resolution {rid} has invalid eventType")
        for url in resolution.get("evidenceUrls", []):
            if not str(url).startswith("https://"):
                fail(f"resolution {rid} evidenceUrl must use https")


def validate_corrections(corrections, creator_ids, canonical_event_ids):
    correction_ids = set()
    revoked_ids = set()
    invalid_source_keys = set()
    for i, correction in enumerate(corrections.get("corrections", []), start=1):
        cid = creator_id(correction)
        correction_id = str(correction.get("id", "")).strip()
        source_post_id = str(correction.get("sourcePostId", "")).strip()
        reason = str(correction.get("reason", "")).strip()
        if not correction_id or not source_post_id or not reason:
            fail(f"correction #{i} missing id/sourcePostId/reason")
        if correction_id in correction_ids:
            fail(f"duplicate correction id: {correction_id}")
        correction_ids.add(correction_id)
        if cid not in creator_ids:
            fail(f"correction {correction_id} references unknown creatorId: {cid}")
        if correction.get("invalidForCreator"):
            key = (cid, source_post_id)
            if key in invalid_source_keys:
                fail(f"duplicate creator-scoped invalid source correction: {key}")
            invalid_source_keys.add(key)
        for event_id in correction.get("revokedEventIds", []):
            event_id = str(event_id).strip()
            if not event_id:
                fail(f"correction {correction_id} has empty revokedEventId")
            if event_id in revoked_ids:
                fail(f"event revoked by multiple corrections: {event_id}")
            revoked_ids.add(event_id)
            if event_id in canonical_event_ids:
                fail(f"revoked event still present in canonical events: {event_id}")
        for event_id in correction.get("preserveIndependentEvents", []):
            if event_id not in canonical_event_ids:
                fail(f"correction {correction_id} expected preserved event missing: {event_id}")
        for url in correction.get("auditSources", []):
            if not str(url).startswith("https://"):
                fail(f"correction {correction_id} audit source must use https")
    return revoked_ids


def main():
    loaded = {}
    for name in [
        "profile", "events", "holdings", "market", "symbols", "security_aliases",
        "review_queue", "resolutions", "corrections", "creators", "source_accounts"
    ]:
        loaded[name] = load_data(name)

    creator_ids = validate_creators(loaded["creators"], loaded["source_accounts"])
    symbols = loaded["symbols"]
    validate_security_catalog(symbols)
    validate_resolutions(loaded["resolutions"], loaded["review_queue"])

    payload = loaded["events"]
    ids = set()
    scoped_source_keys = set()
    for i, event in enumerate(payload.get("events", []), start=1):
        for field in ["id", "ticker", "type", "date", "confidence", "summary"]:
            if not event.get(field):
                fail(f"event #{i} missing {field}")
        cid = creator_id(event)
        if cid not in creator_ids:
            fail(f"event {event['id']} references unknown creatorId: {cid}")
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
        if event.get("sourcePostId"):
            key = (cid, str(event["sourcePostId"]), event["ticker"], event["type"])
            if key in scoped_source_keys:
                fail(f"duplicate creator-scoped source event: {key}")
            scoped_source_keys.add(key)

    revoked_ids = validate_corrections(loaded["corrections"], creator_ids, ids)

    for i, item in enumerate(loaded["review_queue"].get("items", []), start=1):
        cid = creator_id(item)
        if cid not in creator_ids:
            fail(f"review item #{i} references unknown creatorId: {cid}")

    for i, holding in enumerate(loaded["holdings"].get("holdings", []), start=1):
        cid = creator_id(holding)
        if cid not in creator_ids:
            fail(f"holding #{i} references unknown creatorId: {cid}")

    subprocess.run([sys.executable, str(ROOT / "scripts" / "rebuild_holdings.py")], check=True)
    print(
        f"OK: validated {len(ids)} canonical events ({len(revoked_ids)} revoked in audit) "
        f"across {len(creator_ids)} creator(s), "
        f"{len(loaded['security_aliases'].get('securities', []))} security aliases, "
        f"{len(loaded['resolutions'].get('resolutions', []))} resolutions"
    )


if __name__ == "__main__":
    main()

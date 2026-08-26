#!/usr/bin/env python3
import json
import math
import time
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[1]
SYMBOLS = json.loads((ROOT / "data" / "symbols.json").read_text(encoding="utf-8"))
HOLDINGS = json.loads((ROOT / "data" / "holdings.json").read_text(encoding="utf-8")).get("holdings", [])
OUT = ROOT / "data" / "market.json"
DEFAULT_CREATOR_ID = "serenity"

HEADERS = {"User-Agent": "Mozilla/5.0 PositionLedger/1.0"}


def creator_id(value):
    return str(value.get("creatorId") or DEFAULT_CREATOR_ID).strip().lower() or DEFAULT_CREATOR_ID


def parse_iso(value):
    if not value:
        return None
    text = str(value).replace("Z", "+00:00")
    dt = datetime.fromisoformat(text)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt


def earliest_anchor_date():
    dates = []
    for holding in HOLDINGS:
        for key in ("firstRecordedAt", "lastActiveAt"):
            dt = parse_iso(holding.get(key))
            if dt:
                dates.append(dt.astimezone(timezone.utc))
    return min(dates) if dates else datetime.now(timezone.utc) - timedelta(days=90)


def fetch_chart(symbol, period1=None):
    if period1 is None:
        period1 = earliest_anchor_date() - timedelta(days=10)
    period2 = datetime.now(timezone.utc) + timedelta(days=2)
    params = urllib.parse.urlencode({
        "interval": "1d",
        "period1": int(period1.timestamp()),
        "period2": int(period2.timestamp()),
        "events": "div,splits",
        "includeAdjustedClose": "true",
    })
    url = "https://query1.finance.yahoo.com/v8/finance/chart/" + urllib.parse.quote(symbol) + "?" + params
    req = urllib.request.Request(url, headers=HEADERS)
    with urllib.request.urlopen(req, timeout=15) as resp:
        payload = json.loads(resp.read().decode("utf-8"))
    result = payload["chart"]["result"][0]
    return result


def valid_sessions(result):
    timestamps = result.get("timestamp") or []
    indicators = result.get("indicators") or {}
    quote = (indicators.get("quote") or [{}])[0]
    closes = quote.get("close") or []
    adj = (indicators.get("adjclose") or [{}])[0].get("adjclose") or []
    meta = result.get("meta", {})
    tz_name = meta.get("exchangeTimezoneName") or "UTC"
    try:
        market_tz = ZoneInfo(tz_name)
    except Exception:
        market_tz = timezone.utc

    sessions = []
    for i, ts in enumerate(timestamps):
        raw_close = closes[i] if i < len(closes) else None
        adjusted = adj[i] if i < len(adj) else None
        price = adjusted if adjusted is not None else raw_close
        if price is None:
            continue
        try:
            price = float(price)
        except (TypeError, ValueError):
            continue
        if not math.isfinite(price):
            continue
        dt = datetime.fromtimestamp(int(ts), tz=timezone.utc).astimezone(market_tz)
        sessions.append({
            "date": dt.date().isoformat(),
            "timestamp": int(ts),
            "price": price,
            "rawClose": float(raw_close) if raw_close is not None else None,
        })
    return sessions, market_tz


def previous_session_close(sessions, current_price=None):
    if len(sessions) >= 2:
        return sessions[-2]["price"]
    if len(sessions) == 1 and current_price is not None:
        only = sessions[0]["price"]
        if abs(only - float(current_price)) > 1e-9:
            return only
    return None


def anchor_for_event(sessions, event_at, market_tz):
    dt = parse_iso(event_at)
    if not dt:
        return None
    target_date = dt.astimezone(market_tz).date().isoformat()
    for session in sessions:
        if session["date"] >= target_date:
            return {
                "eventAt": event_at,
                "sessionDate": session["date"],
                "price": round(session["price"], 6),
                "method": "first-market-close-on-or-after-disclosure-date",
            }
    return None


def performance_pct(current_price, anchor):
    if current_price is None or not anchor or not anchor.get("price"):
        return None
    return round((float(current_price) / float(anchor["price"]) - 1.0) * 100.0, 4)


def holdings_for_ticker(ticker):
    return [h for h in HOLDINGS if h.get("ticker") == ticker]


def unmapped_live_holdings():
    tickers = {
        str(h.get("ticker") or "").strip()
        for h in HOLDINGS
        if h.get("state") == "live" and str(h.get("ticker") or "").strip()
    }
    return sorted(ticker for ticker in tickers if not SYMBOLS.get(ticker))


def build_creator_anchors(ticker, sessions, market_tz, current_price):
    anchors = {}
    for holding in holdings_for_ticker(ticker):
        cid = creator_id(holding)
        first_anchor = anchor_for_event(sessions, holding.get("firstRecordedAt"), market_tz)
        last_anchor = anchor_for_event(sessions, holding.get("lastActiveAt"), market_tz)
        if first_anchor:
            first_anchor["performancePct"] = performance_pct(current_price, first_anchor)
        if last_anchor:
            last_anchor["performancePct"] = performance_pct(current_price, last_anchor)
        anchors[cid] = {
            "firstDisclosureAnchor": first_anchor,
            "lastActionAnchor": last_anchor,
        }
    return anchors


def fetch_quote(ticker, symbol):
    result = fetch_chart(symbol)
    meta = result.get("meta", {})
    sessions, market_tz = valid_sessions(result)
    price = meta.get("regularMarketPrice")
    if price is None and sessions:
        price = sessions[-1]["price"]
    if price is not None:
        price = float(price)

    previous = previous_session_close(sessions, price)
    if previous is None:
        fallback = meta.get("regularMarketPreviousClose") or meta.get("previousClose")
        if fallback is not None:
            previous = float(fallback)

    creator_anchors = build_creator_anchors(ticker, sessions, market_tz, price)
    serenity = creator_anchors.get(DEFAULT_CREATOR_ID, {})

    return {
        "symbol": symbol,
        "price": price,
        "previousClose": round(previous, 6) if previous is not None else None,
        "currency": meta.get("currency") or "USD",
        "exchange": meta.get("exchangeName"),
        "marketState": meta.get("marketState"),
        "exchangeTimezone": meta.get("exchangeTimezoneName"),
        # Legacy Serenity fields stay for backwards compatibility.
        "firstDisclosureAnchor": serenity.get("firstDisclosureAnchor"),
        "lastActionAnchor": serenity.get("lastActionAnchor"),
        # Creator-specific anchors are canonical for multi-creator views.
        "creatorAnchors": creator_anchors,
        "updatedAt": datetime.now(timezone.utc).isoformat(),
    }


def main():
    previous_payload = {"quotes": {}}
    if OUT.exists():
        try:
            previous_payload = json.loads(OUT.read_text(encoding="utf-8"))
        except Exception:
            pass
    quotes = dict(previous_payload.get("quotes", {}))
    failures = []
    unmapped = unmapped_live_holdings()
    for ticker in unmapped:
        print(f"WARN {ticker}: no market symbol mapping")

    for ticker, symbol in SYMBOLS.items():
        if not symbol:
            continue
        try:
            quote = fetch_quote(ticker, symbol)
            if quote.get("price") is not None:
                quotes[ticker] = quote
                first_perf = quote.get("firstDisclosureAnchor", {}).get("performancePct") if quote.get("firstDisclosureAnchor") else None
                suffix = f" | Serenity since first {first_perf:+.2f}%" if first_perf is not None else ""
                creators = len(quote.get("creatorAnchors", {}))
                print(f"{ticker}: {quote['price']} {quote['currency']} | creators={creators}{suffix}")
        except Exception as exc:
            failures.append(f"{ticker}: {exc}")
            print(f"WARN {ticker}: {exc}")
        time.sleep(0.25)

    payload = {
        "updatedAt": datetime.now(timezone.utc).isoformat(),
        "provider": "Yahoo Finance chart endpoint via GitHub Actions",
        "methodology": {
            "dailyMove": "regular market price versus previous valid adjusted daily session close",
            "disclosureAnchors": "creator-scoped adjusted close from first market session on or after disclosure date in exchange timezone; not investor cost basis",
        },
        "quotes": quotes,
        "failures": failures,
        "unmappedHoldings": unmapped,
    }
    OUT.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
import json
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SYMBOLS = json.loads((ROOT / "data" / "symbols.json").read_text(encoding="utf-8"))
OUT = ROOT / "data" / "market.json"

HEADERS = {"User-Agent": "Mozilla/5.0 PositionLedger/1.0"}


def fetch_quote(symbol):
    url = "https://query1.finance.yahoo.com/v8/finance/chart/" + urllib.parse.quote(symbol) + "?interval=1d&range=5d"
    req = urllib.request.Request(url, headers=HEADERS)
    with urllib.request.urlopen(req, timeout=15) as resp:
        payload = json.loads(resp.read().decode("utf-8"))
    result = payload["chart"]["result"][0]
    meta = result.get("meta", {})
    price = meta.get("regularMarketPrice")
    previous = meta.get("chartPreviousClose") or meta.get("previousClose")
    return {
        "symbol": symbol,
        "price": price,
        "previousClose": previous,
        "currency": meta.get("currency") or "USD",
        "exchange": meta.get("exchangeName"),
        "marketState": meta.get("marketState"),
        "updatedAt": datetime.now(timezone.utc).isoformat()
    }


def main():
    previous = {"quotes": {}}
    if OUT.exists():
        try:
            previous = json.loads(OUT.read_text(encoding="utf-8"))
        except Exception:
            pass
    quotes = dict(previous.get("quotes", {}))
    failures = []

    for ticker, symbol in SYMBOLS.items():
        if not symbol:
            continue
        try:
            quote = fetch_quote(symbol)
            if quote.get("price") is not None:
                quotes[ticker] = quote
                print(f"{ticker}: {quote['price']} {quote['currency']}")
        except Exception as exc:
            failures.append(f"{ticker}: {exc}")
            print(f"WARN {ticker}: {exc}")
        time.sleep(0.25)

    payload = {
        "updatedAt": datetime.now(timezone.utc).isoformat(),
        "provider": "Yahoo Finance chart endpoint via GitHub Actions",
        "quotes": quotes,
        "failures": failures
    }
    OUT.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()

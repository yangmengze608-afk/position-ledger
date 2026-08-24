#!/usr/bin/env python3
"""Optional LLM pass for ambiguous candidates.

Uses an OpenAI-compatible /chat/completions endpoint only when LLM_API_KEY and LLM_MODEL
are configured. Public post text only. The model can refine a suggestion, but it never writes
straight to the canonical ledger; propose_events.js still applies the hard promotion gate.
"""
from __future__ import annotations

import json
import os
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
QUEUE = ROOT / "data" / "review_queue.json"
API_KEY = os.getenv("LLM_API_KEY") or os.getenv("OPENAI_API_KEY")
MODEL = os.getenv("LLM_MODEL")
BASE_URL = (os.getenv("LLM_BASE_URL") or "https://api.openai.com/v1").rstrip("/")
MAX_ITEMS = int(os.getenv("LLM_REVIEW_MAX", "20"))
ALLOWED = {"OPEN", "ADD", "HOLD", "REDUCE", "EXIT", "DENY", "IGNORE"}


def call_model(item: dict) -> dict:
    prompt = f"""Classify a public investment disclosure. Return JSON only.
Allowed event_type: OPEN, ADD, HOLD, REDUCE, EXIT, DENY, IGNORE.
Only classify an actual disclosed personal position. Mentioning, liking, recommending, researching,
or discussing a ticker is IGNORE. If evidence is not explicit, set explicit=false.

Ticker: {item['ticker']}
Post: {item['sourceText']}

Return exactly:
{{"event_type":"...","explicit":true,"confidence":0.0,"evidence":"short exact span","reason":"short reason"}}
"""
    body = json.dumps({
        "model": MODEL,
        "temperature": 0,
        "response_format": {"type": "json_object"},
        "messages": [
            {"role": "system", "content": "You are a conservative position-disclosure classifier. Do not infer holdings from sentiment."},
            {"role": "user", "content": prompt},
        ],
    }).encode()
    req = urllib.request.Request(
        f"{BASE_URL}/chat/completions",
        data=body,
        method="POST",
        headers={"Authorization": f"Bearer {API_KEY}", "Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=45) as response:
        payload = json.loads(response.read())
    text = payload["choices"][0]["message"]["content"]
    result = json.loads(text)
    if result.get("event_type") not in ALLOWED:
        raise ValueError("invalid event_type")
    result["confidence"] = float(result.get("confidence", 0))
    result["explicit"] = bool(result.get("explicit", False))
    return result


def main() -> None:
    if not API_KEY or not MODEL:
        print("[llm] skipped: set LLM_API_KEY (or OPENAI_API_KEY) and LLM_MODEL to enable")
        return
    payload = json.loads(QUEUE.read_text())
    reviewed = 0
    for item in payload.get("items", []):
        if reviewed >= MAX_ITEMS:
            break
        if item.get("status") != "pending" or item.get("llm") is not None:
            continue
        if item.get("confidence") == "A" and float(item.get("score", 0)) >= 0.95:
            continue
        try:
            item["llm"] = call_model(item)
            reviewed += 1
            print(f"[llm] {item['ticker']} -> {item['llm']['event_type']} {item['llm']['confidence']:.2f}")
        except Exception as exc:
            print(f"[llm] {item.get('id')}: {exc}")
    if reviewed:
        payload["generatedAt"] = __import__("datetime").datetime.now(__import__("datetime").timezone.utc).isoformat()
        QUEUE.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n")
    print(f"[llm] reviewed={reviewed}")


if __name__ == "__main__":
    main()

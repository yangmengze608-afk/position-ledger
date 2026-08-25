import unittest
from datetime import timezone
from unittest.mock import patch

import scripts.refresh_market as market_module
from scripts.refresh_market import anchor_for_event, build_creator_anchors, performance_pct, previous_session_close


class MarketAnchorTests(unittest.TestCase):
    def test_previous_close_uses_penultimate_valid_session(self):
        sessions = [
            {"date": "2026-08-20", "price": 100.0},
            {"date": "2026-08-21", "price": 105.0},
            {"date": "2026-08-24", "price": 110.0},
        ]
        self.assertEqual(previous_session_close(sessions, 111.0), 105.0)

    def test_single_completed_session_can_be_previous_close(self):
        sessions = [{"date": "2026-08-24", "price": 100.0}]
        self.assertEqual(previous_session_close(sessions, 102.0), 100.0)

    def test_weekend_disclosure_anchors_next_market_session(self):
        sessions = [
            {"date": "2026-08-14", "price": 90.0},
            {"date": "2026-08-17", "price": 95.0},
            {"date": "2026-08-18", "price": 100.0},
        ]
        anchor = anchor_for_event(sessions, "2026-08-16T08:30:22Z", timezone.utc)
        self.assertEqual(anchor["sessionDate"], "2026-08-17")
        self.assertEqual(anchor["price"], 95.0)

    def test_same_day_disclosure_uses_same_session_when_available(self):
        sessions = [
            {"date": "2026-08-17", "price": 250.0},
            {"date": "2026-08-18", "price": 255.0},
        ]
        anchor = anchor_for_event(sessions, "2026-08-17T03:11:28Z", timezone.utc)
        self.assertEqual(anchor["sessionDate"], "2026-08-17")
        self.assertEqual(anchor["price"], 250.0)

    def test_performance_is_market_return_not_cost_basis(self):
        anchor = {"price": 80.0}
        self.assertEqual(performance_pct(100.0, anchor), 25.0)

    def test_missing_anchor_returns_no_performance(self):
        self.assertIsNone(performance_pct(100.0, None))

    def test_same_ticker_gets_independent_creator_anchors(self):
        sessions = [
            {"date": "2026-08-10", "price": 100.0},
            {"date": "2026-08-20", "price": 120.0},
            {"date": "2026-08-24", "price": 150.0},
        ]
        holdings = [
            {
                "ticker": "NVDA",
                "firstRecordedAt": "2026-08-10T12:00:00Z",
                "lastActiveAt": "2026-08-10T12:00:00Z",
            },
            {
                "creatorId": "ck-capital",
                "ticker": "NVDA",
                "firstRecordedAt": "2026-08-20T12:00:00Z",
                "lastActiveAt": "2026-08-20T12:00:00Z",
            },
        ]
        with patch.object(market_module, "HOLDINGS", holdings):
            anchors = build_creator_anchors("NVDA", sessions, timezone.utc, 150.0)
        self.assertEqual(set(anchors), {"serenity", "ck-capital"})
        self.assertEqual(anchors["serenity"]["firstDisclosureAnchor"]["price"], 100.0)
        self.assertEqual(anchors["serenity"]["firstDisclosureAnchor"]["performancePct"], 50.0)
        self.assertEqual(anchors["ck-capital"]["firstDisclosureAnchor"]["price"], 120.0)
        self.assertEqual(anchors["ck-capital"]["firstDisclosureAnchor"]["performancePct"], 25.0)

    def test_creator_without_holding_gets_no_anchor(self):
        sessions = [{"date": "2026-08-20", "price": 120.0}]
        with patch.object(market_module, "HOLDINGS", []):
            anchors = build_creator_anchors("NVDA", sessions, timezone.utc, 150.0)
        self.assertEqual(anchors, {})


if __name__ == "__main__":
    unittest.main()

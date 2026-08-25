import unittest
from datetime import timezone

from scripts.refresh_market import anchor_for_event, performance_pct, previous_session_close


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


if __name__ == "__main__":
    unittest.main()

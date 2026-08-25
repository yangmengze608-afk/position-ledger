import copy
import unittest

from scripts.apply_resolutions import apply_resolutions


class ResolutionTests(unittest.TestCase):
    def setUp(self):
        self.queue = {
            "schemaVersion": 1,
            "items": [{
                "id": "cand-x-post-2492-add",
                "person": "Serenity",
                "ticker": "2492",
                "suggestedType": "ADD",
                "confidence": "B",
                "company": "Walsin Technology Corporation",
                "exchange": "TWSE",
                "sourcePostId": "post",
                "sourceUrl": "https://x.com/example/status/post",
                "sourceDate": "2026-08-17T03:11:28.000Z",
                "sourceText": "Walsin (2494) ... I actually added some recently",
                "entityMention": "Walsin (2494)",
                "sourceCode": "2494",
                "entityWarning": "source-code-mismatch:2494!=2492",
                "status": "pending",
            }],
        }
        self.events = {"schemaVersion": 1, "events": []}
        self.resolution = {
            "schemaVersion": 1,
            "resolutions": [{
                "id": "resolve-walsin",
                "candidateId": "cand-x-post-2492-add",
                "decision": "accept",
                "resolvedTicker": "2492",
                "company": "Walsin Technology Corporation",
                "exchange": "TWSE",
                "confidence": "B",
                "eventType": "ADD",
                "reason": "verified company identity; source numeric code conflicts",
                "evidenceUrls": ["https://example.com/official"],
                "resolvedAt": "2026-08-25T03:22:00Z",
            }],
        }

    def test_accept_creates_audited_event_and_updates_queue(self):
        changed = apply_resolutions(self.resolution, self.queue, self.events)
        self.assertTrue(changed)
        self.assertEqual(len(self.events["events"]), 1)
        event = self.events["events"][0]
        self.assertEqual(event["creatorId"], "serenity")
        self.assertEqual(event["ticker"], "2492")
        self.assertEqual(event["type"], "ADD")
        self.assertEqual(event["confidence"], "B")
        self.assertEqual(event["classifier"], "manual-resolution-v1")
        self.assertEqual(event["sourceCode"], "2494")
        self.assertEqual(self.queue["items"][0]["status"], "accepted")
        self.assertEqual(self.queue["items"][0]["acceptedEventId"], event["id"])

    def test_accept_is_idempotent(self):
        apply_resolutions(self.resolution, self.queue, self.events)
        changed = apply_resolutions(self.resolution, self.queue, self.events)
        self.assertFalse(changed)
        self.assertEqual(len(self.events["events"]), 1)

    def test_second_creator_gets_scoped_event_id(self):
        queue = copy.deepcopy(self.queue)
        queue["items"][0]["id"] = "creator-b-cand-x-post-2492-add"
        queue["items"][0]["creatorId"] = "creator-b"
        queue["items"][0]["person"] = "Creator B"
        resolution = copy.deepcopy(self.resolution)
        resolution["resolutions"][0]["candidateId"] = "creator-b-cand-x-post-2492-add"
        events = {"schemaVersion": 1, "events": []}
        apply_resolutions(resolution, queue, events)
        self.assertEqual(events["events"][0]["creatorId"], "creator-b")
        self.assertEqual(events["events"][0]["id"], "creator-b-evt-2492-post-add")

    def test_reject_never_creates_event(self):
        queue = copy.deepcopy(self.queue)
        events = copy.deepcopy(self.events)
        resolution = copy.deepcopy(self.resolution)
        resolution["resolutions"][0]["decision"] = "reject"
        changed = apply_resolutions(resolution, queue, events)
        self.assertTrue(changed)
        self.assertEqual(events["events"], [])
        self.assertEqual(queue["items"][0]["status"], "rejected")

    def test_missing_candidate_fails_closed(self):
        resolution = copy.deepcopy(self.resolution)
        resolution["resolutions"][0]["candidateId"] = "missing"
        with self.assertRaises(ValueError):
            apply_resolutions(resolution, self.queue, self.events)


if __name__ == "__main__":
    unittest.main()

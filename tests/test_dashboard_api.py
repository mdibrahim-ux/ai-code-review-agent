"""Unit tests for the Sentinel dashboard API; all GitHub/SSM I/O is mocked."""
from __future__ import annotations

import base64
import json
import unittest
from unittest.mock import patch

from backend.dashboard_api import lambda_function as api


def api_event(method: str, path: str, body=None, *, origin="http://localhost:5500"):
    event = {
        "version": "2.0",
        "routeKey": f"{method} {path}",
        "rawPath": path,
        "headers": {"origin": origin, "content-type": "application/json"},
        "requestContext": {"http": {"method": method, "path": path}},
    }
    if body is not None:
        event["body"] = json.dumps(body)
    return event


def decode_response(value):
    return value["statusCode"], json.loads(value["body"]), value["headers"]


class DashboardApiTests(unittest.TestCase):
    def test_health_does_not_call_github(self):
        with patch.object(api, "get_github_token") as token:
            status, body, headers = decode_response(
                api.lambda_handler(api_event("GET", "/health"), None)
            )
        self.assertEqual(status, 200)
        self.assertEqual(body, {"status": "ok", "service": "sentinel-dashboard-api"})
        token.assert_not_called()
        self.assertEqual(headers["Access-Control-Allow-Origin"], "http://localhost:5500")

    def test_unapproved_origin_gets_no_cors_permission(self):
        with patch.object(api, "get_github_token"):
            status, _, headers = decode_response(
                api.lambda_handler(
                    api_event("GET", "/health", origin="https://evil.example"), None
                )
            )
        self.assertEqual(status, 200)
        self.assertNotIn("Access-Control-Allow-Origin", headers)

    def test_pull_request_list_is_live_shape_and_bounded(self):
        pull_requests = [{
            "number": 7, "title": "Review this", "state": "open",
            "user": {"login": "contributor"}, "html_url": "https://github.com/x/y/pull/7",
            "updated_at": "2026-10-14T10:00:00Z", "draft": False,
            "head": {"ref": "feature"}, "base": {"ref": "main"},
            "changed_files": 2, "additions": 4, "deletions": 1,
        }]
        with patch.object(api, "get_github_token", return_value="fake-token"), \
             patch.object(api, "list_open_pull_requests", return_value=[
                 api._open_pull_request_summary({**pull_requests[0], "number": 7})
             ]):
            status, body, _ = decode_response(
                api.lambda_handler(api_event("GET", "/pull-requests"), None)
            )
        self.assertEqual(status, 200)
        self.assertEqual(body["repository"], api.DEFAULT_REPOSITORY)
        self.assertEqual(body["count"], 1)
        self.assertEqual(body["pull_requests"][0]["number"], 7)
        self.assertEqual(body["pull_requests"][0]["author"], "contributor")

    def test_review_is_read_only_and_preserves_filename(self):
        pr = {
            "number": 7, "title": "Demo", "state": "open",
            "html_url": "https://github.com/mdibrahim-ux/ai-code-review-agent/pull/7",
            "head": {"sha": "abc123"},
            "base": {"repo": {"full_name": api.DEFAULT_REPOSITORY}},
        }
        files = [{
            "filename": "demo_vulnerable.py",
            "status": "modified",
            "patch": "@@ -1,1 +1,1 @@\n-result = 1\n+result = eval(user_input)\n",
        }]
        with patch.object(api, "get_github_token", return_value="fake-token"), \
             patch.object(api, "_get_open_pr_and_files", return_value=(pr, files)):
            status, body, _ = decode_response(
                api.lambda_handler(
                    api_event("POST", "/review", {"pull_request_number": 7}), None
                )
            )
        self.assertEqual(status, 200)
        self.assertEqual(body["status"], "reviewed")
        self.assertEqual(body["mode"], "read-only")
        self.assertFalse(body["comments_published"])
        self.assertEqual(body["finding_count"], 1)
        self.assertEqual(body["findings"][0]["filename"], "demo_vulnerable.py")
        self.assertEqual(body["findings"][0]["rule"], "unsafe-eval")

    def test_sample_or_invalid_pr_number_is_rejected_before_github_io(self):
        for value in [None, 0, -1, True, 1.5, "abc"]:
            with self.subTest(value=value), \
                 patch.object(api, "get_github_token") as token:
                status, body, _ = decode_response(api.lambda_handler(
                    api_event("POST", "/review", {"pull_request_number": value}), None
                ))
            self.assertEqual(status, 400)
            self.assertIn("pull_request_number", body["error"])
            token.assert_not_called()

    def test_base64_json_body_is_supported(self):
        event = api_event("POST", "/review")
        event["body"] = base64.b64encode(json.dumps({"pull_request_number": 7}).encode()).decode()
        event["isBase64Encoded"] = True
        with patch.object(api, "get_github_token", return_value="fake-token"), \
             patch.object(
                 api,
                 "review_pull_request",
                 return_value={"status": "reviewed", "comments_published": False},
             ) as review:
            status, body, _ = decode_response(api.lambda_handler(event, None))
        self.assertEqual(status, 200)
        review.assert_called_once_with("fake-token", 7)
        self.assertFalse(body["comments_published"])

    def test_github_request_timeout_is_bounded_for_dashboard_lambda(self):
        # The deployment workflow sets a 10-second function ceiling.
        # Each upstream request must leave time for the remaining review steps.
        self.assertEqual(api.REQUEST_TIMEOUT_SECONDS, 4)

    def test_unknown_route_is_404_and_method_is_405(self):
        status, body, _ = decode_response(api.lambda_handler(api_event("GET", "/unknown"), None))
        self.assertEqual(status, 404)
        self.assertEqual(body["error"], "Route not found")
        status, body, _ = decode_response(api.lambda_handler(api_event("DELETE", "/review"), None))
        self.assertEqual(status, 405)
        self.assertEqual(body["error"], "Method not allowed")


if __name__ == "__main__":
    unittest.main()

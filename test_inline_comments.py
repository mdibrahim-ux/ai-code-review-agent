
import unittest
import urllib.error
from unittest.mock import patch

from backend import lambda_function as lf


class InlineCommentTests(unittest.TestCase):
    def setUp(self):
        self.finding = {
            "filename": "review_test.py",
            "line": 1,
            "rule": "hardcoded-secret",
            "severity": "HIGH",
            "message": "Possible hardcoded credential.",
        }

        self.changed_files = [
            {
                "filename": "review_test.py",
                "patch": (
                    "@@ -0,0 +1,2 @@\n"
                    '+api_key = "abc123456789secret"\n'
                    '+result = eval("1 + 1")\n'
                ),
                "status": "added",
            }
        ]

    @patch("backend.lambda_function.github_request")
    @patch("backend.lambda_function.get_changed_files")
    def test_only_added_lines_receive_comments(
        self, mock_files, mock_request
    ):
        mock_files.return_value = self.changed_files
        mock_request.return_value = (200, [])

        outside_finding = {
            **self.finding,
            "line": 10,
            "rule": "unsafe-eval",
        }

        result = lf.publish_inline_comments(
            "example/repo",
            1,
            "fake-token",
            [self.finding, outside_finding],
        )

        self.assertEqual(result["inline_comments_posted"], 1)
        self.assertEqual(result["inline_comments_updated"], 0)
        self.assertEqual(len(result["inline_comments_skipped"]), 1)

        posted_payloads = [
            call.kwargs["payload"]
            for call in mock_request.call_args_list
            if call.kwargs.get("method") == "POST"
        ]

        self.assertEqual(len(posted_payloads), 1)
        self.assertEqual(posted_payloads[0]["line"], 1)

    @patch("backend.lambda_function.github_request")
    @patch("backend.lambda_function.get_changed_files")
    def test_existing_comment_is_updated(
        self, mock_files, mock_request
    ):
        mock_files.return_value = self.changed_files

        marker = (
            "<!-- ai-code-review-agent-inline:"
            "hardcoded-secret:review_test.py:1 -->"
        )

        mock_request.return_value = (
            200,
            [{"id": 123, "body": marker, "path": "review_test.py"}],
        )

        result = lf.publish_inline_comments(
            "example/repo", 1, "fake-token", [self.finding]
        )

        self.assertEqual(result["inline_comments_posted"], 0)
        self.assertEqual(result["inline_comments_updated"], 1)

        methods = [
            call.kwargs.get("method", "GET")
            for call in mock_request.call_args_list
        ]

        self.assertIn("PATCH", methods)
        self.assertNotIn("POST", methods)

    @patch("backend.lambda_function.github_request")
    @patch("backend.lambda_function.get_changed_files")
    def test_api_rejection_is_recorded(
        self, mock_files, mock_request
    ):
        mock_files.return_value = self.changed_files

        def fake_github_request(
            url, token, method="GET", payload=None
        ):
            if method == "POST":
                raise urllib.error.HTTPError(
                    url,
                    422,
                    "Unprocessable Entity",
                    None,
                    None,
                )
            return 200, []

        mock_request.side_effect = fake_github_request

        result = lf.publish_inline_comments(
            "example/repo", 1, "fake-token", [self.finding]
        )

        self.assertEqual(result["inline_comments_posted"], 0)
        self.assertEqual(result["inline_comments_updated"], 0)
        self.assertEqual(len(result["inline_comments_skipped"]), 1)
        self.assertEqual(
            result["inline_comments_skipped"][0]["http_status"],
            422,
        )


if __name__ == "__main__":
    unittest.main()

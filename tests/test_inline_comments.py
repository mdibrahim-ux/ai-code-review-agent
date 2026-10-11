import io
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

    def configure_github_mock(
        self,
        mock_request,
        existing_comments=None,
        user_response=None,
        reject_posts=False,
    ):
        """Mock GitHub API responses, including authenticated identity."""
        if existing_comments is None:
            existing_comments = []

        if user_response is None:
            user_response = {"login": "sentinel-bot"}

        def fake_github_request(
            url, token, method="GET", payload=None
        ):
            if url.endswith("/user"):
                return 200, user_response

            if method == "GET" and "/pulls/1/comments?" in url:
                return 200, existing_comments

            if method == "POST":
                if reject_posts:
                    body = io.BytesIO(
                        b'{"message":"Validation Failed","errors":[]}'
                    )
                    raise urllib.error.HTTPError(
                        url,
                        422,
                        "Unprocessable Entity",
                        hdrs=None,
                        fp=body,
                    )
                return 201, {"id": 456}

            if method == "PATCH":
                return 200, {"id": 123}

            return 200, {}

        mock_request.side_effect = fake_github_request

    @patch("backend.lambda_function.github_request")
    @patch("backend.lambda_function.get_changed_files")
    def test_only_added_lines_receive_comments(
        self, mock_files, mock_request
    ):
        mock_files.return_value = self.changed_files
        self.configure_github_mock(mock_request)

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
            head_sha="test-head-sha",
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
        self.assertEqual(
            posted_payloads[0]["commit_id"],
            "test-head-sha",
        )

    @patch("backend.lambda_function.github_request")
    @patch("backend.lambda_function.get_changed_files")
    def test_existing_owned_comment_is_updated(
        self, mock_files, mock_request
    ):
        mock_files.return_value = self.changed_files

        marker = lf._inline_marker(self.finding)
        existing_comments = [
            {
                "id": 123,
                "body": marker + "\nOld finding text",
                "path": "review_test.py",
                "user": {"login": "sentinel-bot"},
            }
        ]
        self.configure_github_mock(
            mock_request,
            existing_comments=existing_comments,
        )

        result = lf.publish_inline_comments(
            "example/repo",
            1,
            "fake-token",
            [self.finding],
            head_sha="test-head-sha",
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
    def test_comment_owned_by_someone_else_is_not_updated(
        self, mock_files, mock_request
    ):
        mock_files.return_value = self.changed_files

        marker = lf._inline_marker(self.finding)
        existing_comments = [
            {
                "id": 999,
                "body": marker + "\nSomeone else's comment",
                "path": "review_test.py",
                "user": {"login": "another-user"},
            }
        ]
        self.configure_github_mock(
            mock_request,
            existing_comments=existing_comments,
        )

        result = lf.publish_inline_comments(
            "example/repo",
            1,
            "fake-token",
            [self.finding],
            head_sha="test-head-sha",
        )

        self.assertEqual(result["inline_comments_updated"], 0)
        self.assertEqual(result["inline_comments_posted"], 1)

        patched_calls = [
            call for call in mock_request.call_args_list
            if call.kwargs.get("method") == "PATCH"
        ]
        posted_calls = [
            call for call in mock_request.call_args_list
            if call.kwargs.get("method") == "POST"
        ]

        self.assertEqual(patched_calls, [])
        self.assertEqual(len(posted_calls), 1)

    @patch("backend.lambda_function.github_request")
    @patch("backend.lambda_function.get_changed_files")
    def test_skips_inline_comments_if_identity_cannot_be_verified(
        self, mock_files, mock_request
    ):
        mock_files.return_value = self.changed_files
        self.configure_github_mock(
            mock_request,
            user_response=[],
        )

        result = lf.publish_inline_comments(
            "example/repo",
            1,
            "fake-token",
            [self.finding],
            head_sha="test-head-sha",
        )

        self.assertEqual(result["inline_comments_posted"], 0)
        self.assertEqual(result["inline_comments_updated"], 0)
        self.assertEqual(len(result["inline_comments_skipped"]), 1)
        self.assertIn(
            "Could not verify the GitHub account",
            result["inline_comments_skipped"][0]["reason"],
        )

        write_calls = [
            call for call in mock_request.call_args_list
            if call.kwargs.get("method") in ("POST", "PATCH")
        ]
        self.assertEqual(write_calls, [])

    @patch("backend.lambda_function.github_request")
    @patch("backend.lambda_function.get_changed_files")
    def test_api_rejection_is_recorded(
        self, mock_files, mock_request
    ):
        mock_files.return_value = self.changed_files
        self.configure_github_mock(
            mock_request,
            reject_posts=True,
        )

        result = lf.publish_inline_comments(
            "example/repo",
            1,
            "fake-token",
            [self.finding],
            head_sha="test-head-sha",
        )

        self.assertEqual(result["inline_comments_posted"], 0)
        self.assertEqual(result["inline_comments_updated"], 0)
        self.assertEqual(len(result["inline_comments_skipped"]), 1)
        self.assertEqual(
            result["inline_comments_skipped"][0]["http_status"],
            422,
        )
        self.assertEqual(result["inline_comments_failed"], 1)


if __name__ == "__main__":
    unittest.main()

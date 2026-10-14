

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import logging
import os
import re
import urllib.error
import urllib.parse
import urllib.request
from typing import Any

import boto3

from .review_engine.analyzer import review_files

AWS_REGION = os.environ.get("AWS_REGION", "ap-south-1")
PARAMETER_NAME = "/code-review-agent/github-token"
SUMMARY_MARKER = "<!-- ai-code-review-agent-summary -->"
INLINE_MARKER_PREFIX = "<!-- ai-code-review-agent-inline:"
GITHUB_API = "https://api.github.com"
USER_AGENT = "AI-Code-Review-Agent"
HTTP_TIMEOUT_SECONDS = 8
MAX_CHANGED_FILES = 300
MAX_INLINE_COMMENTS_PER_RUN = 20
MAX_COMMENTS_TO_SCAN = 300

logging.getLogger().setLevel(logging.INFO)
logger = logging.getLogger(__name__)
ssm = boto3.client("ssm", region_name=AWS_REGION)
lambda_client = boto3.client("lambda", region_name=AWS_REGION)


class GitHubAPIError(RuntimeError):
    """A GitHub API error with safe diagnostic details."""

    def __init__(self, status: int, message: str, errors: Any = None):
        self.status = status
        self.message = message
        self.errors = errors
        super().__init__(f"GitHub HTTP {status}: {message}")


def response(status_code: int, message: dict[str, Any]) -> dict[str, Any]:
    return {
        "statusCode": status_code,
        "headers": {"Content-Type": "application/json"},
        "body": json.dumps(message),
    }


def get_github_token() -> str:
    result = ssm.get_parameter(Name=PARAMETER_NAME, WithDecryption=True)
    token = result.get("Parameter", {}).get("Value")
    if not token:
        raise RuntimeError("GitHub token parameter is empty or missing")
    return token


def _parse_json(raw: str) -> Any:
    if not raw:
        return None
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return {"raw": raw[:2000]}


def github_request(
    url: str,
    token: str,
    method: str = "GET",
    payload: dict[str, Any] | None = None,
) -> tuple[int, Any]:
    """Make a GitHub API request and preserve useful, secret-safe API errors."""
    headers = {
        "Authorization": f"Bearer {token}",
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": USER_AGENT,
    }
    data = None
    if payload is not None:
        data = json.dumps(payload).encode("utf-8")
        headers["Content-Type"] = "application/json"

    request = urllib.request.Request(
        url, data=data, headers=headers, method=method
    )
    try:
        with urllib.request.urlopen(request, timeout=HTTP_TIMEOUT_SECONDS) as result:
            raw = result.read().decode("utf-8", errors="replace")
            return result.status, _parse_json(raw)
    except urllib.error.HTTPError as error:
        raw = error.read().decode("utf-8", errors="replace")
        parsed = _parse_json(raw)
        if isinstance(parsed, dict):
            message = str(parsed.get("message", "No message provided"))
            details = parsed.get("errors", [])
        else:
            message = "GitHub returned a non-JSON error response"
            details = []
        # Never log request headers or tokens. GitHub error bodies are useful for
        # diagnosing 4xx responses; cap their length to avoid oversized logs.
        logger.warning(
            "GitHub API rejected %s %s: status=%s message=%s errors=%s",
            method,
            _safe_url_for_log(url),
            error.code,
            message[:500],
            json.dumps(details, ensure_ascii=True)[:1500],
        )
        raise GitHubAPIError(error.code, message, details) from None
    except urllib.error.URLError as error:
        # Do not print headers, request objects, or credential-bearing data.
        reason = getattr(error, "reason", "connection error")
        raise RuntimeError(f"Could not connect to GitHub API: {reason}") from None


def _safe_url_for_log(url: str) -> str:
    """Remove query parameters from URLs before logging."""
    parts = urllib.parse.urlsplit(url)
    return urllib.parse.urlunsplit((parts.scheme, parts.netloc, parts.path, "", ""))


def github_get_paginated(
    url: str, token: str, max_items: int
) -> list[dict[str, Any]]:
    """Fetch paginated GitHub list endpoints, bounded to prevent runaway work."""
    items: list[dict[str, Any]] = []
    page_url = url
    while page_url and len(items) < max_items:
        status, data = github_request(page_url, token)
        del status
        if not isinstance(data, list):
            raise RuntimeError("GitHub API returned an unexpected list response")
        items.extend(item for item in data if isinstance(item, dict))
        if len(data) < 100:
            break
        parsed = urllib.parse.urlsplit(page_url)
        query = urllib.parse.parse_qs(parsed.query)
        page = int(query.get("page", ["1"])[0])
        query["page"] = [str(page + 1)]
        query.setdefault("per_page", ["100"])
        page_url = urllib.parse.urlunsplit(
            (parsed.scheme, parsed.netloc, parsed.path,
             urllib.parse.urlencode(query, doseq=True), "")
        )
    return items[:max_items]


def get_pull_request(repository: str, pr_number: int, token: str) -> dict[str, Any]:
    url = f"{GITHUB_API}/repos/{repository}/pulls/{pr_number}"
    _, pr = github_request(url, token)
    if not isinstance(pr, dict):
        raise RuntimeError("GitHub returned an invalid pull-request response")
    return pr


def get_changed_files(
    repository: str, pr_number: int, token: str
) -> list[dict[str, Any]]:
    url = (
        f"{GITHUB_API}/repos/{repository}/pulls/{pr_number}/files"
        "?per_page=100&page=1"
    )
    files = github_get_paginated(url, token, MAX_CHANGED_FILES)
    return [
        {
            "filename": str(item.get("filename", "unknown")),
            "status": str(item.get("status", "unknown")),
            "patch": str(item.get("patch") or ""),
        }
        for item in files
    ]



def format_review_comment(
    review: dict[str, Any], repository: str, pr_number: int
) -> str:
    lines = [
        SUMMARY_MARKER,
        "## AI Code Review Agent",
        "",
        f"**Repository:** `{repository}`",
        f"**Pull request:** #{pr_number}",
        "",
        "### Summary",
        f"- Files scanned: {review['files_scanned']}",
        f"- Files skipped (no text diff available): {len(review['files_skipped'])}",
        f"- Issues found: {review['finding_count']}",
        "",
    ]
    if review["findings"]:
        lines.append("### Findings")
        for finding in review["findings"][:100]:
            lines.append(
                f"- **[{finding['severity']}] {finding['rule']}** — "
                f"`{finding['filename']}` (line {finding['line']}): "
                f"{finding['message']}"
            )
        if len(review["findings"]) > 100:
                        lines.append(
                f"- _{len(review['findings']) - 100} additional findings "
                "omitted from this summary._"
            )
    else:
        lines.append("No issues detected by the current review rules.")
    lines.extend([
        "",
        "---",
        "_Automated review; findings are heuristics and should be verified by a developer._",
    ])
    return "\n".join(lines)


def publish_review_comment(
    repository: str, pr_number: int, token: str, comment: str
) -> int:
    """Create or update one identifiable summary comment on the PR."""
    base_url = f"{GITHUB_API}/repos/{repository}"
    comments_url = f"{base_url}/issues/{pr_number}/comments?per_page=100&page=1"
    comments = github_get_paginated(comments_url, token, MAX_COMMENTS_TO_SCAN)
    _, current_user = github_request(f"{GITHUB_API}/user", token)
    login = current_user.get("login", "") if isinstance(current_user, dict) else ""
    existing = next((
        item for item in comments
        if SUMMARY_MARKER in str(item.get("body", ""))
        and item.get("user", {}).get("login") == login
    ), None)
    if existing:
        url = f"{base_url}/issues/comments/{existing['id']}"
        status, _ = github_request(url, token, method="PATCH", payload={"body": comment})
        return status
    url = f"{base_url}/issues/{pr_number}/comments"
    status, _ = github_request(url, token, method="POST", payload={"body": comment})
    return status


def _added_line_numbers(files: list[dict[str, Any]]) -> dict[str, set[int]]:
    """Map filenames to line numbers that are genuinely added in each PR diff."""
    result: dict[str, set[int]] = {}
    for file in files:
        filename = str(file.get("filename", "unknown"))
        new_line: int | None = None
        added = result.setdefault(filename, set())
        for diff_line in str(file.get("patch") or "").splitlines():
            if diff_line.startswith("@@"):
                match = re.search(r"\+(\d+)(?:,(\d+))?", diff_line)
                new_line = int(match.group(1)) if match else None
                continue
            if diff_line.startswith(("+++", "---")):
                continue
            if diff_line.startswith("+"):
                if new_line is not None:
                    added.add(new_line)
                    new_line += 1
            elif diff_line.startswith(" "):
                if new_line is not None:
                    new_line += 1
            # A removed line is present only on the old side; don't increment new_line.
    return result


def _inline_marker(finding: dict[str, Any]) -> str:
    return (
        f"{INLINE_MARKER_PREFIX}{finding['rule']}:{finding['filename']}:{finding['line']} -->"
    )


def publish_inline_comments(
    repository: str,
    pr_number: int,
    token: str,
    findings: list[dict[str, Any]],
    files: list[dict[str, Any]] | None = None,
    head_sha: str | None = None,
) -> dict[str, Any]:
    """Upsert inline comments only on added diff lines; record failures per finding.

    GitHub's 422 responses are common for stale or non-commentable diff positions.
    Each failure is recorded and processing continues, so one rejected annotation
    cannot fail the summary review. When possible, include the current PR head SHA.
    """
    base_url = f"{GITHUB_API}/repos/{repository}"
    if files is None:
        files = get_changed_files(repository, pr_number, token)
    added_lines = _added_line_numbers(files)

    # Get a current commit SHA if the caller didn't provide one. Some unit-test
    # doubles return a list here; handle that safely and fall back to line/side.
    if not head_sha:
        try:
            pr = get_pull_request(repository, pr_number, token)
            head_sha = (pr.get("head") or {}).get("sha")
        except Exception as error:  # inline annotations remain best-effort
            logger.warning("Could not obtain current PR head SHA: %s", type(error).__name__)

    comments_url = f"{base_url}/pulls/{pr_number}/comments?per_page=100&page=1"
    try:
        existing_comments = github_get_paginated(
            comments_url, token, MAX_COMMENTS_TO_SCAN
        )
    except Exception as error:
        logger.warning("Could not list existing inline comments: %s", type(error).__name__)
        existing_comments = []

    # Only update inline comments owned by the identity behind this token.
    # If GitHub cannot identify that identity, fail closed for inline comments.
    try:
        _, current_user = github_request(f"{GITHUB_API}/user", token)
        bot_login = (
            current_user.get("login", "")
            if isinstance(current_user, dict)
            else ""
        )
    except Exception as error:
        logger.warning(
            "Could not verify GitHub comment owner: %s",
            type(error).__name__,
        )
        bot_login = ""

    existing_by_marker: dict[str, dict[str, Any]] = {}
    for comment in existing_comments:
        owner = (comment.get("user") or {}).get("login")
        if not bot_login or owner != bot_login:
            continue

        body = str(comment.get("body", ""))
        start = body.find(INLINE_MARKER_PREFIX)
        if start >= 0:
            end = body.find("-->", start)
            if end >= 0:
                existing_by_marker[body[start:end + 3]] = comment

    result: dict[str, Any] = {
        "inline_comments_posted": 0,
        "inline_comments_updated": 0,
        "inline_comments_skipped": [],
        "inline_comments_failed": 0,
    }
    processed = 0
    for finding in findings:
        filename = str(finding.get("filename", "unknown"))
        try:
            line = int(finding["line"])
        except (KeyError, TypeError, ValueError):
            result["inline_comments_skipped"].append({
                "filename": filename,
                "reason": (
                    f"Safety cap of {MAX_INLINE_COMMENTS_PER_RUN} "
                        "new inline comments reached"
                ),
            })
            continue
        rule = str(finding.get("rule", "unknown-rule"))

        if not bot_login:
            result["inline_comments_skipped"].append({
                "filename": filename,
                "line": line,
                "rule": rule,
                "reason": (
                    "Could not verify the GitHub account; "
                    "inline comment was not created or updated"
                ),
            })
            continue

        if line not in added_lines.get(filename, set()):
            result["inline_comments_skipped"].append({
                "filename": filename,
                "line": line,
                "rule": rule,
                "reason": "Line is not an added line in the current PR diff",
            })
            continue

        marker = _inline_marker(finding)
        body = (
            f"{marker}\n"
            f"**[{finding.get('severity', 'INFO')}] {rule}**\n\n"
            f"{finding.get('message', 'Potential issue detected.')}\n\n"
            "_Automated finding; verify the context before changing code._"
        )
        existing = existing_by_marker.get(marker)

        try:
            if existing:
                url = f"{base_url}/pulls/comments/{existing['id']}"
                github_request(url, token, method="PATCH", payload={"body": body})
                result["inline_comments_updated"] += 1
            else:
                if processed >= MAX_INLINE_COMMENTS_PER_RUN:
                    result["inline_comments_skipped"].append({
                        "filename": filename,
                        "line": line,
                        "rule": rule,
                        "reason": (
    f"Safety cap of {MAX_INLINE_COMMENTS_PER_RUN} "
    "new inline comments reached"
),
                    })
                    continue
                payload: dict[str, Any] = {
                    "body": body,
                    "path": filename,
                    "line": line,
                    "side": "RIGHT",
                }
                if head_sha:
                    payload["commit_id"] = head_sha
                github_request(
                    f"{base_url}/pulls/{pr_number}/comments",
                    token,
                    method="POST",
                    payload=payload,
                )
                result["inline_comments_posted"] += 1
                processed += 1
        except (GitHubAPIError, urllib.error.HTTPError) as error:
            # Production requests are wrapped as GitHubAPIError. Also handle raw
            # HTTPError directly so isolated unit tests/mocks and alternate callers
            # still produce a useful, structured result.
            if isinstance(error, GitHubAPIError):
                status_code = error.status
                message = error.message
                details = error.errors
            else:
                status_code = error.code
                raw_details = error.read().decode("utf-8", errors="replace")
                parsed_details = _parse_json(raw_details)
                if isinstance(parsed_details, dict):
                    message = str(parsed_details.get("message", "No message provided"))
                    details = parsed_details.get("errors", [])
                else:
                    message = "GitHub returned a non-JSON error response"
                    details = []
            # 422 means the request is not valid for GitHub's current diff/API
            # state. Keep detailed API validation errors, but never log secrets.
            logger.warning(
                "Inline comment rejected: repo=%s pr=%s path=%s line=%s rule=%s "
                "status=%s message=%s errors=%s",
                repository,
                pr_number,
                filename,
                line,
                rule,
                status_code,
                message[:500],
                json.dumps(details, ensure_ascii=True)[:1500],
            )
            result["inline_comments_failed"] += 1
            result["inline_comments_skipped"].append({
                "filename": filename,
                "line": line,
                "rule": rule,
                "http_status": status_code,
                "reason": message,
                "errors": details,
            })
        except Exception as error:
            logger.exception(
                "Unexpected inline-comment failure: repo=%s pr=%s path=%s line=%s error_type=%s",
                repository,
                pr_number,
                filename,
                line,
                type(error).__name__,
            )
            result["inline_comments_failed"] += 1
            result["inline_comments_skipped"].append({
                "filename": filename,
                "line": line,
                "rule": rule,
                "reason": f"Unexpected error: {type(error).__name__}",
            })
    return result


def process_review(repository: str, pr_number: int) -> dict[str, Any]:
    """Background worker: fetch current PR state, review, and publish comments."""
    if not _is_allowed_repository(repository):
        raise ValueError("Repository is not allowlisted")
    if type(pr_number) is not int or pr_number < 1:
        raise ValueError("Pull request number must be a positive integer")

    token = get_github_token()
    pr = get_pull_request(repository, pr_number, token)
    head_sha = (pr.get("head") or {}).get("sha")
    if not head_sha:
        raise RuntimeError("Pull request response did not include head SHA")

    files = get_changed_files(repository, pr_number, token)
    review = review_files(files)
    summary = format_review_comment(review, repository, pr_number)
    summary_status = publish_review_comment(repository, pr_number, token, summary)
    inline_result = publish_inline_comments(
        repository,
        pr_number,
        token,
        review["findings"],
        files=files,
        head_sha=head_sha,
    )
    result = {
        "message": "Code review completed",
        "repository": repository,
        "pull_request_number": pr_number,
        "head_sha": head_sha,
        "comment_status": summary_status,
        **review,
        **inline_result,
    }
    logger.info("REVIEW_RESULT %s", json.dumps(result, ensure_ascii=True))
    return result


def _valid_repository(repository: Any) -> bool:
    """Validate GitHub's owner/repo form before building API URLs."""
    if not isinstance(repository, str) or len(repository) > 200:
        return False
    parts = repository.split("/")
    return (
        len(parts) == 2
        and all(part and re.fullmatch(r"[A-Za-z0-9_.-]+", part) for part in parts)
    )


def _is_allowed_repository(repository: Any) -> bool:
    """Validate the repository and enforce the configured repository allowlist."""
    allowed_repo = os.environ.get(
        "GITHUB_REPOSITORY",
        "mdibrahim-ux/ai-code-review-agent",
    ).strip()

    return (
        _valid_repository(repository)
        and _valid_repository(allowed_repo)
        and repository.casefold() == allowed_repo.casefold()
    )


def lambda_handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
    """Handle either an internal async job or a signed GitHub webhook."""
    if event.get("_async_review") is True:
        repository = event.get("repository")
        pr_number = event.get("pull_request_number")
        if (
            not _is_allowed_repository(repository)
            or type(pr_number) is not int
            or pr_number < 1
        ):
            logger.error("Invalid or non-allowlisted internal review event")
            return {"error": "Invalid internal review event"}
        try:
            return process_review(repository, pr_number)
        except Exception as error:
            logger.exception(
                "Background review failed: error_type=%s", type(error).__name__
            )
            # Re-raise so Lambda marks the async invocation as failed and can retry.
            raise

    secret = os.environ.get("GITHUB_WEBHOOK_SECRET")
    if not secret:
        logger.error("GITHUB_WEBHOOK_SECRET is not configured")
        return response(500, {"error": "Webhook secret is not configured"})

    headers = {
        str(key).lower(): value
        for key, value in (event.get("headers") or {}).items()
    }
    signature = headers.get("x-hub-signature-256")
    if not signature:
        return response(401, {"error": "Missing GitHub signature"})

    raw_body = event.get("body") or ""
    try:
        if event.get("isBase64Encoded"):
            raw_body = base64.b64decode(raw_body, validate=True)
        elif isinstance(raw_body, str):
            raw_body = raw_body.encode("utf-8")
        if not isinstance(raw_body, bytes):
            return response(400, {"error": "Invalid request body"})
    except (ValueError, TypeError):
        return response(400, {"error": "Invalid request body"})

    expected = "sha256=" + hmac.new(
        secret.encode("utf-8"), raw_body, hashlib.sha256
    ).hexdigest()
    if not hmac.compare_digest(expected, str(signature)):
        return response(401, {"error": "Invalid GitHub signature"})

    try:
        payload = json.loads(raw_body.decode("utf-8"))
    except (json.JSONDecodeError, UnicodeDecodeError):
        return response(400, {"error": "Invalid JSON payload"})
    if not isinstance(payload, dict):
        return response(400, {"error": "Invalid JSON payload"})

    event_type = headers.get("x-github-event", "unknown")
    action = payload.get("action")
    if event_type != "pull_request" or action not in ("opened", "synchronize", "reopened"):
        return response(200, {
            "message": "Event received; no review requested",
            "event": event_type,
            "action": action,
        })

    repository = (payload.get("repository") or {}).get("full_name")
    pr_number = (payload.get("pull_request") or {}).get("number")
    if (
        not _valid_repository(repository)
        or type(pr_number) is not int
        or pr_number < 1
    ):
        return response(400, {"error": "Missing or invalid repository or PR number"})

    # Enforce the same allowlist for public webhook events and internal jobs.
    if not _is_allowed_repository(repository):
        logger.warning(
            "Ignoring webhook for non-allowlisted repository: %s",
            repository,
        )
        return response(403, {"error": "Repository is not allowlisted"})

    try:
        invoke_result = lambda_client.invoke(
            FunctionName=getattr(context, "invoked_function_arn", "code-review-agent"),
            InvocationType="Event",
            Payload=json.dumps({
                "_async_review": True,
                "repository": repository,
                "pull_request_number": pr_number,
            }).encode("utf-8"),
        )
        status = invoke_result.get("StatusCode", 0)
        if status != 202:
            logger.error("Async invocation was not accepted: status=%s", status)
            return response(502, {"error": "Could not queue review"})
    except Exception as error:
        logger.exception("Could not queue review: error_type=%s", type(error).__name__)
        return response(502, {"error": "Could not queue review"})

    return response(202, {
        "message": "Review accepted for background processing",
        "repository": repository,
        "pull_request_number": pr_number,
    })

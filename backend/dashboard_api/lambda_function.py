"""Read-only HTTP API for the Sentinel dashboard.

Routes:
- GET /health
- GET /dashboard
- GET /pull-requests
- POST /review (analyze a PR diff only; never publish comments)

The handler is deliberately read-only with respect to GitHub. The separate
backend/lambda_function.py is the signed webhook worker that posts comments.
"""
from __future__ import annotations

import base64
import json
import logging
import os
import re
import urllib.error
import urllib.parse
import urllib.request
from typing import Any

import boto3

try:  # Repository import
    from backend.review_engine.analyzer import review_files
except ModuleNotFoundError:  # Flat Lambda ZIP import
    from review_engine.analyzer import review_files

AWS_REGION = os.environ.get("AWS_REGION", "ap-south-1")
PARAMETER_NAME = "/code-review-agent/github-token"
GITHUB_API = "https://api.github.com"
USER_AGENT = "Sentinel-Dashboard-API"
# Bound each upstream HTTP request to fit inside the dashboard Lambda time budget.
REQUEST_TIMEOUT_SECONDS = 4
MAX_PULL_REQUESTS = 30
MAX_CHANGED_FILES = 100
MAX_FULL_SOURCE_FILES = 2
MAX_SOURCE_FILE_BYTES = 50_000
MAX_PATCH_BYTES = 100_000
MAX_BODY_BYTES = 32_768

DEFAULT_REPOSITORY = "mdibrahim-ux/ai-code-review-agent"
DEFAULT_ALLOWED_ORIGINS = {
    "http://localhost:8000",
    "http://127.0.0.1:8080",
    "http://localhost:5500",
    "http://127.0.0.1:5500",
    "https://mdibrahim-ux.github.io",
}

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)
ssm = boto3.client("ssm", region_name=AWS_REGION)


class GitHubAPIError(RuntimeError):
    """GitHub returned an unsuccessful HTTP response."""

    def __init__(self, status: int, message: str):
        self.status = status
        self.message = message
        super().__init__(f"GitHub HTTP {status}: {message}")


def configured_repository() -> str:
    """Return the fixed repository allowlist; clients cannot select repositories."""
    value = os.environ.get("GITHUB_REPOSITORY", DEFAULT_REPOSITORY).strip()
    if not re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", value):
        logger.error("GITHUB_REPOSITORY is invalid; refusing to make GitHub calls")
        return DEFAULT_REPOSITORY
    return value


def allowed_origins() -> set[str]:
    raw = os.environ.get("DASHBOARD_ALLOWED_ORIGINS", "")
    configured = {item.strip() for item in raw.split(",") if item.strip()}
    return configured or set(DEFAULT_ALLOWED_ORIGINS)


def _headers(event: dict[str, Any]) -> dict[str, str]:
    incoming = {
        str(key).lower(): str(value)
        for key, value in (event.get("headers") or {}).items()
    }
    origin = incoming.get("origin", "")
    headers = {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
        "Vary": "Origin",
    }
    if origin in allowed_origins():
        headers["Access-Control-Allow-Origin"] = origin
        headers["Access-Control-Allow-Methods"] = "GET,POST,OPTIONS"
        headers["Access-Control-Allow-Headers"] = "Content-Type"
        headers["Access-Control-Max-Age"] = "300"
    return headers


def response(status_code: int, body: dict[str, Any], event: dict[str, Any]) -> dict[str, Any]:
    return {
        "statusCode": status_code,
        "headers": _headers(event),
        "body": json.dumps(body, ensure_ascii=True),
        "isBase64Encoded": False,
    }


def get_github_token() -> str:
    """Read the GitHub token without ever logging its value."""
    result = ssm.get_parameter(Name=PARAMETER_NAME, WithDecryption=True)
    token = result.get("Parameter", {}).get("Value")
    if not isinstance(token, str) or not token.strip():
        raise RuntimeError("GitHub token parameter is empty or missing")
    return token


def github_request_json(url: str, token: str) -> Any:
    """Make a bounded GET request to GitHub's REST API."""
    request = urllib.request.Request(
        url,
        headers={
            "Authorization": f"Bearer {token}",
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
            "User-Agent": USER_AGENT,
        },
        method="GET",
    )
    try:
        with urllib.request.urlopen(request, timeout=REQUEST_TIMEOUT_SECONDS) as result:
            raw = result.read(MAX_PATCH_BYTES + 1)
            if len(raw) > MAX_PATCH_BYTES:
                raise RuntimeError("GitHub response exceeded the configured size limit")
            return json.loads(raw.decode("utf-8"))
    except urllib.error.HTTPError as exc:
        # Do not include URLs, headers, or token values in logs/messages.
        message = "GitHub rejected the request"
        try:
            payload = json.loads(exc.read(2048).decode("utf-8", "replace"))
            message = str(payload.get("message", message))[:240]
        except Exception:
            pass
        raise GitHubAPIError(exc.code, message) from None
    except urllib.error.URLError:
        raise RuntimeError("Unable to reach the GitHub API") from None
    except (json.JSONDecodeError, UnicodeDecodeError):
        raise RuntimeError("GitHub returned an invalid JSON response") from None


def github_url(path: str, query: dict[str, str] | None = None) -> str:
    repo = configured_repository()
    url = f"{GITHUB_API}/repos/{repo}/{path.lstrip('/')}"
    if query:
        url = f"{url}?{urllib.parse.urlencode(query)}"
    return url


def _fetch_full_python_source(filename: str, ref: str, token: str) -> str | None:
    """Fetch a small changed Python file from the exact PR head commit.

    Returns None when the file is missing, non-UTF-8, too large, or unavailable.
    The caller then falls back to AST analysis of the unified-diff hunks.
    """
    normalized = filename.replace(chr(92), "/")
    parts = normalized.split("/")
    if (
        not normalized.lower().endswith(".py")
        or normalized.startswith("/")
        or any(part in {"", ".", ".."} for part in parts)
        or len(normalized) > 1_000
    ):
        return None

    encoded_path = urllib.parse.quote(normalized, safe="/")
    payload = github_request_json(
        github_url(f"contents/{encoded_path}", {"ref": ref}), token
    )
    if not isinstance(payload, dict) or payload.get("encoding") != "base64":
        return None

    size = payload.get("size")
    if not isinstance(size, int) or isinstance(size, bool):
        return None
    if size < 0 or size > MAX_SOURCE_FILE_BYTES:
        return None

    encoded_content = payload.get("content")
    if not isinstance(encoded_content, str) or len(encoded_content) > (MAX_SOURCE_FILE_BYTES * 4 // 3 + 2_000):
        return None
    try:
        source_bytes = base64.b64decode(encoded_content, validate=False)
        source_text = source_bytes.decode("utf-8", "strict")
    except (ValueError, UnicodeDecodeError):
        return None

    if len(source_bytes) > MAX_SOURCE_FILE_BYTES or not source_text:
        return None
    return source_text


def _enrich_python_source_context(
    files: list[dict[str, Any]], head_sha: str, token: str
) -> tuple[list[dict[str, Any]], int]:
    """Attach complete content for at most two changed Python files, best-effort."""
    if not isinstance(head_sha, str) or not head_sha.strip():
        return files, 0

    attempts = 0
    loaded = 0
    for item in files:
        if attempts >= MAX_FULL_SOURCE_FILES:
            break
        filename = str(item.get("filename", ""))
        if not filename.lower().endswith(".py") or not item.get("patch"):
            continue
        attempts += 1
        try:
            source_text = _fetch_full_python_source(filename, head_sha, token)
        except GitHubAPIError as exc:
            logger.info("Full-source context skipped: GitHub status=%s", exc.status)
            continue
        except Exception as exc:
            logger.info("Full-source context skipped: %s", type(exc).__name__)
            continue
        if source_text is not None:
            item["source_text"] = source_text
            loaded += 1
    return files, loaded


def _open_pull_request_summary(pr: dict[str, Any]) -> dict[str, Any]:
    user = pr.get("user") or {}
    head = pr.get("head") or {}
    base = pr.get("base") or {}
    return {
        "number": int(pr.get("number", 0)),
        "title": str(pr.get("title", "Untitled pull request"))[:300],
        "state": str(pr.get("state", "unknown")),
        "author": str(user.get("login", "unknown"))[:100],
        "url": str(pr.get("html_url", "")),
        "updated_at": str(pr.get("updated_at", "")),
        "draft": bool(pr.get("draft", False)),
        "head_branch": str(head.get("ref", ""))[:200],
        "base_branch": str(base.get("ref", ""))[:200],
        "changed_files": int(pr.get("changed_files", 0) or 0),
        "additions": int(pr.get("additions", 0) or 0),
        "deletions": int(pr.get("deletions", 0) or 0),
    }


def list_open_pull_requests(token: str) -> list[dict[str, Any]]:
    raw = github_request_json(
        github_url(
            "pulls",
            {
                "state": "open",
                "per_page": str(MAX_PULL_REQUESTS),
                "sort": "updated",
                "direction": "desc",
            },
        ),
        token,
    )
    if not isinstance(raw, list):
        raise RuntimeError("GitHub returned an unexpected pull-request list")
    items = []
    for pr in raw[:MAX_PULL_REQUESTS]:
        if not isinstance(pr, dict):
            continue
        summary = _open_pull_request_summary(pr)
        if summary["number"] > 0:
            items.append(summary)
    return items


def _parse_request_body(event: dict[str, Any]) -> dict[str, Any]:
    raw = event.get("body") or ""
    if event.get("isBase64Encoded"):
        try:
            raw = base64.b64decode(raw, validate=True)
        except (ValueError, TypeError):
            raise ValueError("Invalid request body encoding") from None
    if isinstance(raw, bytes):
        if len(raw) > MAX_BODY_BYTES:
            raise ValueError("Request body is too large")
        raw = raw.decode("utf-8", "strict")
    elif isinstance(raw, str):
        if len(raw.encode("utf-8")) > MAX_BODY_BYTES:
            raise ValueError("Request body is too large")
    else:
        raise ValueError("Invalid request body")
    try:
        body = json.loads(raw or "{}")
    except (json.JSONDecodeError, UnicodeDecodeError):
        raise ValueError("Request body must be valid JSON") from None
    if not isinstance(body, dict):
        raise ValueError("Request body must be a JSON object")
    return body


def _positive_pr_number(value: Any) -> int:
    if isinstance(value, bool):
        raise ValueError("pull_request_number must be a positive integer")
    if isinstance(value, int):
        number = value
    elif isinstance(value, str) and value.isascii() and value.isdecimal():
        number = int(value)
    else:
        raise ValueError("pull_request_number must be a positive integer")
    if number < 1 or number > 2_147_483_647:
        raise ValueError("pull_request_number is outside the allowed range")
    return number


def _get_open_pr_and_files(
    token: str, pr_number: int
) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    pr = github_request_json(github_url(f"pulls/{pr_number}"), token)
    if not isinstance(pr, dict) or int(pr.get("number", 0) or 0) != pr_number:
        raise RuntimeError("GitHub returned an invalid pull-request record")
    if str(pr.get("state", "")).lower() != "open":
        raise GitHubAPIError(409, "Only open pull requests can be reviewed")
    base_repo = str(
        (pr.get("base") or {}).get("repo", {}).get("full_name", "")
    ).casefold()
    if base_repo != configured_repository().casefold():
        raise GitHubAPIError(403, "Pull request does not target the configured repository")

    raw_files = github_request_json(
        github_url(f"pulls/{pr_number}/files", {"per_page": str(MAX_CHANGED_FILES), "page": "1"}),
        token,
    )
    if not isinstance(raw_files, list):
        raise RuntimeError("GitHub returned an invalid changed-file list")
    files: list[dict[str, Any]] = []
    for item in raw_files[:MAX_CHANGED_FILES]:
        if not isinstance(item, dict):
            continue
        patch = item.get("patch")
        if not isinstance(patch, str):
            patch = ""
        files.append({
            "filename": str(item.get("filename", "unknown"))[:1000],
            "status": str(item.get("status", "unknown"))[:40],
            "patch": patch,
        })
    return pr, files


def review_pull_request(token: str, pr_number: int) -> dict[str, Any]:
    """Analyze a PR diff using configured rules, without publishing GitHub comments."""
    pr, files = _get_open_pr_and_files(token, pr_number)
    head_sha = str((pr.get("head") or {}).get("sha", ""))
    files, source_context_files_loaded = _enrich_python_source_context(files, head_sha, token)
    analysis = review_files(files)
    severity_counts = {"critical": 0, "high": 0, "medium": 0, "low": 0}
    for item in analysis["findings"]:
        severity = str(item.get("severity", "LOW")).lower()
        if severity in severity_counts:
            severity_counts[severity] += 1
        else:
            severity_counts["low"] += 1

    return {
        "repository": configured_repository(),
        "pull_request_number": pr_number,
        "title": str(pr.get("title", ""))[:300],
        "url": str(pr.get("html_url", "")),
        "head_sha": head_sha,
        "source_context_files_loaded": source_context_files_loaded,
        "status": "reviewed",
        "mode": "read-only",
        "files_scanned": int(analysis["files_scanned"]),
        "files_skipped": analysis["files_skipped"],
        "finding_count": int(analysis["finding_count"]),
        "findings_by_severity": severity_counts,
        "findings": analysis["findings"],
        "comments_published": False,
        "message": "Analysis completed. No comments were published to GitHub.",
    }


def lambda_handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
    """Handle API Gateway HTTP API payload format 2.0."""
    del context
    if not isinstance(event, dict):
        return response(400, {"error": "Invalid event"}, {})

    request_context = event.get("requestContext") or {}
    http = request_context.get("http") or {}
    method = str(http.get("method") or event.get("httpMethod") or "").upper()
    path = str(event.get("rawPath") or event.get("path") or "").rstrip("/") or "/"

    if method == "OPTIONS":
        return response(200, {"message": "CORS preflight OK"}, event)
    if method == "GET" and path == "/health":
        return response(200, {"status": "ok", "service": "sentinel-dashboard-api"}, event)

    if method not in {"GET", "POST"}:
        return response(405, {"error": "Method not allowed"}, event)

    try:
        if method == "GET" and path in {"/pull-requests", "/dashboard"}:
            token = get_github_token()
            pull_requests = list_open_pull_requests(token)
            if path == "/pull-requests":
                return response(200, {
                    "repository": configured_repository(),
                    "count": len(pull_requests),
                    "pull_requests": pull_requests,
                }, event)
            # Historical findings aren't persisted, so this endpoint does not invent totals.
            return response(200, {
                "repository": configured_repository(),
                "status": "connected",
                "mode": "live",
                "count": len(pull_requests),
                "pull_requests": pull_requests,
                "finding_totals_available": False,
                "message": (
                    "Live pull-request metadata is available. Finding totals "
                    "are returned per review and are not stored historically."
                ),
            }, event)

        if method == "POST" and path == "/review":
            body = _parse_request_body(event)
            pr_number = _positive_pr_number(body.get("pull_request_number"))
            token = get_github_token()
            return response(200, review_pull_request(token, pr_number), event)

        return response(404, {"error": "Route not found"}, event)

    except ValueError as exc:
        return response(400, {"error": str(exc)}, event)
    except GitHubAPIError as exc:
        status_code = exc.status if exc.status in {403, 404, 409, 422} else 502
        return response(status_code, {"error": exc.message}, event)
    except Exception as exc:
        # Keep diagnostics useful without emitting GitHub tokens or request headers.
        logger.error("Dashboard API failed: %s", type(exc).__name__)
        return response(502, {"error": "Dashboard API could not complete the request"}, event)

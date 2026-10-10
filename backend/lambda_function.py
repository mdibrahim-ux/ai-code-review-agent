
import base64
import hashlib
import hmac
import json
import os
import re
import boto3
import urllib.request
import urllib.error

ssm = boto3.client("ssm", region_name="ap-south-1")
PARAMETER_NAME = "/code-review-agent/github-token"
COMMENT_MARKER = "<!-- ai-code-review-agent-summary -->"


def response(status_code, message):
    return {
        "statusCode": status_code,
        "headers": {"Content-Type": "application/json"},
        "body": json.dumps(message)
    }


def get_github_token():
    result = ssm.get_parameter(
        Name=PARAMETER_NAME,
        WithDecryption=True
    )
    return result["Parameter"]["Value"]


def github_request(url, token, method="GET", payload=None):
    headers = {
        "Authorization": f"Bearer {token}",
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "AI-Code-Review-Agent"
    }
    data = None

    if payload is not None:
        data = json.dumps(payload).encode("utf-8")
        headers["Content-Type"] = "application/json"

    request = urllib.request.Request(
        url, data=data, headers=headers, method=method
    )
    with urllib.request.urlopen(request, timeout=10) as result:
        raw = result.read().decode("utf-8")
        return result.status, (json.loads(raw) if raw else None)


def get_changed_files(repository, pr_number, token):
    url = (
        f"https://api.github.com/repos/{repository}"
        f"/pulls/{pr_number}/files?per_page=100"
    )
    _, files = github_request(url, token)

    return [
        {
            "filename": item.get("filename", "unknown"),
            "status": item.get("status", "unknown"),
            "patch": item.get("patch", "")
        }
        for item in files
    ]


def analyze_patch(filename, patch):
    findings = []
    current_line = 0

    rules = [
        (
            "hardcoded-secret",
            "HIGH",
            re.compile(
                r"(?i)(?:api[_-]?key|secret|password|access[_-]?token)"
                r"""["']?\s*[:=]\s*["'][^"']{8,}["']"""
            ),
            "Possible hardcoded credential. Use a secure secret store."
        ),
        (
            "unsafe-eval",
            "HIGH",
            re.compile(r"\beval\s*\("),
            "eval() can execute dynamically supplied code. Avoid it when possible."
        ),
        (
            "broad-exception",
            "LOW",
            re.compile(r"^\s*except\s+Exception\s*[:,]"),
            "Broad exception handling may hide unexpected errors."
        ),
        (
            "debug-print",
            "LOW",
            re.compile(r"\bprint\s*\("),
            "Debug output may expose sensitive information in logs."
        )
    ]

    for line in patch.splitlines():
        if line.startswith("@@"):
            match = re.search(r"\+(\d+)", line)
            if match:
                current_line = int(match.group(1))
            continue

        if line.startswith("+++"):
            continue

        if line.startswith("+"):
            code = line[1:]
            for rule_id, severity, pattern, message in rules:
                if pattern.search(code):
                    findings.append({
                        "filename": filename,
                        "line": current_line,
                        "rule": rule_id,
                        "severity": severity,
                        "message": message
                    })
            current_line += 1

        elif line.startswith(" "):
            current_line += 1

    return findings


def review_files(files):
    findings = []
    skipped_files = []

    for file in files:
        patch = file.get("patch")
        if not patch:
            skipped_files.append(file["filename"])
            continue

        findings.extend(analyze_patch(file["filename"], patch))

    severity_order = {"HIGH": 0, "MEDIUM": 1, "LOW": 2}
    findings.sort(
        key=lambda item: severity_order.get(item["severity"], 3)
    )

    return {
        "files_scanned": len(files) - len(skipped_files),
        "files_skipped": skipped_files,
        "finding_count": len(findings),
        "findings": findings
    }


def format_review_comment(review, repository, pr_number):
    lines = [
        COMMENT_MARKER,
        "## AI Code Review Agent",
        "",
        f"**Repository:** `{repository}`",
        f"**Pull request:** #{pr_number}",
        "",
        "### Summary",
        f"- Files scanned: {review['files_scanned']}",
        f"- Files skipped: {len(review['files_skipped'])}",
        f"- Issues found: {review['finding_count']}",
        ""
    ]

    if review["findings"]:
        lines.append("### Findings")
        for finding in review["findings"]:
            lines.append(
                f"- **[{finding['severity']}]** "
                f"`{finding['filename']}` (line {finding['line']}) — "
                f"{finding['message']} (`{finding['rule']}`)"
            )
    else:
        lines.append(
            "No issues detected by the current review rules."
        )

    lines.extend([
        "",
        "---",
        "_Automated review; findings should be verified by a developer._"
    ])
    return "\n".join(lines)


def publish_review_comment(repository, pr_number, token, comment):
    base_url = f"https://api.github.com/repos/{repository}"
    comments_url = f"{base_url}/issues/{pr_number}/comments?per_page=100"
    _, comments = github_request(comments_url, token)

    # Identify the authenticated user so only its own summary is updated.
    _, current_user = github_request("https://api.github.com/user", token)
    bot_login = current_user.get("login", "")

    existing = next(
        (
            item for item in comments
            if COMMENT_MARKER in item.get("body", "")
            and item.get("user", {}).get("login") == bot_login
        ),
        None
    )

    if existing:
        url = f"{base_url}/issues/comments/{existing['id']}"
        method = "PATCH"
    else:
        url = f"{base_url}/issues/{pr_number}/comments"
        method = "POST"

    status, _ = github_request(
        url, token, method=method, payload={"body": comment}
    )
    return status



def publish_inline_comments(repository, pr_number, token, findings):
    """Post inline comments only on added lines in the current PR diff."""
    import re

    base_url = f"https://api.github.com/repos/{repository}"

    # Fetch the current diff metadata so we can validate target lines.
    files = get_changed_files(repository, pr_number, token)
    added_lines = {}

    for file in files:
        filename = file["filename"]
        patch = file.get("patch", "")
        new_line = None

        for patch_line in patch.splitlines():
            if patch_line.startswith("@@"):
                match = re.search(r"\+(\d+)", patch_line)
                new_line = int(match.group(1)) if match else None
                continue

            if patch_line.startswith("+++"):
                continue

            if patch_line.startswith("+"):
                if new_line is not None:
                    added_lines.setdefault(filename, set()).add(new_line)
                    new_line += 1

            elif patch_line.startswith(" "):
                if new_line is not None:
                    new_line += 1

            # Removed lines do not advance the new-file line number.

    comments_url = (
        f"{base_url}/pulls/{pr_number}/comments?per_page=100"
    )
    _, existing_comments = github_request(comments_url, token)

    marker_prefix = "<!-- ai-code-review-agent-inline:"
    existing_by_marker = {}

    for comment in existing_comments:
        body = comment.get("body", "")
        start = body.find(marker_prefix)
        if start != -1:
            end = body.find("-->", start)
            if end != -1:
                marker = body[start:end + 3]
                existing_by_marker[marker] = comment

    posted = 0
    updated = 0
    skipped = []

    for finding in findings:
        filename = finding["filename"]
        line = finding["line"]
        rule = finding["rule"]

        # GitHub inline comments must target an added line in this diff.
        if line not in added_lines.get(filename, set()):
            skipped.append({
                "filename": filename,
                "line": line,
                "rule": rule,
                "reason": "Line is not added in the current PR diff"
            })
            continue

        marker = f"{marker_prefix}{rule}:{filename}:{line} -->"

        body = (
            f"{marker}\n"
            f"**[{finding['severity']}] {rule}**\n\n"
            f"{finding['message']}\n\n"
            "_Automated finding. Verify the context before changing code._"
        )

        existing = existing_by_marker.get(marker)

        try:
            if existing:
                url = f"{base_url}/pulls/comments/{existing['id']}"
                github_request(
                    url, token, method="PATCH",
                    payload={"body": body}
                )
                updated += 1
            else:
                url = f"{base_url}/pulls/{pr_number}/comments"
                payload = {
                    "body": body,
                    "path": filename,
                    "line": line,
                    "side": "RIGHT"
                }
                github_request(
                    url, token, method="POST", payload=payload
                )
                posted += 1

        except urllib.error.HTTPError as error:
            print(
                f"Inline comment rejected for {filename}:{line}; "
                f"GitHub HTTP {error.code}"
            )
            skipped.append({
                "filename": filename,
                "line": line,
                "rule": rule,
                "http_status": error.code
            })

    return {
        "inline_comments_posted": posted,
        "inline_comments_updated": updated,
        "inline_comments_skipped": skipped
    }


def lambda_handler(event, context):
    secret = os.environ.get("GITHUB_WEBHOOK_SECRET")
    if not secret:
        return response(500, {"error": "Webhook secret is not configured"})

    headers = {
        key.lower(): value
        for key, value in (event.get("headers") or {}).items()
    }

    signature = headers.get("x-hub-signature-256")
    if not signature:
        return response(401, {"error": "Missing GitHub signature"})

    body = event.get("body") or ""

    try:
        if event.get("isBase64Encoded"):
            body = base64.b64decode(body)
        if isinstance(body, str):
            body = body.encode("utf-8")
    except (ValueError, TypeError):
        return response(400, {"error": "Invalid request body"})

    expected = "sha256=" + hmac.new(
        secret.encode("utf-8"), body, hashlib.sha256
    ).hexdigest()

    if not hmac.compare_digest(expected, signature):
        return response(401, {"error": "Invalid GitHub signature"})

    try:
        payload = json.loads(body)
    except (json.JSONDecodeError, UnicodeDecodeError):
        return response(400, {"error": "Invalid JSON payload"})

    event_type = headers.get("x-github-event", "unknown")
    action = payload.get("action")

    if event_type != "pull_request" or action not in (
        "opened", "synchronize", "reopened"
    ):
        return response(200, {
            "message": "Event received; no review requested",
            "event": event_type,
            "action": action
        })

    repository = payload.get("repository", {}).get("full_name")
    pr_number = payload.get("pull_request", {}).get("number")

    if not repository or not isinstance(pr_number, int):
        return response(400, {"error": "Missing repository or PR number"})

    try:
        token = get_github_token()
        files = get_changed_files(repository, pr_number, token)
        review = review_files(files)

        comment = format_review_comment(review, repository, pr_number)
        comment_status = publish_review_comment(
            repository, pr_number, token, comment
        )


        inline_result = publish_inline_comments(
            repository, pr_number, token, review["findings"]
        )


        return response(200, {
            "message": "Code review completed",
            "repository": repository,
            "pull_request_number": pr_number,
            "comment_status": comment_status,
            **review,
            **inline_result

        })

    except urllib.error.HTTPError as error:
        print(f"GitHub API returned HTTP {error.code}")
        return response(502, {
            "error": "Unable to complete GitHub review operation"
        })

    except urllib.error.URLError:
        print("Could not connect to GitHub API")
        return response(502, {"error": "Could not connect to GitHub"})

    except Exception as error:
        print(f"Review processing failed: {type(error).__name__}")
        return response(500, {"error": "Internal processing error"})

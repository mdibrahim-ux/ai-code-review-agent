
import base64
import hashlib
import hmac
import json
import os


def response(status_code, message):
    return {
        "statusCode": status_code,
        "headers": {"Content-Type": "application/json"},
        "body": json.dumps(message)
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

    if event.get("isBase64Encoded"):
        body = base64.b64decode(body)

    if isinstance(body, str):
        body = body.encode("utf-8")

    expected = "sha256=" + hmac.new(
        secret.encode("utf-8"),
        body,
        hashlib.sha256
    ).hexdigest()

    if not hmac.compare_digest(expected, signature):
        return response(401, {"error": "Invalid GitHub signature"})

    try:
        payload = json.loads(body)
    except (json.JSONDecodeError, UnicodeDecodeError):
        return response(400, {"error": "Invalid JSON payload"})

    event_type = headers.get("x-github-event", "unknown")
    repository = payload.get("repository", {}).get("full_name")
    pull_request = payload.get("pull_request", {})
    pr_number = pull_request.get("number") or payload.get("number")

    return response(200, {
        "message": "GitHub webhook received",
        "event": event_type,
        "repository": repository,
        "pull_request_number": pr_number,
        "action": payload.get("action")
    })

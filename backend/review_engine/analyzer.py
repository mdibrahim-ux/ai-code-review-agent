"""Deterministic review of added lines in GitHub pull-request patches."""
from __future__ import annotations

import re
from typing import Any

from .rules import RULES, SEVERITY_ORDER, is_test_file

_HUNK_HEADER = re.compile(
    r"^@@\s+-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s+@@"
)
_MAX_CONTEXT_LINE_CHARS = 2_000
_CONTEXT_RADIUS = 2


def _parse_patch(patch: str) -> list[dict[str, Any]]:
    """Parse unified diff records while preserving old/new line numbers and hunks."""
    lines: list[dict[str, Any]] = []
    old_line: int | None = None
    new_line: int | None = None
    hunk_id = -1

    for raw in patch.splitlines():
        if raw.startswith("@@"):
            match = _HUNK_HEADER.match(raw)
            if not match:
                old_line = None
                new_line = None
                continue
            hunk_id += 1
            old_line = int(match.group(1))
            new_line = int(match.group(3))
            continue

        if raw.startswith(("+++", "---", "\\")):
            continue

        if raw.startswith("+"):
            if new_line is None or hunk_id < 0:
                continue
            lines.append({
                "type": "add",
                "old_line": None,
                "new_line": new_line,
                "code": raw[1:],
                "hunk_id": hunk_id,
            })
            new_line += 1
        elif raw.startswith("-"):
            if old_line is None or hunk_id < 0:
                continue
            lines.append({
                "type": "del",
                "old_line": old_line,
                "new_line": None,
                "code": raw[1:],
                "hunk_id": hunk_id,
            })
            old_line += 1
        elif raw.startswith(" "):
            if old_line is None or new_line is None or hunk_id < 0:
                continue
            lines.append({
                "type": "context",
                "old_line": old_line,
                "new_line": new_line,
                "code": raw[1:],
                "hunk_id": hunk_id,
            })
            old_line += 1
            new_line += 1

    return lines


def _diff_context(
    diff_lines: list[dict[str, Any]], focus_index: int
) -> list[dict[str, Any]]:
    """Return a small same-hunk window around a finding, with no invented lines."""
    focus = diff_lines[focus_index]
    hunk_id = focus["hunk_id"]
    start = max(0, focus_index - _CONTEXT_RADIUS)
    end = min(len(diff_lines), focus_index + _CONTEXT_RADIUS + 1)

    context: list[dict[str, Any]] = []
    for index in range(start, end):
        item = diff_lines[index]
        if item["hunk_id"] != hunk_id:
            continue
        context.append({
            "type": item["type"],
            "old_line": item["old_line"],
            "new_line": item["new_line"],
            "code": str(item["code"])[:_MAX_CONTEXT_LINE_CHARS],
            "focus": index == focus_index,
        })
    return context


def analyze_patch(filename: str, patch: str) -> list[dict[str, Any]]:
    """Analyze added lines with deterministic rules and retain their real diff context."""
    findings: list[dict[str, Any]] = []
    if is_test_file(filename):
        return findings

    diff_lines = _parse_patch(patch)
    for index, item in enumerate(diff_lines):
        if item["type"] != "add":
            continue

        code = str(item["code"])
        for rule in RULES:
            if rule["pattern"].search(code):
                findings.append({
                    "filename": filename,
                    "line": item["new_line"],
                    "rule": rule["id"],
                    "severity": rule["severity"],
                    "message": rule["message"],
                    "code": code[:_MAX_CONTEXT_LINE_CHARS],
                    "diff_context": _diff_context(diff_lines, index),
                })

    return findings


def review_files(files: list[dict[str, Any]]) -> dict[str, Any]:
    """Analyze file patches and sort findings by severity."""
    findings: list[dict[str, Any]] = []
    skipped_files: list[str] = []

    for file in files:
        filename = str(file.get("filename") or "unknown")
        patch = file.get("patch")

        if not isinstance(patch, str) or not patch:
            skipped_files.append(filename)
            continue

        findings.extend(analyze_patch(filename, patch))

    findings.sort(key=lambda item: (
        SEVERITY_ORDER.get(item.get("severity", "LOW"), 3),
        item.get("filename", ""),
        item.get("line", 0),
    ))

    return {
        "files_scanned": len(files) - len(skipped_files),
        "files_skipped": skipped_files,
        "finding_count": len(findings),
        "findings": findings,
    }

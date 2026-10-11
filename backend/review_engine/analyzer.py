
import re
from typing import Any

from .rules import RULES, SEVERITY_ORDER, is_test_file


def analyze_patch(filename: str, patch: str) -> list[dict[str, Any]]:
    """Analyze added lines in a GitHub diff using deterministic rules."""
    findings: list[dict[str, Any]] = []
    current_line: int | None = None
    skip_findings = is_test_file(filename)

    for line in patch.splitlines():
        if line.startswith("@@"):
            match = re.search(r"\+(\d+)", line)
            current_line = int(match.group(1)) if match else None
            continue

        if line.startswith(("+++", "---")):
            continue

        if line.startswith("+"):
            code = line[1:]

            if not skip_findings and current_line is not None:
                for rule in RULES:
                    if rule["pattern"].search(code):
                        findings.append({
                            "filename": filename,
                            "line": current_line,
                            "rule": rule["id"],
                            "severity": rule["severity"],
                            "message": rule["message"],
                        })

            if current_line is not None:
                current_line += 1

        elif line.startswith(" "):
            if current_line is not None:
                current_line += 1

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

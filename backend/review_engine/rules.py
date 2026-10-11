
import re

RULES = [
    {
        "id": "hardcoded-secret",
        "severity": "HIGH",
        "pattern": re.compile(
            r"""(?i)\b(?:api[_-]?key|secret|password|access[_-]?token)\b"""
            r"""\s*[:=]\s*["'][^"']{8,}["']"""
        ),
        "message": "Possible hardcoded credential. Use a secure secret store.",
    },
    {
        "id": "unsafe-eval",
        "severity": "HIGH",
        "pattern": re.compile(r"\beval\s*\("),
        "message": "Dynamic code execution can be unsafe. Avoid it when possible.",
    },
    {
        "id": "broad-exception",
        "severity": "LOW",
        "pattern": re.compile(r"^\s*except\s+Exception\s*[:,]"),
        "message": "Broad exception handling may hide unexpected errors.",
    },
    {
        "id": "debug-print",
        "severity": "LOW",
        "pattern": re.compile(r"(?<!\w)print\s*\("),
        "message": "Debug output may expose sensitive information in logs.",
    },
]

SEVERITY_ORDER = {
    "HIGH": 0,
    "MEDIUM": 1,
    "LOW": 2,
}


def is_test_file(filename: str) -> bool:
    """Identify common test paths."""
    path = filename.replace("\\", "/").lower()

    return (
        path.startswith("tests/")
        or "/tests/" in path
        or path.startswith("test_")
        or "/test_" in path
        or path.endswith("_test.py")
    )

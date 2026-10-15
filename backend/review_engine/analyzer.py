"""Deterministic, AST-aware analysis of changed Python lines in GitHub diffs."""
from __future__ import annotations

import ast
import re
from typing import Any

from .rules import RULES, SEVERITY_ORDER, is_test_file

_HUNK_HEADER = re.compile(
    r"^@@\s+-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s+@@"
)
_MAX_CONTEXT_LINE_CHARS = 2_000
_CONTEXT_RADIUS = 2

_AST_HANDLED_RULES = {"unsafe-eval", "debug-print"}
_AST_RULE_MESSAGES = {
    "unsafe-eval": (
        "HIGH",
        "Dynamic code execution can be unsafe. Avoid eval(), "
        "including qualified calls.",
    ),
    "debug-print": (
        "LOW",
        "Debug print output can clutter logs or expose sensitive values. "
        "Use structured logging where appropriate.",
    ),
    "unsafe-exec": (
        "HIGH",
        "exec() executes dynamically supplied Python code. Avoid it for untrusted input.",
    ),
    "subprocess-shell-true": (
        "HIGH",
        "shell=True invokes a command shell and can enable command injection. "
        "Prefer argument lists without a shell.",
    ),
    "unsafe-deserialization": (
        "HIGH",
        "pickle/dill deserialization can execute code. Do not deserialize untrusted data.",
    ),
    "unsafe-yaml-load": (
        "HIGH",
        "yaml.load() without a safe loader can construct unsafe objects. "
        "Use yaml.safe_load() or SafeLoader.",
    ),
    "sql-string-interpolation": (
        "HIGH",
        "SQL text is interpolated or concatenated directly in execute(). "
        "Use parameterized queries.",
    ),
}
_SUBPROCESS_CALLS = {"run", "Popen", "call", "check_call", "check_output"}
_SAFE_YAML_LOADERS = {"SafeLoader", "CSafeLoader"}


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


def _dotted_name(node: ast.AST) -> str:
    """Resolve a simple dotted callable name without guessing imported aliases."""
    if isinstance(node, ast.Name):
        return node.id
    if isinstance(node, ast.Attribute):
        parent = _dotted_name(node.value)
        return f"{parent}.{node.attr}" if parent else node.attr
    return ""


def _has_dynamic_sql_argument(node: ast.AST) -> bool:
    """Detect direct f-string or variable/string concatenation in SQL execute calls."""
    if isinstance(node, ast.JoinedStr):
        return any(isinstance(value, ast.FormattedValue) for value in node.values)
    if isinstance(node, ast.BinOp) and isinstance(node.op, ast.Add):
        left_is_literal = isinstance(node.left, ast.Constant) and isinstance(node.left.value, str)
        right_is_literal = (
            isinstance(node.right, ast.Constant)
            and isinstance(node.right.value, str)
        )
        return not (left_is_literal and right_is_literal)
    return False


def _ast_call_rules(node: ast.Call) -> list[tuple[str, ast.AST]]:
    """Return supported structural findings and the AST node best suited for highlighting."""
    func_name = _dotted_name(node.func)
    simple_name = func_name.rsplit(".", 1)[-1]
    matches: list[tuple[str, ast.AST]] = []

    if simple_name == "eval":
        matches.append(("unsafe-eval", node))
    elif simple_name == "exec":
        matches.append(("unsafe-exec", node))
    elif simple_name == "print":
        matches.append(("debug-print", node))

    if (
        func_name.startswith("subprocess.")
        and simple_name in _SUBPROCESS_CALLS
    ):
        shell_keyword = next(
            (
                keyword for keyword in node.keywords
                if keyword.arg == "shell"
                and isinstance(keyword.value, ast.Constant)
                and keyword.value.value is True
            ),
            None,
        )
        if shell_keyword is not None:
            matches.append(("subprocess-shell-true", shell_keyword))

    module_name = func_name.rsplit(".", 1)[0] if "." in func_name else ""
    if module_name in {"pickle", "dill"} and simple_name in {"load", "loads"}:
        matches.append(("unsafe-deserialization", node))

    if func_name == "yaml.load":
        loader = next((kw.value for kw in node.keywords if kw.arg == "Loader"), None)
        loader_name = _dotted_name(loader) if loader is not None else ""
        if loader_name.rsplit(".", 1)[-1] not in _SAFE_YAML_LOADERS:
            matches.append(("unsafe-yaml-load", node))

    if simple_name in {"execute", "executemany"} and node.args:
        if _has_dynamic_sql_argument(node.args[0]):
            matches.append(("sql-string-interpolation", node.args[0]))

    return matches


def _scan_ast_tree(
    tree: ast.AST,
    records_by_source_line: dict[int, dict[str, Any]],
    line_offset: int,
    filename: str,
    diff_lines: list[dict[str, Any]],
    diff_index_by_id: dict[int, int],
) -> list[dict[str, Any]]:
    findings: list[dict[str, Any]] = []

    for node in ast.walk(tree):
        if not isinstance(node, ast.Call):
            continue

        start_line = max(1, int(getattr(node, "lineno", 1)) - line_offset)
        end_line = max(
            start_line,
            int(getattr(node, "end_lineno", getattr(node, "lineno", 1))) - line_offset,
        )
        changed_records = [
            (source_line, record)
            for source_line, record in records_by_source_line.items()
            if record.get("type") == "add" and start_line <= source_line <= end_line
        ]
        if not changed_records:
            continue

        for rule_id, focus_node in _ast_call_rules(node):
            severity, message = _AST_RULE_MESSAGES[rule_id]
            focus_source_line = max(
                1,
                int(getattr(focus_node, "lineno", getattr(node, "lineno", 1))) - line_offset,
            )
            focus_record = records_by_source_line.get(focus_source_line)
            if focus_record is None or focus_record.get("type") != "add":
                focus_source_line, focus_record = changed_records[0]

            global_index = diff_index_by_id.get(id(focus_record))
            if global_index is None:
                continue

            findings.append({
                "filename": filename,
                "line": focus_record["new_line"],
                "rule": rule_id,
                "severity": severity,
                "message": message,
                "code": str(focus_record["code"])[:_MAX_CONTEXT_LINE_CHARS],
                "diff_context": _diff_context(diff_lines, global_index),
                "analysis_method": "AST",
            })

    return findings


def _ast_findings(
    filename: str,
    diff_lines: list[dict[str, Any]],
    source_text: str | None = None,
) -> list[dict[str, Any]]:
    """Analyze complete changed Python files when supplied; otherwise parse diff hunks."""
    if not filename.lower().endswith(".py"):
        return []

    diff_index_by_id = {id(record): index for index, record in enumerate(diff_lines)}

    # Full source resolves multi-line calls and syntax context across distant hunks.
    # Findings are still limited to call expressions that overlap an added PR line.
    if isinstance(source_text, str) and source_text:
        try:
            full_tree = ast.parse(source_text)
        except (SyntaxError, ValueError, RecursionError):
            full_tree = None
        if full_tree is not None:
            added_records_by_line = {
                int(record["new_line"]): record
                for record in diff_lines
                if record.get("type") == "add" and record.get("new_line") is not None
            }
            return _scan_ast_tree(
                full_tree,
                added_records_by_line,
                0,
                filename,
                diff_lines,
                diff_index_by_id,
            )

    by_hunk: dict[int, list[dict[str, Any]]] = {}
    for record in diff_lines:
        by_hunk.setdefault(int(record["hunk_id"]), []).append(record)

    diff_index_by_id = {id(record): index for index, record in enumerate(diff_lines)}
    findings: list[dict[str, Any]] = []

    for records in by_hunk.values():
        source_records = [record for record in records if record["type"] != "del"]
        if not source_records:
            continue

        source_lines = [str(record["code"]) for record in source_records]
        nonblank = [line for line in source_lines if line.strip()]
        indent = min(
            (len(line) - len(line.lstrip()) for line in nonblank),
            default=0,
        )
        dedented_lines = [
            line[indent:] if line.strip() else ""
            for line in source_lines
        ]
        source_by_line = {
            index: record
            for index, record in enumerate(source_records, start=1)
        }

        # A synthetic async function lets common patch fragments containing
        # return/await and nested statements parse without needing the full file.
        wrapped = "async def __sentinel_diff_fragment__():\n" + "\n".join(
            "    " + line if line else ""
            for line in dedented_lines
        )
        try:
            tree = ast.parse(wrapped)
        except (SyntaxError, ValueError, RecursionError):
            tree = None

        if tree is not None:
            findings.extend(_scan_ast_tree(
                tree,
                source_by_line,
                1,  # AST line 2 is source-fragment line 1.
                filename,
                diff_lines,
                diff_index_by_id,
            ))
            continue

        # Incomplete hunks are normal in GitHub diffs. Analyze each valid added
        # line as a standalone Python fragment; comments/string contents stay inert.
        for record in source_records:
            if record["type"] != "add":
                continue
            fragment = str(record["code"]).strip()
            if not fragment:
                continue
            try:
                tree = ast.parse(fragment)
            except (SyntaxError, ValueError, RecursionError):
                continue
            findings.extend(_scan_ast_tree(
                tree,
                {1: record},
                0,
                filename,
                diff_lines,
                diff_index_by_id,
            ))

    return findings


def analyze_patch(
    filename: str, patch: str, source_text: str | None = None
) -> list[dict[str, Any]]:
    """Analyze changed lines with deterministic patterns and AST-aware Python checks."""
    findings: list[dict[str, Any]] = []
    if is_test_file(filename):
        return findings

    diff_lines = _parse_patch(patch)
    for index, item in enumerate(diff_lines):
        if item["type"] != "add":
            continue

        code = str(item["code"])
        for rule in RULES:
            if rule["id"] in _AST_HANDLED_RULES:
                continue
            if rule["pattern"].search(code):
                findings.append({
                    "filename": filename,
                    "line": item["new_line"],
                    "rule": rule["id"],
                    "severity": rule["severity"],
                    "message": rule["message"],
                    "code": code[:_MAX_CONTEXT_LINE_CHARS],
                    "diff_context": _diff_context(diff_lines, index),
                    "analysis_method": "pattern",
                })

    findings.extend(_ast_findings(filename, diff_lines, source_text=source_text))

    # A rule and line pair may be found by both the pattern and AST passes.
    unique: dict[tuple[str, int, str], dict[str, Any]] = {}
    for finding in findings:
        key = (
            str(finding["filename"]),
            int(finding["line"]),
            str(finding["rule"]),
        )
        existing = unique.get(key)
        if existing is None or finding.get("analysis_method") == "AST":
            unique[key] = finding

    ordered = list(unique.values())
    ordered.sort(key=lambda item: (
        SEVERITY_ORDER.get(item.get("severity", "LOW"), 3),
        item.get("filename", ""),
        item.get("line", 0),
        item.get("rule", ""),
    ))
    return ordered


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

        source_text = file.get("source_text")
        if not isinstance(source_text, str):
            source_text = None
        findings.extend(analyze_patch(filename, patch, source_text=source_text))

    findings.sort(key=lambda item: (
        SEVERITY_ORDER.get(item.get("severity", "LOW"), 3),
        item.get("filename", ""),
        item.get("line", 0),
        item.get("rule", ""),
    ))

    return {
        "files_scanned": len(files) - len(skipped_files),
        "files_skipped": skipped_files,
        "finding_count": len(findings),
        "findings": findings,
    }

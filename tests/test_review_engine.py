
import unittest

from backend.review_engine.analyzer import analyze_patch, review_files


class ReviewEngineTests(unittest.TestCase):

    def test_detects_expected_findings(self):
        files = [{
            "filename": "app.py",
            "patch": (
                "@@ -0,0 +1,6 @@\n"
                '+api_key = "my_secret_key_123"\n'
                '+result = eval(user_input)\n'
                "+try:\n"
                "+    pass\n"
                "+except Exception:\n"
                "+    pass\n"
            ),
        }]

        result = review_files(files)

        self.assertEqual(result["files_scanned"], 1)
        self.assertEqual(result["finding_count"], 3)

        rules = {finding["rule"] for finding in result["findings"]}
        self.assertEqual(
            rules,
            {"hardcoded-secret", "unsafe-eval", "broad-exception"},
        )

    def test_detects_debug_print(self):
        findings = analyze_patch(
            "app.py",
            '@@ -0,0 +1,1 @@\n+print("debug message")\n',
        )

        self.assertEqual(len(findings), 1)
        self.assertEqual(findings[0]["rule"], "debug-print")
        self.assertEqual(findings[0]["severity"], "LOW")
        self.assertEqual(findings[0]["line"], 1)

    def test_finding_includes_real_patch_context_with_line_numbers(self):
        findings = analyze_patch(
            "app.py",
            (
                "@@ -10,3 +10,4 @@\n"
                " context_before = 1\n"
                "-result = safe_call(user_input)\n"
                "+result = eval(user_input)\n"
                " context_after = 2\n"
            ),
        )

        self.assertEqual(len(findings), 1)
        finding = findings[0]
        self.assertEqual(finding["line"], 11)
        self.assertEqual(finding["code"], "result = eval(user_input)")
        self.assertEqual(
            [
                (
                    line["type"],
                    line["old_line"],
                    line["new_line"],
                    line["code"],
                    line["focus"],
                )
                for line in finding["diff_context"]
            ],
            [
                ("context", 10, 10, "context_before = 1", False),
                ("del", 11, None, "result = safe_call(user_input)", False),
                ("add", None, 11, "result = eval(user_input)", True),
                ("context", 12, 12, "context_after = 2", False),
            ],
        )

    def test_diff_context_does_not_cross_hunk_boundaries(self):
        findings = analyze_patch(
            "app.py",
            (
                "@@ -1,1 +1,1 @@\n"
                "+result = eval(user_input)\n"
                "@@ -100,1 +100,1 @@\n"
                " far_away = True\n"
            ),
        )

        self.assertEqual(len(findings), 1)
        self.assertEqual(
            [(item["type"], item["new_line"]) for item in findings[0]["diff_context"]],
            [("add", 1)],
        )

    def test_ast_detects_subprocess_shell_true_with_multiline_call(self):
        findings = analyze_patch(
            "runner.py",
            (
                "@@ -1,1 +1,6 @@\n"
                " import subprocess\n"
                "+def run_command(command):\n"
                "+    return subprocess.run(\n"
                "+        command,\n"
                "+        shell=True,\n"
                "+    )\n"
            ),
        )

        matches = [item for item in findings if item["rule"] == "subprocess-shell-true"]
        self.assertEqual(len(matches), 1)
        self.assertEqual(matches[0]["severity"], "HIGH")
        self.assertEqual(matches[0]["line"], 5)
        self.assertEqual(matches[0]["analysis_method"], "AST")
        self.assertTrue(any(line["focus"] for line in matches[0]["diff_context"]))

    def test_ast_ignores_eval_text_in_comments_and_strings(self):
        findings = analyze_patch(
            "example.py",
            (
                "@@ -1,1 +1,3 @@\n"
                '+message = "eval(user_input)"\n'
                "+# eval(user_input)\n"
                "+result = builtins.eval(user_input)\n"
            ),
        )

        matches = [item for item in findings if item["rule"] == "unsafe-eval"]
        self.assertEqual(len(matches), 1)
        self.assertEqual(matches[0]["line"], 3)
        self.assertEqual(matches[0]["analysis_method"], "AST")

    def test_ast_detects_unsafe_deserialization_and_exec(self):
        findings = analyze_patch(
            "loader.py",
            (
                "@@ -1,1 +1,3 @@\n"
                "+exec(user_code)\n"
                "+value = pickle.loads(payload)\n"
                "+yaml.load(document)\n"
            ),
        )

        detected = {(item["rule"], item["line"]) for item in findings}
        self.assertIn(("unsafe-exec", 1), detected)
        self.assertIn(("unsafe-deserialization", 2), detected)
        self.assertIn(("unsafe-yaml-load", 3), detected)

    def test_ast_does_not_flag_yaml_safe_loader(self):
        findings = analyze_patch(
            "loader.py",
            (
                "@@ -1,1 +1,2 @@\n"
                "+value = yaml.load(document, Loader=yaml.SafeLoader)\n"
                "+safe_value = yaml.safe_load(document)\n"
            ),
        )

        self.assertNotIn("unsafe-yaml-load", {item["rule"] for item in findings})

    def test_ast_detects_direct_f_string_sql_interpolation(self):
        findings = analyze_patch(
            "database.py",
            (
                "@@ -1,1 +1,1 @@\n"
                '+cursor.execute(f"SELECT * FROM users WHERE name = {name}")\n'
            ),
        )

        matches = [item for item in findings if item["rule"] == "sql-string-interpolation"]
        self.assertEqual(len(matches), 1)
        self.assertEqual(matches[0]["severity"], "HIGH")
        self.assertEqual(matches[0]["line"], 1)

    def test_ignores_test_fixtures(self):
        findings = analyze_patch(
            "tests/test_example.py",
            (
                '@@ -0,0 +1,2 @@\n'
                '+api_key = "abc123456789secret"\n'
                '+result = eval("1 + 1")\n'
            ),
        )

        self.assertEqual(findings, [])

    def test_preserves_line_numbers_across_context(self):
        findings = analyze_patch(
            "app.py",
            (
                "@@ -10,3 +10,4 @@\n"
                " existing = 1\n"
                "+result = eval(user_input)\n"
                " another = 2\n"
                '+print("debug")\n'
            ),
        )

        self.assertEqual(
            [(item["rule"], item["line"]) for item in findings],
            [("unsafe-eval", 11), ("debug-print", 13)],
        )

    def test_skips_files_without_patch(self):
        result = review_files([
            {"filename": "image.png", "status": "added", "patch": ""}
        ])

        self.assertEqual(result["files_scanned"], 0)
        self.assertEqual(result["files_skipped"], ["image.png"])
        self.assertEqual(result["finding_count"], 0)

    def test_sorts_findings_by_severity(self):
        result = review_files([{
            "filename": "app.py",
            "patch": (
                "@@ -0,0 +1,3 @@\n"
                '+print("debug")\n'
                "+except Exception:\n"
                "+result = eval(user_input)\n"
            ),
        }])

        severities = [
            finding["severity"] for finding in result["findings"]
        ]

        self.assertEqual(severities, ["HIGH", "LOW", "LOW"])


if __name__ == "__main__":
    unittest.main()

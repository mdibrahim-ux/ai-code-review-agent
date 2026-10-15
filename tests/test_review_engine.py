
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
                "@@ -10,3 +10,4 @@\\n"
                " context_before = 1\\n"
                "-result = safe_call(user_input)\\n"
                "+result = eval(user_input)\\n"
                " context_after = 2\\n"
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
                "@@ -1,1 +1,1 @@\\n"
                "+result = eval(user_input)\\n"
                "@@ -100,1 +100,1 @@\\n"
                " far_away = True\\n"
            ),
        )

        self.assertEqual(len(findings), 1)
        self.assertEqual(
            [(item["type"], item["new_line"]) for item in findings[0]["diff_context"]],
            [("add", 1)],
        )

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

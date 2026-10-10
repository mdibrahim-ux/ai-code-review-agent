
from backend.lambda_function import review_files
import json

files = [
    {
        "filename": "app.py",
        "patch": '''@@ -0,0 +1,5 @@
+api_key = "my_secret_key_123"
+result = eval(user_input)
+try:
+    pass
+except Exception:
+    pass'''
    }
]

result = review_files(files)

print(json.dumps(result, indent=2))


import unittest

from backend.lambda_function import review_files


class ReviewEngineTests(unittest.TestCase):

    def test_ignores_intentional_test_fixtures(self):
        findings = review_files([
            {
                "filename": "test_example.py",
                "patch": (
                    "@@ -0,0 +1,2 @@\n"
                    '+api_key = "abc123456789secret"\n'
                    '+result = eval("1 + 1")\n'
                ),
            }
        ])
        self.assertEqual(findings["finding_count"], 0)

    def test_production_findings_are_preserved(self):
        findings = review_files([
            {
                "filename": "app.py",
                "patch": (
                    "@@ -0,0 +1,3 @@\n"
                    '+api_key = "abc123456789secret"\n'
                    '+result = eval("1 + 1")\n'
                    '+except Exception: pass\n'
                ),
            }
        ])
        self.assertEqual(findings["finding_count"], 3)

    def test_detects_expected_findings(self):
        files = [
            {
                "filename": "app.py",
                "patch": (
                    "@@ -0,0 +1,5 @@\n"
                    '+api_key = "abc123456789secret"\n'
                    '+result = eval("1 + 1")\n'
                    '+try:\n'
                    '+    pass\n'
                    '+except Exception:\n'
                    '+    pass\n'
                ),
            }
        ]

        result = review_files(files)

        self.assertEqual(result["files_scanned"], 1)
        self.assertEqual(result["finding_count"], 3)

        rules = {item["rule"] for item in result["findings"]}
        self.assertEqual(
            rules,
            {"hardcoded-secret", "unsafe-eval", "broad-exception"},
        )


if __name__ == "__main__":
    unittest.main()

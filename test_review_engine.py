
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

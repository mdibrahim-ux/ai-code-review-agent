[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$packageDir = Join-Path $env:TEMP "sentinel-dashboard-api-package"
$distDir = Join-Path $repoRoot "dist"
$zipPath = Join-Path $distDir "sentinel-dashboard-api-deployment-test.zip"
$sourceHandler = Join-Path $repoRoot "backend\dashboard_api\lambda_function.py"
$sourceEngine = Join-Path $repoRoot "backend\review_engine"
$packageEngine = Join-Path $packageDir "review_engine"
$pythonCommand = Get-Command python -ErrorAction Stop

if (-not (Test-Path -LiteralPath $sourceHandler -PathType Leaf)) {
    throw "Dashboard API handler not found: $sourceHandler"
}
foreach ($module in @("analyzer.py", "rules.py", "__init__.py")) {
    if (-not (Test-Path -LiteralPath (Join-Path $sourceEngine $module) -PathType Leaf)) {
        throw "Required review-engine module missing: $module"
    }
}

# This script only touches its private temp folder and its own ZIP artifact.
if (Test-Path -LiteralPath $packageDir) {
    Remove-Item -LiteralPath $packageDir -Recurse -Force
}
New-Item -ItemType Directory -Path $packageEngine -Force | Out-Null
New-Item -ItemType Directory -Path $distDir -Force | Out-Null

Copy-Item -LiteralPath $sourceHandler -Destination (Join-Path $packageDir "lambda_function.py") -Force
Get-ChildItem -LiteralPath $sourceEngine -Filter "*.py" -File |
    Copy-Item -Destination $packageEngine -Force

$zipSmokeCode = @'
import sys
import zipfile
from pathlib import PurePosixPath

path = sys.argv[1]
with zipfile.ZipFile(path) as archive:
    names = archive.namelist()
    name_set = set(names)
    assert archive.testzip() is None, "ZIP CRC failure"
    assert len(names) == len(name_set), "duplicate ZIP paths"
    required = {"lambda_function.py", "review_engine/__init__.py",
                "review_engine/analyzer.py", "review_engine/rules.py"}
    assert required <= name_set, f"missing files: {required - name_set}"
    for name in names:
        normalized = name.replace("\\", "/")
        parts = PurePosixPath(normalized).parts
        assert not normalized.startswith("/") and ".." not in parts, f"unsafe path: {name}"
        assert "__pycache__" not in parts and not normalized.endswith(".pyc"), f"cache entry: {name}"

sys.path.insert(0, path)
import lambda_function
from review_engine.analyzer import review_files
assert callable(lambda_function.lambda_handler)

event = {"version":"2.0","routeKey":"GET /health","rawPath":"/health",
         "headers":{"origin":"http://localhost:5500"},
         "requestContext":{"http":{"method":"GET","path":"/health"}}}
response = lambda_function.lambda_handler(event, None)
assert response["statusCode"] == 200, response
assert '"status": "ok"' in response["body"], response
review = review_files([{"filename":"app.py","patch":"@@ -0,0 +1,1 @@\n+result = eval(user_input)\n"}])
assert any(f.get("rule") == "unsafe-eval" for f in review["findings"]), review

shell_patch = (
    "@@ -1,1 +1,6 @@\n"
    " import subprocess\n"
    "+def run_command(command):\n"
    "+    return subprocess.run(\n"
    "+        command,\n"
    "+        shell=True,\n"
    "+    )\n"
)
shell_result = review_files([{"filename": "runner.py", "patch": shell_patch}])
assert any(
    f.get("rule") == "subprocess-shell-true" and f.get("line") == 5
    for f in shell_result["findings"]
), shell_result

print("AST structural regression test passed.")
print("Dashboard API ZIP integrity and runtime smoke tests passed.")
'@

if (Test-Path -LiteralPath $zipPath) {
    Remove-Item -LiteralPath $zipPath -Force
}
Compress-Archive -Path (Join-Path $packageDir "*") -DestinationPath $zipPath -CompressionLevel Optimal -Force
if (-not (Test-Path -LiteralPath $zipPath -PathType Leaf) -or (Get-Item -LiteralPath $zipPath).Length -le 0) {
    throw "Dashboard API deployment ZIP was not produced."
}
& $pythonCommand.Source -c $zipSmokeCode $zipPath
if ($LASTEXITCODE -ne 0) {
    throw "Dashboard API ZIP validation failed."
}
Write-Host "Dashboard API package validated: $zipPath"
Write-Host ("Size: {0:N0} bytes" -f (Get-Item -LiteralPath $zipPath).Length)
Write-Host "This script does not deploy or modify AWS resources."

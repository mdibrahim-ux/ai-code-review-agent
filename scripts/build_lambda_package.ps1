
[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# ============================================================
# Configuration
# ============================================================

$repoRoot = Split-Path -Parent $PSScriptRoot
$packageDir = Join-Path $env:TEMP "code-review-agent-lambda-package"
$zipDir = Join-Path $repoRoot "dist"
$zipPath = Join-Path $zipDir "code-review-agent-deployment-test.zip"

$sourceHandler = Join-Path $repoRoot "backend\lambda_function.py"
$sourceEngine = Join-Path $repoRoot "backend\review_engine"
$packageEngine = Join-Path $packageDir "review_engine"

$zipPath = [System.IO.Path]::GetFullPath($zipPath)
$envVariableName = "CODE_REVIEW_AGENT_PACKAGE_ZIP"

Write-Host ""
Write-Host "============================================================"
Write-Host " AI Code Review Agent - Lambda Package Validation"
Write-Host "============================================================"
Write-Host "Repository: $repoRoot"
Write-Host "Output ZIP: $zipPath"
Write-Host ""

# ============================================================
# 1. Validate the environment and source files
# ============================================================

if (-not (Test-Path -LiteralPath $sourceHandler -PathType Leaf)) {
    throw "Lambda handler not found: $sourceHandler"
}

if (-not (Test-Path -LiteralPath $sourceEngine -PathType Container)) {
    throw "Review engine directory not found: $sourceEngine"
}

$requiredSourceFiles = @(
    (Join-Path $sourceEngine "analyzer.py"),
    (Join-Path $sourceEngine "rules.py")
)

foreach ($sourceFile in $requiredSourceFiles) {
    if (-not (Test-Path -LiteralPath $sourceFile -PathType Leaf)) {
        throw "Required review-engine module not found: $sourceFile"
    }
}

$engineFiles = @(
    Get-ChildItem -LiteralPath $sourceEngine -Filter "*.py" -File |
        Sort-Object Name
)

if ($engineFiles.Count -eq 0) {
    throw "No Python modules were found in the review-engine directory."
}

# Confirm Python is available before performing any build steps.
$pythonCommand = Get-Command python -ErrorAction Stop

$pythonVersionOutput = & $pythonCommand.Source --version 2>&1
if ($LASTEXITCODE -ne 0) {
    throw "Unable to run Python. Install Python 3.13 and ensure it is on PATH."
}

Write-Host "Python: $pythonVersionOutput"
Write-Host "Review-engine modules found: $($engineFiles.Count)"

# ============================================================
# 2. Prepare a clean package directory
# ============================================================

# Only the dedicated temporary package directory is removed.
# Existing source files and unrelated dist artifacts are preserved.

if (Test-Path -LiteralPath $packageDir) {
    Remove-Item -LiteralPath $packageDir -Recurse -Force
}

New-Item -ItemType Directory -Path $packageDir -Force |
    Out-Null

New-Item -ItemType Directory -Path $packageEngine -Force |
    Out-Null

New-Item -ItemType Directory -Path $zipDir -Force |
    Out-Null

# ============================================================
# 3. Copy the Lambda handler and review-engine modules
# ============================================================

Copy-Item `
    -LiteralPath $sourceHandler `
    -Destination (Join-Path $packageDir "lambda_function.py") `
    -Force

foreach ($engineFile in $engineFiles) {
    Copy-Item `
        -LiteralPath $engineFile.FullName `
        -Destination $packageEngine `
        -Force
}

$packagedHandler = Join-Path $packageDir "lambda_function.py"

if (-not (Test-Path -LiteralPath $packagedHandler -PathType Leaf)) {
    throw "The Lambda handler was not copied into the package directory."
}

foreach ($engineFile in $engineFiles) {
    $copiedModule = Join-Path $packageEngine $engineFile.Name

    if (-not (Test-Path -LiteralPath $copiedModule -PathType Leaf)) {
        throw "Review-engine module was not copied: $($engineFile.Name)"
    }
}

Write-Host ""
Write-Host "[1/5] Source files validated and copied."

# ============================================================
# 4. Adapt the handler import for Lambda's ZIP layout
# ============================================================

# In the repository, the handler uses a relative import.
# In the deployment ZIP, lambda_function.py and review_engine/
# are at the same directory level, so the import must be absolute.

$handlerContent = [System.IO.File]::ReadAllText($packagedHandler)

$relativeImport = "from .review_engine.analyzer import review_files"
$absoluteImport = "from review_engine.analyzer import review_files"

if ($handlerContent.Contains($relativeImport)) {
    $handlerContent = $handlerContent.Replace(
        $relativeImport,
        $absoluteImport
    )

    [System.IO.File]::WriteAllText(
        $packagedHandler,
        $handlerContent,
        [System.Text.UTF8Encoding]::new($false)
    )

    Write-Host "Adapted review-engine import for the Lambda ZIP."
}
elseif ($handlerContent.Contains($absoluteImport)) {
    # The import is already compatible with the ZIP layout.
    Write-Host "Review-engine import already uses the ZIP-compatible form."
}
else {
    throw @"
The expected review-engine import was not found in the Lambda handler.

Expected either:
  $relativeImport
or:
  $absoluteImport

No deployment ZIP will be produced. Review the handler import before retrying.
"@
}

# Check that the packaged handler does not retain the relative import.
$handlerContent = [System.IO.File]::ReadAllText($packagedHandler)

if ($handlerContent.Contains($relativeImport)) {
    throw "Relative review-engine import remains in the packaged handler."
}

Write-Host "[2/5] Lambda import layout validated."

# ============================================================
# 5. Remove Python cache files and build the ZIP
# ============================================================

# The package is rebuilt from source each time.
# Do not include bytecode or interpreter cache directories.

$cacheDirectories = @(
    Get-ChildItem `
        -LiteralPath $packageDir `
        -Directory `
        -Recurse `
        -Filter "__pycache__"
)

foreach ($cacheDirectory in $cacheDirectories) {
    Remove-Item `
        -LiteralPath $cacheDirectory.FullName `
        -Recurse `
        -Force
}

$bytecodeFiles = @(
    Get-ChildItem `
        -LiteralPath $packageDir `
        -File `
        -Recurse `
        -Filter "*.pyc"
)

foreach ($bytecodeFile in $bytecodeFiles) {
    Remove-Item -LiteralPath $bytecodeFile.FullName -Force
}

# Delete only this script's previous output ZIP.
if (Test-Path -LiteralPath $zipPath) {
    Remove-Item -LiteralPath $zipPath -Force
}

$packageContents = Join-Path $packageDir "*"

Compress-Archive `
    -Path $packageContents `
    -DestinationPath $zipPath `
    -CompressionLevel Optimal `
    -Force

if (-not (Test-Path -LiteralPath $zipPath -PathType Leaf)) {
    throw "The ZIP archive was not created."
}

$zipFile = Get-Item -LiteralPath $zipPath

if ($zipFile.Length -le 0) {
    throw "The generated ZIP archive is empty."
}

Write-Host "[3/5] Deployment-test ZIP created."

# ============================================================
# 6. Validate the ZIP structure and integrity
# ============================================================

# Pass the path using a process environment variable.
# This avoids PowerShell quoting problems with paths containing
# spaces, backslashes, or other special characters.
#
# Python reads its validation code from standard input, so the
# code itself does not require shell-string interpolation.

$previousZipEnvironmentValue = [System.Environment]::GetEnvironmentVariable(
    $envVariableName,
    [System.EnvironmentVariableTarget]::Process
)

try {
    [System.Environment]::SetEnvironmentVariable(
        $envVariableName,
        $zipPath,
        [System.EnvironmentVariableTarget]::Process
    )

    $zipVerificationCode = @'
import os
import sys
import zipfile
from pathlib import PurePosixPath

zip_path = os.environ.get("CODE_REVIEW_AGENT_PACKAGE_ZIP")

if not zip_path:
    raise SystemExit("ERROR: ZIP path environment variable is missing.")

if not os.path.isfile(zip_path):
    raise SystemExit(f"ERROR: ZIP archive not found: {zip_path}")

with zipfile.ZipFile(zip_path, "r") as archive:
    members = archive.namelist()
    member_set = set(members)

    if not members:
        raise SystemExit("ERROR: ZIP archive contains no files.")

    if len(members) != len(member_set):
        raise SystemExit("ERROR: ZIP archive contains duplicate entries.")

    corrupt_member = archive.testzip()
    if corrupt_member is not None:
        raise SystemExit(
            f"ERROR: ZIP CRC/integrity validation failed: {corrupt_member}"
        )

    required_files = {
        "lambda_function.py",
        "review_engine/analyzer.py",
        "review_engine/rules.py",
    }

    missing_files = sorted(required_files - member_set)
    if missing_files:
        raise SystemExit(
            "ERROR: Missing required ZIP entries: "
            + ", ".join(missing_files)
        )

    unsafe_paths = []
    cache_entries = []

    for member in members:
        normalized = member.replace("\\", "/")
        path_parts = PurePosixPath(normalized).parts

        if normalized.startswith("/") or ".." in path_parts:
            unsafe_paths.append(member)

        if "__pycache__" in path_parts or normalized.endswith(".pyc"):
            cache_entries.append(member)

    if unsafe_paths:
        raise SystemExit(
            "ERROR: ZIP contains unsafe paths: "
            + ", ".join(unsafe_paths)
        )

    if cache_entries:
        raise SystemExit(
            "ERROR: ZIP contains Python cache files: "
            + ", ".join(cache_entries)
        )

print("ZIP integrity check passed.")
print("Required Lambda and review-engine files are present.")
print("No duplicate paths or unsafe archive paths found.")
print("No Python cache files found in the ZIP.")
'@

    $zipVerificationCode | & $pythonCommand.Source -

    if ($LASTEXITCODE -ne 0) {
        throw "ZIP integrity and layout verification failed."
    }

    Write-Host "[4/5] ZIP structure and integrity validated."

    # ========================================================
    # 7. Smoke-test the actual ZIP archive
    # ========================================================

    # Import directly from the generated ZIP rather than testing
    # only the temporary directory. This confirms that the handler
    # and review-engine modules can be imported from the artifact.

    $zipSmokeTestCode = @'
import os
import sys
from pathlib import Path

zip_path = Path(os.environ["CODE_REVIEW_AGENT_PACKAGE_ZIP"])

if not zip_path.is_file():
    raise SystemExit(f"ERROR: ZIP archive not found: {zip_path}")

# Give the ZIP priority so Python imports the packaged modules.
sys.path.insert(0, str(zip_path))

import lambda_function
from review_engine.analyzer import review_files

# Ensure the handler and analyzer were actually imported from the ZIP.
zip_prefix = os.path.normcase(str(zip_path))

for module in (lambda_function, sys.modules["review_engine.analyzer"]):
    module_path = os.path.normcase(str(module.__file__))

    if not module_path.startswith(zip_prefix):
        raise SystemExit(
            "ERROR: Module was not loaded from the deployment ZIP: "
            + module_path
        )

if not callable(lambda_function.lambda_handler):
    raise SystemExit("ERROR: Lambda handler is missing or not callable.")

# Verify that the packaged analyzer still detects unsafe eval usage.
test_patch = (
    "@@ -0,0 +1,1 @@\n"
    "+result = eval(user_input)\n"
)

result = review_files([
    {
        "filename": "app.py",
        "patch": test_patch,
    }
])

if not isinstance(result, dict):
    raise SystemExit("ERROR: Review engine returned an unexpected result.")

if result.get("finding_count", 0) < 1:
    raise SystemExit("ERROR: Expected unsafe-eval finding was not detected.")

findings = result.get("findings", [])

if not any(
    finding.get("rule") == "unsafe-eval"
    for finding in findings
):
    raise SystemExit("ERROR: The unsafe-eval rule was not found in the results.")

# Verify AST-aware subprocess analysis from the actual ZIP artifact.
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
if not any(
    finding.get("rule") == "subprocess-shell-true"
    and finding.get("line") == 5
    for finding in shell_result.get("findings", [])
):
    raise SystemExit("ERROR: AST subprocess-shell-true regression check failed.")

print("AST structural regression test passed.")
print("ZIP runtime smoke test passed.")
print("Lambda handler imported successfully from the ZIP.")
print("Review engine detected the unsafe-eval regression case.")
'@

    $zipSmokeTestCode | & $pythonCommand.Source -

    if ($LASTEXITCODE -ne 0) {
        throw "ZIP runtime smoke test failed."
    }

    Write-Host "[5/5] ZIP runtime smoke test passed."
}
finally {
    # Restore the caller's environment exactly as it was.
    [System.Environment]::SetEnvironmentVariable(
        $envVariableName,
        $previousZipEnvironmentValue,
        [System.EnvironmentVariableTarget]::Process
    )
}

# ============================================================
# 8. Final summary
# ============================================================

$finalZip = Get-Item -LiteralPath $zipPath

Write-Host ""
Write-Host "============================================================"
Write-Host " PACKAGE VALIDATION SUCCEEDED"
Write-Host "============================================================"
Write-Host "Artifact: $($finalZip.FullName)"
Write-Host ("Size: {0:N0} bytes" -f $finalZip.Length)
Write-Host ""
Write-Host "Completed checks:"
Write-Host "  1. Source and required module validation"
Write-Host "  2. Lambda-compatible import layout"
Write-Host "  3. ZIP creation"
Write-Host "  4. ZIP integrity and layout validation"
Write-Host "  5. Runtime smoke test against the actual ZIP"
Write-Host ""
Write-Host "This script creates a test artifact only."
Write-Host "No AWS resources are created or modified."
Write-Host ""

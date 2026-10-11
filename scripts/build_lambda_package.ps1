$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$packageDir = Join-Path $env:TEMP "code-review-agent-lambda-package"
$zipDir = Join-Path $repoRoot "dist"
$zipPath = Join-Path $zipDir "code-review-agent-deployment-test.zip"

$sourceHandler = Join-Path $repoRoot "backend\lambda_function.py"
$sourceEngine = Join-Path $repoRoot "backend\review_engine"

if (-not (Test-Path $sourceHandler)) {
    throw "Backend handler not found."
}

if (-not (Test-Path (Join-Path $sourceEngine "analyzer.py"))) {
    throw "Review engine analyzer not found."
}

Remove-Item $packageDir -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Path "$packageDir\review_engine" -Force |
    Out-Null
New-Item -ItemType Directory -Path $zipDir -Force |
    Out-Null

Copy-Item $sourceHandler (Join-Path $packageDir "lambda_function.py")
Copy-Item (Join-Path $sourceEngine "*.py") "$packageDir\review_engine\"

$handlerPath = Join-Path $packageDir "lambda_function.py"
$content = [System.IO.File]::ReadAllText($handlerPath)

$oldImport = "from .review_engine.analyzer import analyze_patch, review_files"
$newImport = "from review_engine.analyzer import analyze_patch, review_files"

if (-not $content.Contains($oldImport)) {
    throw "Expected review-engine import not found. Package build stopped."
}

$content = $content.Replace($oldImport, $newImport)

[System.IO.File]::WriteAllText(
    $handlerPath,
    $content,
    [System.Text.UTF8Encoding]::new($false)
)

Push-Location $packageDir

try {
    python -c "import lambda_function; from review_engine.analyzer import review_files; result = review_files([{'filename':'app.py','patch':'@@ -0,0 +1,1 @@\n+result = eval(user_input)\n'}]); assert callable(lambda_function.lambda_handler); assert result['finding_count'] == 1; assert result['findings'][0]['rule'] == 'unsafe-eval'; print('Package smoke test passed.')"

    if ($LASTEXITCODE -ne 0) {
        throw "Package smoke test failed."
    }
}
finally {
    Pop-Location
}

Get-ChildItem $packageDir -Directory -Recurse -Filter "__pycache__" |
    Remove-Item -Recurse -Force

Get-ChildItem $packageDir -File -Recurse -Filter "*.pyc" |
    Remove-Item -Force

Remove-Item $zipPath -Force -ErrorAction SilentlyContinue

Compress-Archive -Path "$packageDir\*" -DestinationPath $zipPath -Force

python -c "import zipfile; z=zipfile.ZipFile('dist/code-review-agent-deployment-test.zip'); names=z.namelist(); assert z.testzip() is None; assert 'lambda_function.py' in names; assert 'review_engine/analyzer.py' in names; assert 'review_engine/rules.py' in names; assert not any('__pycache__' in n or n.endswith('.pyc') for n in names); print('ZIP layout and integrity passed.')"

if ($LASTEXITCODE -ne 0) {
    throw "ZIP verification failed."
}

Write-Host "Deployment-test ZIP created: $zipPath"
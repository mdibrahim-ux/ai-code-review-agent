# AI Code Review Agent

An automated code review system that analyzes GitHub pull requests, detects common code issues, and reports findings.

## Features

- **Automated code review:** Processes GitHub pull-request webhook events.
- **Security checks:** Detects possible hardcoded credentials, broad exception handling, and debug output, with AST-aware Python checks for dynamic execution, risky subprocess calls, unsafe deserialization, unsafe YAML loading, and direct SQL string interpolation.
- **Code quality checks:** Identifies broad exception handling and debug `print()` statements.
- **Inline review comments:** Posts findings on relevant changed lines when possible.
- **Secure webhook validation:** Verifies GitHub webhook signatures.
- **Repository validation:** Restricts reviews to the configured repository.
- **Automated testing:** Runs Python unit tests through GitHub Actions.
- **AWS Lambda packaging:** Includes a PowerShell script to build and verify the deployment ZIP.

## Technology Stack

- Python 3.13
- AWS Lambda
- Amazon API Gateway
- GitHub Webhooks and Pull Requests
- GitHub Actions
- Boto3
- PowerShell

## Project Structure

```text
ai-code-review-agent/
├── .github/
│   └── workflows/
│       └── tests.yml
├── backend/
│   ├── lambda_function.py              # GitHub webhook receiver + async commenter
│   ├── dashboard_api/
│   │   └── lambda_function.py          # Read-only dashboard API source
│   └── review_engine/
│       ├── __init__.py
│       ├── analyzer.py
│       └── rules.py
├── dashboard/
├── tests/
├── scripts/
│   └── build_lambda_package.ps1
└── README.md
```

## Run Locally

Open a terminal in the project directory.

Install the required Python dependency:

```powershell
python -m pip install boto3
```

Run the unit tests:

```powershell
python -m unittest discover -s tests -v
```

Compile-check the Python files:

```powershell
python -m compileall -q backend tests
```

## Build the AWS Lambda Package

Run the packaging script from the project root in PowerShell:

```powershell
.\scripts\build_lambda_package.ps1
```

The script creates a deployment ZIP under `dist/` and verifies its contents and integrity.

## GitHub Actions

The `Python CI` workflow runs on pushes to `main` and `feature/**`, and on pull requests targeting `main`.

It runs unit tests, Ruff linting, Python compilation, dashboard HTML/CSS/JavaScript checks, and both Lambda package-validation scripts. Pushes to `main` also verify scoped AWS OIDC read access. Production Lambda updates remain manually confirmed.

## AST-Aware Python Checks

The shared review engine uses Python's built-in `ast` module to inspect changed Python diff hunks when they are parseable. Current structural checks include:

- Calls to `eval()` and `exec()`, including qualified calls.
- `subprocess.run/Popen/call/check_call/check_output(..., shell=True)`.
- `pickle` or `dill` `load()/loads()` deserialization.
- `yaml.load()` without a recognized safe loader.
- Direct f-string or non-constant string concatenation passed to SQL `execute()/executemany()`.

The analyzer preserves changed-line numbers and nearby patch context. AST checks distinguish executable calls from matching text inside comments and string literals. GitHub diffs can contain incomplete fragments; when a whole hunk cannot be parsed, the analyzer falls back to individually parseable added lines. This remains deterministic static analysis, not full-repository semantic analysis or an LLM review. Imported aliases, values constructed elsewhere, and complex multi-file flows may not be recognized, and all findings require developer verification.

## Dashboard API (Read-Only)

The dashboard API handler lives in `backend/dashboard_api/lambda_function.py`. It implements:

- `GET /health` — health check.
- `GET /dashboard` — live pull-request metadata and explicit disclosure that historical findings are not persisted.
- `GET /pull-requests` — open pull-request metadata from the configured repository.
- `POST /review` — read-only deterministic review of an open pull-request diff. It never posts comments.

The handler reads the existing `/code-review-agent/github-token` SecureString in Systems Manager Parameter Store. It does not accept an arbitrary repository name from the browser, and it returns `comments_published: false`. The separate webhook Lambda remains responsible for publishing GitHub summary and inline comments after signed webhook events.

Run its tests with:

```powershell
python -m unittest tests.test_dashboard_api -v
```

Build and validate a deployment-test ZIP (no AWS changes are made):

```powershell
.\scripts\build_dashboard_api_package.ps1
```

The script writes `dist/sentinel-dashboard-api-deployment-test.zip` and checks its ZIP integrity and runtime smoke test. Deploying this artifact is a separate, manually approved operation.

## Publish the Sentinel Dashboard

The dashboard is a static HTML/CSS/JavaScript site. It can be hosted on **GitHub Pages for a public repository**, without adding an AWS hosting resource.

1. In repository **Settings → Pages**, set **Build and deployment → Source** to **GitHub Actions**.
2. Open **Actions → Publish Sentinel Dashboard → Run workflow**.
3. Open the deployment job's environment URL to view the published dashboard.

The workflow publishes only `dashboard/index.html`, `dashboard/style.css`, and `dashboard/script.js`. It supports manual `workflow_dispatch` runs and automatically publishes after changes to `dashboard/**` or `.github/workflows/pages.yml` merge into `main`. Its GitHub Pages action versions are pinned to immutable commit SHAs.

The dashboard calls the existing API Gateway endpoints in `ap-south-1`. Its browser origin must be present in the API Gateway CORS allowlist for live API requests to work. CORS does not replace server-side access controls.

## Controlled AWS Lambda Deployment

The `Python CI` workflow can build and validate both Lambda ZIPs. Deployments are manually triggered from `main` and require `confirm_deployment=yes`. Choose the specific `deployment_target`:

- `code-review-agent` — signed webhook receiver and background commenter.
- `sentinel-dashboard-api` — read-only dashboard API; review results are returned to the dashboard and are not posted as comments.

The workflow verifies the selected Lambda ARN, runtime, handler, and deployed ZIP checksum. The dashboard API deployment additionally calls the existing API Gateway health/queue/review endpoints after updating the code. No new AWS service is created by these workflows.

### Dashboard API source-context budget

The manually confirmed dashboard API deployment sets the existing `sentinel-dashboard-api` Lambda timeout to 25 seconds, below its existing API Gateway 30-second integration timeout. Each outbound GitHub request is bounded to 4 seconds. For live reviews, the API may fetch complete contents for at most two changed Python files at the pull request's exact head commit, with each source file capped at 50 KB. When content is missing, too large, or unavailable, the analyzer falls back to the unified diff. AST findings are only returned when their call expressions overlap added PR lines. The dashboard waits up to 27 seconds for a live review response. This uses existing resources only and creates no additional AWS services.


## AWS Configuration

The webhook receiver runs on AWS Lambda and integrates with GitHub through a webhook.

Configure the required Lambda environment variables and secrets according to your deployment. Store sensitive tokens and webhook secrets securely; never commit them to the repository.

The dashboard API is deployed separately from the webhook receiver.

## Security Notes

- Verify webhook signatures before processing events.
- Restrict processing to the intended repository.
- Keep GitHub tokens and webhook secrets private.
- Review findings before making changes to production code.

## Project Status

The `main` branch CI has passed unit tests, linting, syntax/asset checks, package validation, and AWS OIDC read-only verification. AST-aware checks are covered by targeted regression tests.

## License

Add a license if you intend to distribute this project publicly.


### Live dashboard diff context

The read-only dashboard review response includes a small, line-numbered context window taken from the actual GitHub patch for each finding. The dashboard renders old/new line numbers and highlights the exact added line that matched a configured rule. This is observed patch context, not an LLM-generated fix; curated sample dossiers may still show illustrative remediation examples.


### Live dashboard review telemetry

The read-only review API returns a bounded changed-file manifest (path, status, additions, deletions, change count, and patch availability), aggregate change totals, and the number of full-source Python files loaded for AST analysis. The dashboard uses this metadata for the changed-file panel and language footprint, clears findings when a live review returns zero matches, and distinguishes AST from pattern-rule findings. It does not persist historical review data or publish GitHub comments.

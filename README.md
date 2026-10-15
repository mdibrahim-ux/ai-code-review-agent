# AI Code Review Agent

An automated code review system that analyzes GitHub pull requests, detects common code issues, and reports findings.

## Features

- **Automated code review:** Processes GitHub pull-request webhook events.
- **Security checks:** Detects potential hardcoded secrets and unsafe use of `eval()`.
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

The `Python Tests` workflow runs on pushes to `main` and `test-ai-review`, and on pull requests targeting `main`.

It installs the Python dependency, runs unit tests, and checks Python compilation.

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

The workflow publishes only `dashboard/index.html`, `dashboard/style.css`, and `dashboard/script.js`. It is manually triggered initially so the first deployment does not run until Pages has been enabled. After the initial deployment succeeds, its trigger can be changed to publish automatically after dashboard changes merge to `main`.

The dashboard calls the existing API Gateway endpoints in `ap-south-1`. Its browser origin must be present in the API Gateway CORS allowlist for live API requests to work. CORS does not replace server-side access controls.

## Controlled AWS Lambda Deployment

The `Python CI` workflow can build and validate both Lambda ZIPs. Deployments are manually triggered from `main` and require `confirm_deployment=yes`. Choose the specific `deployment_target`:

- `code-review-agent` — signed webhook receiver and background commenter.
- `sentinel-dashboard-api` — read-only dashboard API; review results are returned to the dashboard and are not posted as comments.

The workflow verifies the selected Lambda ARN, runtime, handler, and deployed ZIP checksum. The dashboard API deployment additionally calls the existing API Gateway health/queue/review endpoints after updating the code. No new AWS service is created by these workflows.

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

The automated Python test workflow has passed on the `test-ai-review` branch.

## License

Add a license if you intend to distribute this project publicly.


### Dashboard API timeout budget

The manually confirmed dashboard API deployment sets the existing `sentinel-dashboard-api` Lambda timeout to 10 seconds and verifies that configuration after the update. Each outbound GitHub HTTP request is bounded to 4 seconds, leaving time for the second request and response handling. The browser waits up to 12 seconds for a live review response, below the existing API Gateway 30-second integration timeout. This uses existing resources only; it does not create a new AWS service or hosting resource.

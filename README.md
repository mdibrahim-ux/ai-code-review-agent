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

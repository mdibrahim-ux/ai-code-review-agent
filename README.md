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
│   ├── lambda_function.py
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

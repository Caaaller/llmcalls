# GitHub Actions Workflows

This directory contains CI/CD workflows for automated testing and deployment.

## Workflows

### `ci.yml` - Continuous Integration 
- **Triggers**: Pull requests and pushes to `master`/`main`
- **Purpose**: Validate code quality before merge
- **Actions**:
  - Installs dependencies
  - Builds TypeScript
  - Type checks code
  - Builds frontend
  - (Tests can be added here)

### `deploy.yml` - Deploy to Railway
- **Triggers**: Push to `master`/`main` or manual dispatch
- **Purpose**: Automatically deploy demo to Railway
- **Requirements**:
  - `RAILWAY_TOKEN` secret in GitHub
  - `RAILWAY_SERVICE_ID` secret in GitHub

## Setup Instructions

1. Set up your Railway project and service
2. Add the required secrets to GitHub:
   - Go to Repository → Settings → Secrets and variables → Actions
   - Add `RAILWAY_TOKEN` and `RAILWAY_SERVICE_ID`
3. Merge to `master` to trigger deployment

See `DEPLOYMENT.md` for detailed Railway setup instructions.


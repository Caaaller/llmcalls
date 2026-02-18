# Plan: Add Husky Pre-commit Hooks + GitHub Actions for Lint/Prettier

## Overview

Add husky + lint-staged for pre-commit quality checks, and add lint/format steps to CI.

## Part 1: Husky + lint-staged Setup

### Install dependencies

```bash
npm install --save-dev husky lint-staged
```

### Initialize husky

```bash
npx husky init
```

This creates `.husky/` directory and adds a `prepare` script to package.json.

### Configure pre-commit hook

Create `.husky/pre-commit` that runs `npx lint-staged`.

### Configure lint-staged in package.json

```json
"lint-staged": {
  "src/**/*.{ts,tsx}": [
    "eslint --fix",
    "prettier --write"
  ],
  "frontend/src/**/*.{ts,tsx}": [
    "prettier --write"
  ],
  "*.{json,md,yml,yaml}": [
    "prettier --write"
  ]
}
```

Notes:

- Backend `.ts` files get both eslint and prettier (eslint config exists for backend only)
- Frontend `.tsx` files get prettier only (frontend eslint is handled by react-scripts)
- Config/doc files get prettier only

## Part 2: GitHub Actions CI Updates

### Update `.github/workflows/ci.yml`

Add two new steps after dependency install, before build:

1. **Lint check** - `npm run lint` (backend TypeScript linting)
2. **Format check** - `npm run format:check && cd frontend && npm run format:check`

Updated job steps:

```yaml
- name: Lint
  run: npm run lint
  env:
    ESLINT_USE_FLAT_CONFIG: false

- name: Check formatting
  run: |
    npm run format:check
    cd frontend && npm run format:check
```

These run as blocking checks - PRs must pass lint and format to merge.

## File Changes Summary

| File                       | Action                                                |
| -------------------------- | ----------------------------------------------------- |
| `package.json`             | Add husky, lint-staged deps + config + prepare script |
| `.husky/pre-commit`        | Create - runs lint-staged                             |
| `.github/workflows/ci.yml` | Add lint + format check steps                         |

## Estimated Effort

~15 minutes of implementation. No breaking changes - existing code already passes
lint and format checks (verified by existing scripts).

# Refactor to pnpm Monorepo

## Status: Complete

## Structure

```
pnpm-workspace.yaml
package.json              # root (scripts + shared devDeps: husky, lint-staged, prettier)
packages/
  backend/
    src/                  # moved from root src/
    package.json
    tsconfig.json
    jest.config.js
    .eslintrc.json
  frontend/
    src/                  # moved from frontend/src/
    public/
    package.json
    tsconfig.json
```

## Key Changes

- Root `package.json`: workspace scripts only (`pnpm -r build/test/lint/format`)
- `pnpm-workspace.yaml`: defines `packages/*`
- `packages/backend/package.json`: all backend deps + scripts
- `packages/frontend/package.json`: all frontend deps + scripts
- CI updated to use `pnpm/action-setup` + single `pnpm install`
- `lint-staged` paths updated to `packages/backend/src/**/*.ts` etc.

## Verification

- `pnpm install` ✅
- `pnpm -r format:check` ✅
- `pnpm --filter backend lint` ✅ (1 pre-existing warning)
- Build errors in backend (`logOnError`) are pre-existing

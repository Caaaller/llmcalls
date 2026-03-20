Deploy the app to production. This project auto-deploys on push to main via GitHub Actions + Railway.

Steps:

1. Run `pnpm --filter backend build` to verify the build passes
2. Check `git status` for uncommitted changes — if any, ask the user whether to commit first
3. Run `git push origin main` to trigger the deploy
4. Monitor the GitHub Actions deploy workflow: `gh run list --workflow=deploy.yml --limit=1`
5. Wait for it to complete: `gh run watch` on the latest run
6. Report the result (success/failure) with the deploy URL if available

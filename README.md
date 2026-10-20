# API Server

This folder is a root-level copy of the Local Sathi API server for easier browsing and GitHub syncing.

It is part of the parent pnpm workspace and uses the shared `lib/api-zod` package. Install dependencies from the repository root, then run:

```sh
pnpm --filter api-server run typecheck
pnpm --filter api-server run build
```

The artifact workflow continues to use `artifacts/api-server`.

# Contributing

## Setup

```sh
npm ci
```

## Build, lint and test

```sh
npm run format:check   # Prettier
npm run lint            # ESLint
npm run type-check       # tsc, no emit
npm test                # Jest
npm run test:coverage    # Jest, with a coverage summary (what CI runs)
npm run package          # Rollup: builds every action under src/actions/*
npm run all              # All of the above except test:coverage, in that order
```

Run `npm run all` before opening a pull request. CI runs the same checks, plus
the coverage summary and the `dist/` freshness check.

## dist/ is committed

See [README.md](./README.md#layout) for why. Never edit a file under
`actions/*/dist/` by hand: after changing anything under `src/`, run
`npm run package` and commit the result.

## Dependency bump pull requests

Dependabot cannot run `npm run package`, so a dependency bump leaves the
committed bundles stale and CI's `dist/` freshness check fails. After merging a
dependency bump into the pull request branch, run `npm run package` and commit
the updated `actions/*/dist/index.js` files onto that branch yourself.

## Adding a new action

1. Create `src/actions/<name>/index.ts`. This is the action's entry point.
2. Put code shared with other actions in `src/lib/`, not in the action's own
   directory.
3. Add `actions/<name>/action.yml` with the action's inputs, outputs, and
   `runs: using: node24, main: dist/index.js`.
4. Add tests under `__tests__/`, mirroring the path under `src/`.
5. Run `npm run package` to build `actions/<name>/dist/index.js`, and commit it
   together with the source.

`rollup.config.ts` discovers every `src/actions/*/index.ts` automatically; no
build config changes are needed for a new action.

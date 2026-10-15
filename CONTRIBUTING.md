# Contributing

Thanks for helping. Issues and pull requests are welcome at
[github.com/BYDTechSolutions/drift-check](https://github.com/BYDTechSolutions/drift-check).

## Setup

```sh
npm ci
npm run typecheck
npm test
npm run build
```

Node.js 20 or later.

## Rules

- Tests build their fixtures in temporary folders and never touch files outside
  them. Keep it that way, especially for `--fix`.
- Keep the examples passing: `test/cli.test.ts` runs them.
- No runtime dependencies without a strong reason, stated in the README.
- Add a line to `CHANGELOG.md` under "Unreleased".
- American English in code, messages and docs.

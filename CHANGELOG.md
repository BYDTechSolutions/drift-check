# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] - 2026-10-16

### Added

- `drift-check`: checks groups of files that must agree, from `drift-check.config.{mjs,js,json}` or `--config`; exit codes 0 (agree), 1 (drift) and 2 (usage or config error).
- Three comparison modes: `bytes` (exact), `text` (line endings, trailing whitespace, final blank lines and a BOM ignored) and `json` (parsed and compared canonically).
- Groups with a `source` of truth, or without one (all members agree with the first file found); paths and globs; `optional` per group or per file.
- A unified diff per differing file, capped with `--diff-lines`; a note instead of a diff for binary files and whitespace-only differences.
- Output formats `text`, `json` and `github` (Actions annotations).
- `drift-check --fix` copies each source over the copies that differ, are invalid or missing; `--dry-run` lists what it would write.
- API: `checkDrift`, `fixDrift`, `defineConfig`, `loadConfig`, `validateConfig`, `formatReport`, `formatFix`, `unifiedDiff`, `expandGlob`, `matchesGlob` and the normalization helpers.

[Unreleased]: https://github.com/BYDTechSolutions/drift-check/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/BYDTechSolutions/drift-check/releases/tag/v0.1.0

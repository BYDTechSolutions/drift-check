# @bydtech/drift-check

Fail CI when files that must stay identical across folders or repos have drifted apart, and copy the source of truth back over them.

[![npm version](https://img.shields.io/npm/v/@bydtech/drift-check.svg)](https://www.npmjs.com/package/@bydtech/drift-check)
[![CI](https://github.com/BYDTechSolutions/drift-check/actions/workflows/ci.yml/badge.svg)](https://github.com/BYDTechSolutions/drift-check/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

## Why it exists

When separate apps or repos cannot import from each other, the same file ends up copied into each: shared content, design tokens, a schema, a license. A fix made in one copy and not the others goes unnoticed until two screens disagree. `drift-check` names the files that must agree, fails the build when they do not, shows what changed, and can copy the source of truth back over the rest.

## Install

```sh
npm install --save-dev @bydtech/drift-check
```

Node.js 20 or later. No runtime dependencies.

## Quick start

Create `drift-check.config.json` at the root of your project:

```json
{
  "groups": [
    {
      "name": "content",
      "source": "shared/content.json",
      "files": ["web/src/content.json", "api/data/content.json"],
      "mode": "json"
    },
    {
      "name": "design-tokens",
      "files": ["*/src/tokens.css"],
      "mode": "text"
    }
  ]
}
```

Then:

```sh
npx drift-check                 # check; exits 1 if any group drifted
npx drift-check --fix --dry-run # show what --fix would write
npx drift-check --fix           # copy each source over the copies that differ
```

A drifted group prints the files that differ and the start of a unified diff (in `json` mode, of the canonical form, keys sorted):

```
DRIFT content (json, source shared/content.json)
    source   shared/content.json
    same     web/src/content.json
    DIFFERS  api/data/content.json
      --- shared/content.json
      +++ api/data/content.json
      @@ -4,5 +4,5 @@
           "AI agents",
           "Web and mobile apps"
         ],
      -  "title": "What we build"
      +  "title": "What we make"
       }
ok    design-tokens (text, no source)
    first    admin/src/tokens.css
    same     web/src/tokens.css

drift-check: 1 of 2 groups drifted (1 differs). FAIL
```

A runnable copy of this setup is in [`examples/three-apps`](examples/three-apps).

## CLI reference

```
drift-check [options]            check every group (writes nothing)
drift-check --fix [--dry-run]    copy each group's source over the files that differ
```

| Option | Default | What it does |
|---|---|---|
| `-c, --config <path>` | the first of `drift-check.config.mjs`, `drift-check.config.js`, `drift-check.config.json` in the current folder | The config file. Paths in it are relative to its own folder, wherever you run the command from. |
| `--fix` | off | Copy each group's source over the members that differ, are invalid, or are missing. Groups without a `source` are reported and left alone. |
| `--dry-run` | off | With `--fix`: list what would be written, write nothing. Without `--fix` it is a usage error. |
| `-f, --format <name>` | `text` | `text`, `json` (the full report), or `github` (one `::error` annotation per problem, then the summary line). |
| `--diff-lines <n>` | `20` | Diff lines shown per differing file, after the `---`/`+++` header. `0` hides diffs. |
| `-h, --help` | | Show help. |
| `-v, --version` | | Show the version. |

### Exit codes

| Code | Check | `--fix` | `--fix --dry-run` |
|---|---|---|---|
| `0` | Every group agrees. | Every group agrees after fixing. | Nothing would be written and every group agrees. |
| `1` | A group drifted: a file differs, is missing, or is invalid. | Some drift remains (a group with no source, a missing source, a write that failed). | Something would be written, or drift would remain. |
| `2` | Usage or config error: unknown option, no config file, invalid config. | Same. | Same. |

### Use in CI

```yaml
- run: npx drift-check --format github
```

`--format github` turns each problem into an error annotation on the file, with the diff in its message. A missing file has no file to point at, so its annotation appears in the run summary.

## API reference

```ts
import { checkDrift, fixDrift, loadConfig, formatReport } from '@bydtech/drift-check';

const { config, root } = await loadConfig();          // finds drift-check.config.* in process.cwd()
const report = await checkDrift(config, { cwd: root });
if (!report.ok) {
  console.error(formatReport(report));                // or 'json' / 'github'
  const result = await fixDrift(config, { cwd: root, dryRun: true });
  for (const change of result.changes) console.log(`${change.path} would be ${change.action}`);
}
```

| Export | What it does |
|---|---|
| `checkDrift(config, options?)` | Reads and compares every group. Never writes. Resolves to a `Report`: `{ ok, groups, summary }`, where each group has `{ name, mode, source?, reference?, ok, files }` and each file `{ path, absolutePath, status, diff?, message?, unmatched? }`. Options: `cwd` (`process.cwd()`), `diffLines` (20), `context` (3). |
| `fixDrift(config, options?)` | Copies each source over the members that differ, are invalid or missing. Resolves to `{ dryRun, changes, skipped, report }`; `report` is the check after fixing (before, on a dry run). Options: those of `checkDrift`, plus `dryRun` (false). |
| `defineConfig(config)` | Returns its argument; gives a `.mjs` config type checking. |
| `loadConfig({ cwd?, path? })` | Finds, loads and validates a config file. Resolves to `{ config, path, root }`; `root` is the file's folder. |
| `validateConfig(value)` | Throws `DriftConfigError` naming the first problem. |
| `formatReport(report, format?)`, `formatFix(result, format?)`, `summaryLine(report)` | The CLI's output, as strings. |
| `unifiedDiff(a, b, options?)` | The diff used in reports: `fromFile`, `toFile`, `context` (3), `maxLines`, `maxCells` (4,000,000). Empty string when the lines are equal. |
| `diffLines(a, b, maxCells?)`, `splitLines(text)` | The line-level edit script behind it. |
| `expandGlob(pattern, cwd)`, `matchesGlob(path, glob)`, `globToRegExp(glob)`, `isGlob(text)` | The glob matcher. |
| `normalizeText(text)`, `canonicalJson(text)`, `isBinary(buffer)` | The normalization behind `text` and `json` mode, and the binary test. |

A file's `status` is one of:

| Status | Meaning | Drift? |
|---|---|---|
| `reference` | The file the others were compared with: the source, or the first file found. | no |
| `match` | Agrees with the reference under the group's mode. | no |
| `differs` | Does not agree. | yes |
| `missing` | Does not exist, or a glob matched nothing (`unmatched: true`). | yes |
| `invalid` | Could not be read (a folder, no permission), or is not valid JSON in `json` mode. | yes |
| `skipped` | Optional and missing, or not compared because the source is missing or invalid. | no |

`DriftConfigError` is thrown for a missing or invalid config; the CLI exits 2 on it. All types are exported.

## Configuration

A config file is `drift-check.config.json`, or a `.mjs`/`.js` file whose default export is the config (see [`examples/drift-check.config.mjs`](examples/drift-check.config.mjs)). Unknown keys are an error, so a typo does not silently disable a check.

```ts
{
  groups: Array<{
    name: string;
    source?: string;
    files: Array<string | { path: string; optional?: boolean }>;
    mode?: 'bytes' | 'text' | 'json';
    optional?: boolean;
  }>;
}
```

| Option | Default | Meaning |
|---|---|---|
| `name` | required | Shown in every message. Unique in the config. |
| `source` | none | The source of truth: one path, not a glob. Every member is compared with it, and `--fix` copies it. It may also be listed in `files`; it is counted once. A missing source always fails the group. Without a source, every member is compared with the first file found, and `--fix` skips the group. |
| `files` | required | Paths or globs of the members, relative to the config file's folder, or absolute. A file matched twice is counted once. |
| `files[].optional` | the group's `optional` | When true, this entry may be missing (or its glob may match nothing) without counting as drift. |
| `mode` | `bytes` | How members are compared (below). |
| `optional` | `false` | When true, every member may be missing. The source may not. |

### Modes

| Mode | Two files agree when | The diff shows |
|---|---|---|
| `bytes` | they are identical, byte for byte. | the raw lines. When the only difference is line endings, trailing whitespace or a byte order mark, it says so instead; binary files (a NUL byte in the first 8,000 bytes) get no diff. |
| `text` | they are equal after removing a UTF-8 byte order mark, turning CRLF and CR into LF, removing spaces and tabs at the end of each line, and ignoring blank lines at the end of the file. | the normalized lines. |
| `json` | they parse to the same data. Key order and formatting do not matter; array order does. | both files printed canonically (keys sorted, two-space indent), so line numbers refer to that form, not to the file. |

`--fix` copies the source's exact bytes, so a fixed copy agrees in every mode. It only touches members that fail the group's mode: in `text` mode, a copy that differs only in line endings is left alone.

## How it works, and its limits

- **Globs.** `*` matches within one path segment, `**` any number of segments, `?` one character, `{a,b}` either option, `[abc]` and `[!abc]` a character class. A pattern is matched against the whole path, so `*.json` means files at the root only; use `**/*.json` for any depth. Dotfiles match like any other name. The walk starts at the pattern's literal leading folders, goes no deeper than the pattern can reach, follows symbolic links, and does not enter `node_modules` or `.git` unless those are in the literal part of the pattern. Matches are sorted, so "the first file found" is the first in sorted order. Node's own `fs.glob` arrived in Node 22 and was experimental there, so the package carries a small matcher (about a hundred lines) instead of a dependency.
- **Diffs.** Common leading and trailing lines are trimmed, then the changed middle is compared line by line with a longest-common-subsequence table. The table is capped at 4,000,000 cells (about a 2,000 × 2,000 line change); past that, the middle is shown as all removed and all added. Either way the diff is correct, just not always the shortest. This keeps the package free of a diff dependency, and the files it is meant for are small.
- **Memory.** Every member is read whole into memory. It is built for content, config and source files, not for large binaries.
- **JSON.** Comparison goes through `JSON.parse`, so numbers are compared as JavaScript numbers (`1.0` equals `1`, and integers beyond 2^53 lose precision), and a duplicated key keeps its last value. JSON with comments is not valid JSON here.
- **Text encoding.** `text` and `json` mode read files as UTF-8.
- **`--fix` is a copy.** It overwrites members with the source and creates missing ones (and their folders). It cannot create files from a glob that matched nothing, and it never edits the source. Commit or stash before running it, or start with `--dry-run`.
- **Several repos.** The tool compares paths on one disk. To check copies kept in separate repos, check them out side by side in CI and point the config at them.
- **No runtime dependencies.** It uses `node:fs`, `node:path`, `node:url` and `node:util` `parseArgs`.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Security issues: see [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE)

---

Maintained by [BYD Tech](https://bydtech.in), a software studio that builds MVPs, AI agents, and web & mobile apps.

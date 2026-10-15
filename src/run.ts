import { parseArgs } from 'node:util';
import { DEFAULT_DIFF_LINES, checkDrift, fixDrift } from './check.js';
import { CONFIG_FILES, DriftConfigError, loadConfig } from './config.js';
import { FORMATS, formatFix, formatReport, type Format } from './format.js';
import { VERSION } from './version.js';

/** Exit codes: 0 every group agrees, 1 drift, 2 usage or config error. */
export const EXIT = { OK: 0, DRIFT: 1, USAGE: 2 } as const;

/** Everything the CLI touches outside itself, so tests can replace it. */
export interface CliIo {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  cwd: string;
}

export const HELP = `drift-check ${VERSION}: fail when files that must stay identical have drifted

Usage:
  drift-check [options]            check every group (writes nothing)
  drift-check --fix [--dry-run]    copy each group's source over the files that differ

Options:
  -c, --config <path>    Config file (default: the first of ${CONFIG_FILES.join(', ')}
                         in the current folder). Paths in it are relative to its folder.
      --fix              Copy the source over differing, invalid and missing members.
                         Groups without a "source" are reported, not changed.
      --dry-run          With --fix: say what would be written, write nothing.
  -f, --format <name>    Output: ${FORMATS.join(', ')} (default: text). github prints
                         GitHub Actions annotations.
      --diff-lines <n>   Diff lines shown per differing file; 0 hides diffs (default: ${DEFAULT_DIFF_LINES}).
  -h, --help             Show this help
  -v, --version          Show the version

Exit codes: 0 every group agrees, 1 drift (or --fix left some), 2 usage or config error.
`;

const OPTIONS = {
  config: { type: 'string', short: 'c' },
  fix: { type: 'boolean' },
  'dry-run': { type: 'boolean' },
  format: { type: 'string', short: 'f' },
  'diff-lines': { type: 'string' },
  help: { type: 'boolean', short: 'h' },
  version: { type: 'boolean', short: 'v' },
} as const;

/** Run the CLI with `args` (without the node and script paths). Resolves to the exit code. */
export async function run(args: string[], io: CliIo): Promise<number> {
  let values;
  try {
    ({ values } = parseArgs({ args, options: OPTIONS, allowPositionals: false, strict: true }));
  } catch (error) {
    io.stderr(`drift-check: ${(error as Error).message}\nRun "drift-check --help" for usage.\n`);
    return EXIT.USAGE;
  }
  if (values.help) {
    io.stdout(HELP);
    return EXIT.OK;
  }
  if (values.version) {
    io.stdout(`${VERSION}\n`);
    return EXIT.OK;
  }

  try {
    const format = (values.format ?? 'text') as Format;
    if (!FORMATS.includes(format)) throw new DriftConfigError(`--format must be ${FORMATS.join(', ')} (got "${values.format}")`);
    let diffLines = DEFAULT_DIFF_LINES;
    if (values['diff-lines'] !== undefined) {
      diffLines = Number(values['diff-lines']);
      if (!/^\d+$/.test(values['diff-lines'])) throw new DriftConfigError(`--diff-lines must be a whole number (got "${values['diff-lines']}")`);
    }
    if (values['dry-run'] && !values.fix) throw new DriftConfigError('--dry-run only works with --fix');

    const { config, root } = await loadConfig({ cwd: io.cwd, path: values.config });
    if (values.fix) {
      const result = await fixDrift(config, { cwd: root, diffLines, dryRun: values['dry-run'] });
      io.stdout(`${formatFix(result, format)}\n`);
      const clean = result.dryRun ? result.changes.length === 0 && result.report.ok : result.report.ok;
      return clean ? EXIT.OK : EXIT.DRIFT;
    }
    const report = await checkDrift(config, { cwd: root, diffLines });
    io.stdout(`${formatReport(report, format)}\n`);
    return report.ok ? EXIT.OK : EXIT.DRIFT;
  } catch (error) {
    if (error instanceof DriftConfigError) {
      io.stderr(`drift-check: ${error.message}\n`);
      return EXIT.USAGE;
    }
    throw error;
  }
}

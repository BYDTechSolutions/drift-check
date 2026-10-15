/**
 * How the members of a group are compared.
 *
 * - `bytes`: the files must be identical, byte for byte.
 * - `text`: equal after normalizing line endings (CRLF and CR become LF),
 *   removing trailing spaces and tabs on each line, trailing blank lines at
 *   the end of the file, and a UTF-8 byte order mark.
 * - `json`: equal after parsing and printing canonically, so key order and
 *   formatting do not matter. Array order does.
 */
export type Mode = 'bytes' | 'text' | 'json';

/** One entry of a group's `files`: a path or glob, optionally allowed to be missing. */
export interface FileEntry {
  /** A path or glob, relative to the config file's folder (or absolute). */
  path: string;
  /** When true, a missing file (or a glob matching nothing) is not drift. Default: the group's `optional`. */
  optional?: boolean;
}

/** A set of files that must agree. */
export interface Group {
  /** Shown in every message about the group. Must be unique in the config. */
  name: string;
  /**
   * The source of truth: a plain path (not a glob). Every other member is
   * compared with it, and `--fix` copies it over them. Without a source, all
   * members must agree with the first one found, and `--fix` skips the group.
   */
  source?: string;
  /** Paths or globs of the members. The source may be listed here too; it is counted once. */
  files: Array<string | FileEntry>;
  /** How to compare. Default: `bytes`. */
  mode?: Mode;
  /** When true, every member may be missing without counting as drift. Default: false. The source may never be missing. */
  optional?: boolean;
}

/** The whole config. */
export interface Config {
  groups: Group[];
}

/** The state of one member after a check. */
export type FileStatus =
  /** The reference itself: the source, or the first file of a group without one. */
  | 'reference'
  /** Agrees with the reference under the group's mode. */
  | 'match'
  /** Does not agree. */
  | 'differs'
  /** Does not exist (or a glob matched nothing), and is not optional. */
  | 'missing'
  /** Not compared, and not drift: optional and missing, or the source it would be compared with is missing or invalid. */
  | 'skipped'
  /** Could not be read, or is not valid JSON in `json` mode. */
  | 'invalid';

/** One member of a group, as checked. */
export interface FileReport {
  /** The path as shown: relative to the root when inside it, absolute otherwise. For a glob that matched nothing, the glob. */
  path: string;
  /** The absolute path (for a glob that matched nothing, the absolute glob). */
  absolutePath: string;
  status: FileStatus;
  /** For `differs`, a unified diff against the reference, capped at `diffLines` lines (empty when `diffLines` is 0). */
  diff?: string;
  /** A sentence for `invalid`, `missing`, `skipped`, binary files, or a difference only in whitespace. */
  message?: string;
  /** True for a glob that matched no file; `path` is then the glob itself. */
  unmatched?: boolean;
}

/** One group, as checked. */
export interface GroupReport {
  name: string;
  mode: Mode;
  /** The path shown for the source, when the group has one. */
  source?: string;
  /** The path every member was compared with: the source, or the first file found. Absent when there was nothing to compare with. */
  reference?: string;
  /** True when no member is `differs`, `missing` or `invalid`. */
  ok: boolean;
  files: FileReport[];
}

/** The result of {@link checkDrift}. */
export interface Report {
  /** True when every group agrees. */
  ok: boolean;
  groups: GroupReport[];
  /** Counts across all groups. */
  summary: {
    groups: number;
    driftedGroups: number;
    files: number;
    differs: number;
    missing: number;
    invalid: number;
  };
}

/** Options shared by {@link checkDrift} and {@link fixDrift}. */
export interface CheckOptions {
  /** The folder relative paths and globs resolve against. Default: `process.cwd()`. */
  cwd?: string;
  /** Diff lines kept per differing file (after the `---`/`+++` header). 0 leaves diffs out. Default: 20. */
  diffLines?: number;
  /** Unchanged lines of context around each change. Default: 3. */
  context?: number;
}

/** Options for {@link fixDrift}. */
export interface FixOptions extends CheckOptions {
  /** Report what would change, and change nothing. Default: false. */
  dryRun?: boolean;
}

/** One file `fixDrift` wrote (or would write, on a dry run). */
export interface FixChange {
  group: string;
  /** The path shown, as in {@link FileReport.path}. */
  path: string;
  absolutePath: string;
  /** `updated` replaced a differing or invalid file; `created` wrote a missing one. */
  action: 'updated' | 'created';
  /** The source it was copied from, as shown. */
  from: string;
}

/** A group `fixDrift` could not repair. */
export interface FixSkip {
  group: string;
  reason: string;
}

/** The result of {@link fixDrift}. */
export interface FixResult {
  dryRun: boolean;
  changes: FixChange[];
  skipped: FixSkip[];
  /** The check after fixing. On a dry run, the check before (nothing was changed). */
  report: Report;
}

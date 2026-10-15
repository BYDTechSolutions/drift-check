import { copyFile, mkdir, readFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { InvalidContentError, isBinary, normalize, normalizeText, same } from './compare.js';
import { validateConfig } from './config.js';
import { unifiedDiff } from './diff.js';
import { expandGlob, isGlob } from './glob.js';
import type {
  CheckOptions,
  Config,
  FileReport,
  FixChange,
  FixOptions,
  FixResult,
  FixSkip,
  Group,
  GroupReport,
  Mode,
  Report,
} from './types.js';

/** Diff lines kept per differing file when no `diffLines` is given. */
export const DEFAULT_DIFF_LINES = 20;

interface Member {
  absolutePath: string;
  path: string;
  optional: boolean;
  isSource: boolean;
  unmatched?: boolean;
}

type Loaded =
  | { kind: 'ok'; bytes: Buffer; form: Buffer | string }
  | { kind: 'missing' }
  | { kind: 'invalid'; message: string };

function display(root: string, absolutePath: string): string {
  const rel = relative(root, absolutePath);
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) return absolutePath;
  return rel.split(sep).join('/');
}

async function members(group: Group, root: string): Promise<Member[]> {
  const list: Member[] = [];
  const seen = new Set<string>();
  const add = (member: Member) => {
    if (seen.has(member.absolutePath)) return;
    seen.add(member.absolutePath);
    list.push(member);
  };
  if (group.source !== undefined) {
    const absolutePath = resolve(root, group.source);
    add({ absolutePath, path: display(root, absolutePath), optional: false, isSource: true });
  }
  for (const entry of group.files) {
    const pattern = typeof entry === 'string' ? entry : entry.path;
    const optional = (typeof entry === 'string' ? undefined : entry.optional) ?? group.optional ?? false;
    if (isGlob(pattern)) {
      const found = await expandGlob(pattern, root);
      if (!found.length) {
        list.push({ absolutePath: resolve(root, pattern), path: pattern, optional, isSource: false, unmatched: true });
      }
      for (const absolutePath of found) add({ absolutePath, path: display(root, absolutePath), optional, isSource: false });
    } else {
      const absolutePath = resolve(root, pattern);
      add({ absolutePath, path: display(root, absolutePath), optional, isSource: false });
    }
  }
  return list;
}

async function load(member: Member, mode: Mode): Promise<Loaded> {
  if (member.unmatched) return { kind: 'missing' };
  let bytes: Buffer;
  try {
    bytes = await readFile(member.absolutePath);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'ENOTDIR') return { kind: 'missing' };
    if (code === 'EISDIR') return { kind: 'invalid', message: 'is a folder, not a file' };
    return { kind: 'invalid', message: `could not be read (${(error as Error).message})` };
  }
  try {
    return { kind: 'ok', bytes, form: normalize(bytes, mode) };
  } catch (error) {
    if (error instanceof InvalidContentError) return { kind: 'invalid', message: error.message };
    throw error;
  }
}

function explain(mode: Mode, ref: Buffer, other: Buffer, refPath: string, otherPath: string, refForm: Buffer | string, otherForm: Buffer | string, options: CheckOptions): Pick<FileReport, 'diff' | 'message'> {
  const diffLines = options.diffLines ?? DEFAULT_DIFF_LINES;
  if (mode === 'bytes') {
    if (isBinary(ref) || isBinary(other)) return { message: 'binary files differ' };
    if (normalizeText(ref.toString('utf8')) === normalizeText(other.toString('utf8'))) {
      return { message: 'differs only in line endings, trailing whitespace or a byte order mark' };
    }
  }
  if (diffLines <= 0) return {};
  const a = typeof refForm === 'string' ? refForm : ref.toString('utf8');
  const b = typeof otherForm === 'string' ? otherForm : other.toString('utf8');
  const diff = unifiedDiff(a, b, { fromFile: refPath, toFile: otherPath, context: options.context, maxLines: diffLines });
  if (!diff) return { message: 'same lines, different bytes at the end of the file' };
  return { diff };
}

async function checkGroup(group: Group, root: string, options: CheckOptions): Promise<GroupReport> {
  const mode = group.mode ?? 'bytes';
  const list = await members(group, root);
  const loaded = await Promise.all(list.map((m) => load(m, mode)));

  let refIndex = -1;
  if (group.source !== undefined) {
    if (loaded[0]?.kind === 'ok') refIndex = 0;
  } else {
    refIndex = loaded.findIndex((l) => l.kind === 'ok');
  }
  const ref = refIndex >= 0 ? list[refIndex] : undefined;
  const refLoaded = refIndex >= 0 ? (loaded[refIndex] as Extract<Loaded, { kind: 'ok' }>) : undefined;

  const files: FileReport[] = list.map((member, i) => {
    const base: FileReport = {
      path: member.path,
      absolutePath: member.absolutePath,
      status: 'match',
      ...(member.unmatched ? { unmatched: true } : {}),
    };
    const state = loaded[i]!;
    if (i === refIndex) return { ...base, status: 'reference' };
    if (state.kind === 'missing') {
      if (member.isSource) return { ...base, status: 'missing', message: 'the source is missing' };
      if (member.optional) return { ...base, status: 'skipped', message: member.unmatched ? 'optional; the glob matched no file' : 'optional and missing' };
      return { ...base, status: 'missing', message: member.unmatched ? 'the glob matched no file' : 'missing' };
    }
    if (state.kind === 'invalid') return { ...base, status: 'invalid', message: member.isSource ? `the source ${state.message}` : state.message };
    if (!ref || !refLoaded) return { ...base, status: 'skipped', message: 'not compared: the source is missing or invalid' };
    if (same(refLoaded.form, state.form)) return base;
    return {
      ...base,
      status: 'differs',
      ...explain(mode, refLoaded.bytes, state.bytes, ref.path, member.path, refLoaded.form, state.form, options),
    };
  });

  return {
    name: group.name,
    mode,
    ...(group.source !== undefined ? { source: list[0]!.path } : {}),
    ...(ref ? { reference: ref.path } : {}),
    ok: files.every((f) => f.status !== 'differs' && f.status !== 'missing' && f.status !== 'invalid'),
    files,
  };
}

/**
 * Check every group: read its members and compare each with the source (or,
 * without one, with the first file found). Never writes anything.
 * Throws `DriftConfigError` when the config is invalid.
 */
export async function checkDrift(config: Config, options: CheckOptions = {}): Promise<Report> {
  validateConfig(config);
  const root = resolve(options.cwd ?? process.cwd());
  const groups: GroupReport[] = [];
  for (const group of config.groups) groups.push(await checkGroup(group, root, options));
  const all = groups.flatMap((g) => g.files);
  const count = (status: FileReport['status']) => all.filter((f) => f.status === status).length;
  return {
    ok: groups.every((g) => g.ok),
    groups,
    summary: {
      groups: groups.length,
      driftedGroups: groups.filter((g) => !g.ok).length,
      files: all.filter((f) => !f.unmatched).length,
      differs: count('differs'),
      missing: count('missing'),
      invalid: count('invalid'),
    },
  };
}

/**
 * Copy each group's source over the members that differ from it, are invalid,
 * or are missing (creating folders as needed). Groups without a `source`, and
 * groups whose source is missing or invalid, are left alone and listed in
 * `skipped`. Optional missing files are not created. With `dryRun`, nothing is
 * written and `changes` lists what would be.
 */
export async function fixDrift(config: Config, options: FixOptions = {}): Promise<FixResult> {
  const dryRun = options.dryRun ?? false;
  const before = await checkDrift(config, options);
  const changes: FixChange[] = [];
  const skipped: FixSkip[] = [];

  for (const [i, group] of config.groups.entries()) {
    const report = before.groups[i]!;
    if (report.ok) continue;
    if (group.source === undefined) {
      skipped.push({ group: group.name, reason: 'no source to copy from; set "source" to let --fix repair it' });
      continue;
    }
    const source = report.files[0]!;
    if (source.status !== 'reference') {
      skipped.push({ group: group.name, reason: `the source ${source.path} is ${source.status === 'missing' ? 'missing' : 'invalid'}` });
      continue;
    }
    for (const file of report.files.slice(1)) {
      if (file.status !== 'differs' && file.status !== 'invalid' && file.status !== 'missing') continue;
      if (file.unmatched) {
        skipped.push({ group: group.name, reason: `${file.path} matched no file, and a glob cannot name a file to create` });
        continue;
      }
      const action = file.status === 'missing' ? 'created' : 'updated';
      if (!dryRun) {
        try {
          if (action === 'created') await mkdir(dirname(file.absolutePath), { recursive: true });
          await copyFile(source.absolutePath, file.absolutePath);
        } catch (error) {
          skipped.push({ group: group.name, reason: `could not write ${file.path}: ${(error as Error).message}` });
          continue;
        }
      }
      changes.push({ group: group.name, path: file.path, absolutePath: file.absolutePath, action, from: source.path });
    }
  }

  const report = dryRun ? before : await checkDrift(config, options);
  return { dryRun, changes, skipped, report };
}

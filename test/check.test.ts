import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { checkDrift, defineConfig, fixDrift, type Config, type GroupReport } from '../src/index.js';
import { canonicalJson, normalizeText } from '../src/compare.js';
import { fixture } from './helpers.js';

let cleanup: (() => Promise<void>) | undefined;
afterEach(async () => {
  await cleanup?.();
  cleanup = undefined;
});

async function setup(files: Record<string, string | Buffer>) {
  const f = await fixture(files);
  cleanup = f.cleanup;
  return f;
}

const statuses = (group: GroupReport) => Object.fromEntries(group.files.map((f) => [f.path, f.status]));

describe('normalization', () => {
  it('text: line endings, trailing whitespace, final blank lines and a BOM do not matter', () => {
    expect(normalizeText('﻿a  \r\nb\t\rc\n\n\n')).toBe('a\nb\nc\n');
    expect(normalizeText('')).toBe('');
    expect(normalizeText('  lead\n')).toBe('  lead\n');
  });

  it('json: keys are sorted at every level, arrays keep their order', () => {
    expect(canonicalJson('{"b":1,"a":{"d":[2,1],"c":null}}')).toBe(canonicalJson('{ "a": { "c": null, "d": [2, 1] }, "b": 1 }'));
    expect(canonicalJson('[1,2]')).not.toBe(canonicalJson('[2,1]'));
  });
});

describe('checkDrift: modes', () => {
  it('bytes: identical files agree; a CRLF copy differs, with a whitespace note instead of a diff', async () => {
    const { dir } = await setup({ 'a.txt': 'one\ntwo\n', 'b.txt': 'one\ntwo\n', 'c.txt': 'one\r\ntwo\r\n' });
    const ok = await checkDrift({ groups: [{ name: 'g', files: ['a.txt', 'b.txt'] }] }, { cwd: dir });
    expect(ok.ok).toBe(true);
    const report = await checkDrift({ groups: [{ name: 'g', files: ['a.txt', 'c.txt'] }] }, { cwd: dir });
    expect(report.ok).toBe(false);
    const file = report.groups[0]!.files[1]!;
    expect(file.status).toBe('differs');
    expect(file.diff).toBeUndefined();
    expect(file.message).toMatch(/only in line endings/);
  });

  it('bytes: binary files are reported without a diff', async () => {
    const { dir } = await setup({ 'a.bin': Buffer.from([0, 1, 2]), 'b.bin': Buffer.from([0, 1, 3]) });
    const report = await checkDrift({ groups: [{ name: 'g', files: ['*.bin'] }] }, { cwd: dir });
    expect(report.groups[0]!.files[1]).toMatchObject({ status: 'differs', message: 'binary files differ' });
  });

  it('text: whitespace-only differences agree; a real change differs with a diff', async () => {
    const { dir } = await setup({ 'a.md': '# Title\nBody\n', 'b.md': '# Title  \r\nBody\r\n\r\n', 'c.md': '# Title\nOther\n' });
    const report = await checkDrift({ groups: [{ name: 'docs', files: ['a.md', 'b.md', 'c.md'], mode: 'text' }] }, { cwd: dir });
    expect(statuses(report.groups[0]!)).toEqual({ 'a.md': 'reference', 'b.md': 'match', 'c.md': 'differs' });
    expect(report.groups[0]!.files[2]!.diff).toBe('--- a.md\n+++ c.md\n@@ -1,2 +1,2 @@\n # Title\n-Body\n+Other');
  });

  it('json: key order and formatting are ignored; values are not; invalid JSON is reported', async () => {
    const { dir } = await setup({
      'a.json': '{"name":"x","list":[1,2]}',
      'b.json': '{\n  "list": [1, 2],\n  "name": "x"\n}\n',
      'c.json': '{"name":"y","list":[1,2]}',
      'd.json': '{ not json',
    });
    const report = await checkDrift({ groups: [{ name: 'data', source: 'a.json', files: ['*.json'], mode: 'json' }] }, { cwd: dir });
    const group = report.groups[0]!;
    expect(statuses(group)).toEqual({ 'a.json': 'reference', 'b.json': 'match', 'c.json': 'differs', 'd.json': 'invalid' });
    expect(group.files[2]!.diff).toContain('-  "name": "x"\n+  "name": "y"');
    expect(group.files[3]!.message).toMatch(/not valid JSON/);
    expect(report.summary).toEqual({ groups: 1, driftedGroups: 1, files: 4, differs: 1, missing: 0, invalid: 1 });
  });

  it('defaults to bytes mode', async () => {
    const { dir } = await setup({ 'a.json': '{"a":1}', 'b.json': '{ "a": 1 }' });
    const report = await checkDrift({ groups: [{ name: 'g', files: ['a.json', 'b.json'] }] }, { cwd: dir });
    expect(report.groups[0]!.mode).toBe('bytes');
    expect(report.ok).toBe(false);
  });
});

describe('checkDrift: source and members', () => {
  it('with a source, compares every member with it and lists it first, once', async () => {
    const { dir } = await setup({ 'shared/x.txt': 'v2\n', 'web/x.txt': 'v1\n', 'api/x.txt': 'v2\n' });
    const report = await checkDrift(
      { groups: [{ name: 'x', source: 'shared/x.txt', files: ['*/x.txt'] }] },
      { cwd: dir },
    );
    const group = report.groups[0]!;
    expect(group.source).toBe('shared/x.txt');
    expect(group.reference).toBe('shared/x.txt');
    expect(statuses(group)).toEqual({ 'shared/x.txt': 'reference', 'api/x.txt': 'match', 'web/x.txt': 'differs' });
    expect(group.files[2]!.diff).toMatch(/^--- shared\/x.txt\n\+\+\+ web\/x.txt/);
  });

  it('without a source, compares with the first file found', async () => {
    const { dir } = await setup({ 'b/x.txt': 'B\n', 'a/x.txt': 'A\n', 'c/x.txt': 'A\n' });
    const report = await checkDrift({ groups: [{ name: 'x', files: ['*/x.txt'] }] }, { cwd: dir });
    const group = report.groups[0]!;
    expect(group.source).toBeUndefined();
    expect(group.reference).toBe('a/x.txt');
    expect(statuses(group)).toEqual({ 'a/x.txt': 'reference', 'b/x.txt': 'differs', 'c/x.txt': 'match' });
  });

  it('a missing member is drift; an optional one is skipped, per file or per group', async () => {
    const { dir } = await setup({ 'a.txt': 'x' });
    const strict = await checkDrift({ groups: [{ name: 'g', files: ['a.txt', 'b.txt'] }] }, { cwd: dir });
    expect(strict.groups[0]!.files[1]).toMatchObject({ status: 'missing', message: 'missing' });
    expect(strict.summary.missing).toBe(1);

    const perFile = await checkDrift({ groups: [{ name: 'g', files: ['a.txt', { path: 'b.txt', optional: true }] }] }, { cwd: dir });
    expect(perFile.ok).toBe(true);
    expect(perFile.groups[0]!.files[1]!.status).toBe('skipped');

    const perGroup = await checkDrift({ groups: [{ name: 'g', optional: true, files: ['a.txt', 'b.txt', 'none/*.txt'] }] }, { cwd: dir });
    expect(perGroup.ok).toBe(true);
    expect(perGroup.groups[0]!.files.map((f) => f.status)).toEqual(['reference', 'skipped', 'skipped']);
  });

  it('a glob matching nothing is drift unless optional', async () => {
    const { dir } = await setup({ 'a.txt': 'x' });
    const report = await checkDrift({ groups: [{ name: 'g', files: ['a.txt', 'copies/*.txt'] }] }, { cwd: dir });
    expect(report.groups[0]!.files[1]).toMatchObject({ path: 'copies/*.txt', status: 'missing', unmatched: true, message: 'the glob matched no file' });
    expect(report.summary.files).toBe(1);
  });

  it('a missing source fails the group, even when optional, and nothing is compared', async () => {
    const { dir } = await setup({ 'b.txt': 'x' });
    const report = await checkDrift({ groups: [{ name: 'g', source: 'a.txt', optional: true, files: ['b.txt'] }] }, { cwd: dir });
    expect(report.ok).toBe(false);
    expect(report.groups[0]!.reference).toBeUndefined();
    expect(report.groups[0]!.files.map((f) => [f.status, f.message])).toEqual([
      ['missing', 'the source is missing'],
      ['skipped', 'not compared: the source is missing or invalid'],
    ]);
  });

  it('a folder in place of a file is invalid', async () => {
    const { dir } = await setup({ 'a.txt': 'x', 'b.txt/inner': 'y' });
    const report = await checkDrift({ groups: [{ name: 'g', files: ['a.txt', 'b.txt'] }] }, { cwd: dir });
    expect(report.groups[0]!.files[1]).toMatchObject({ status: 'invalid', message: 'is a folder, not a file' });
  });

  it('shows paths outside the root as absolute', async () => {
    const outside = await fixture({ 'x.txt': 'x' });
    const { dir } = await setup({ 'x.txt': 'x' });
    try {
      const report = await checkDrift({ groups: [{ name: 'g', files: ['x.txt', join(outside.dir, 'x.txt')] }] }, { cwd: dir });
      expect(report.groups[0]!.files.map((f) => f.path)).toEqual(['x.txt', join(outside.dir, 'x.txt')]);
      expect(report.ok).toBe(true);
    } finally {
      await outside.cleanup();
    }
  });

  it('caps diffs at diffLines and leaves them out at 0', async () => {
    const a = Array.from({ length: 50 }, (_, i) => `a${i}`).join('\n');
    const b = Array.from({ length: 50 }, (_, i) => `b${i}`).join('\n');
    const { dir } = await setup({ 'a.txt': a, 'b.txt': b });
    const config: Config = { groups: [{ name: 'g', files: ['a.txt', 'b.txt'] }] };
    const capped = await checkDrift(config, { cwd: dir, diffLines: 4 });
    expect(capped.groups[0]!.files[1]!.diff!.split('\n')).toHaveLength(2 + 4 + 1);
    const none = await checkDrift(config, { cwd: dir, diffLines: 0 });
    expect(none.groups[0]!.files[1]!.diff).toBeUndefined();
    expect(none.groups[0]!.files[1]!.status).toBe('differs');
    const full = await checkDrift(config, { cwd: dir });
    expect(full.groups[0]!.files[1]!.diff).toMatch(/\.\.\. 81 more diff lines$/);
  });

  it('rejects an invalid config object', async () => {
    await expect(checkDrift({ groups: [] })).rejects.toThrow(/non-empty array/);
    await expect(checkDrift(defineConfig({ groups: [{ name: 'g', files: ['a'], mode: 'yaml' as never }] }))).rejects.toThrow(/"mode" must be/);
  });
});

describe('fixDrift', () => {
  const config: Config = {
    groups: [
      { name: 'content', source: 'src/c.json', files: ['web/c.json', 'api/c.json', 'cms/c.json', { path: 'extra/c.json', optional: true }], mode: 'json' },
      { name: 'loose', files: ['x/a.txt', 'y/a.txt'] },
    ],
  };
  const files = {
    'src/c.json': '{"v":2}\n',
    'web/c.json': '{"v":1}\n',
    'api/c.json': '{ "v": 2 }',
    'x/a.txt': '1',
    'y/a.txt': '2',
  };

  it('copies the source over differing members, creates missing ones, and skips groups without a source', async () => {
    const { dir } = await setup(files);
    const result = await fixDrift(config, { cwd: dir });
    expect(result.dryRun).toBe(false);
    expect(result.changes.map((c) => [c.group, c.path, c.action, c.from])).toEqual([
      ['content', 'web/c.json', 'updated', 'src/c.json'],
      ['content', 'cms/c.json', 'created', 'src/c.json'],
    ]);
    expect(result.skipped).toEqual([{ group: 'loose', reason: expect.stringMatching(/no source/) }]);
    expect(await readFile(join(dir, 'web/c.json'), 'utf8')).toBe('{"v":2}\n');
    expect(await readFile(join(dir, 'cms/c.json'), 'utf8')).toBe('{"v":2}\n');
    // Equal under json mode: left as it was. Optional and missing: not created.
    expect(await readFile(join(dir, 'api/c.json'), 'utf8')).toBe('{ "v": 2 }');
    await expect(readFile(join(dir, 'extra/c.json'))).rejects.toThrow();
    expect(result.report.groups[0]!.ok).toBe(true);
    expect(result.report.ok).toBe(false);
  });

  it('writes nothing on a dry run, and reports what it would write', async () => {
    const { dir } = await setup(files);
    const result = await fixDrift(config, { cwd: dir, dryRun: true });
    expect(result.dryRun).toBe(true);
    expect(result.changes.map((c) => c.path)).toEqual(['web/c.json', 'cms/c.json']);
    expect(await readFile(join(dir, 'web/c.json'), 'utf8')).toBe('{"v":1}\n');
    await expect(readFile(join(dir, 'cms/c.json'))).rejects.toThrow();
    expect(result.report.groups[0]!.ok).toBe(false);
  });

  it('replaces invalid members, and leaves a group alone when its source is missing', async () => {
    const { dir } = await setup({ 'src.json': '{"a":1}', 'copy.json': 'oops' });
    const fixed = await fixDrift({ groups: [{ name: 'g', source: 'src.json', files: ['copy.json'], mode: 'json' }] }, { cwd: dir });
    expect(fixed.changes[0]).toMatchObject({ path: 'copy.json', action: 'updated' });
    expect(await readFile(join(dir, 'copy.json'), 'utf8')).toBe('{"a":1}');

    const missing = await fixDrift({ groups: [{ name: 'g', source: 'gone.json', files: ['copy.json'] }] }, { cwd: dir });
    expect(missing.changes).toEqual([]);
    expect(missing.skipped).toEqual([{ group: 'g', reason: 'the source gone.json is missing' }]);
  });

  it('cannot create a file for a glob that matched nothing', async () => {
    const { dir } = await setup({ 'src.txt': 'a' });
    const result = await fixDrift({ groups: [{ name: 'g', source: 'src.txt', files: ['copies/*.txt'] }] }, { cwd: dir });
    expect(result.changes).toEqual([]);
    expect(result.skipped[0]!.reason).toMatch(/matched no file/);
  });

  it('does nothing when every group agrees', async () => {
    const { dir } = await setup({ 'a.txt': 'same', 'b.txt': 'same' });
    const result = await fixDrift({ groups: [{ name: 'g', source: 'a.txt', files: ['b.txt'] }] }, { cwd: dir });
    expect(result).toMatchObject({ changes: [], skipped: [], report: { ok: true } });
  });
});

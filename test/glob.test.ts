import { symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { expandGlob, globToRegExp, isGlob, matchesGlob } from '../src/glob.js';
import { fixture } from './helpers.js';

describe('matchesGlob', () => {
  it.each([
    ['*.json', 'a.json', true],
    ['*.json', 'dir/a.json', false],
    ['**/*.json', 'a.json', true],
    ['**/*.json', 'x/y/a.json', true],
    ['apps/**/content.json', 'apps/content.json', true],
    ['apps/**/content.json', 'apps/web/src/content.json', true],
    ['apps/*/content.json', 'apps/web/src/content.json', false],
    ['file?.txt', 'file1.txt', true],
    ['file?.txt', 'file10.txt', false],
    ['{web,api}/x.json', 'api/x.json', true],
    ['{web,api}/x.json', 'cms/x.json', false],
    ['v[0-9].md', 'v3.md', true],
    ['v[!0-9].md', 'v3.md', false],
    ['./a/*.css', 'a/b.css', true],
    ['a.b+c(d).txt', 'a.b+c(d).txt', true],
    ['a.b', 'axb', false],
    ['*.env', '.env', true],
  ])('%s against %s is %s', (glob, path, expected) => {
    expect(matchesGlob(path, glob)).toBe(expected);
  });

  it('caches compiled patterns and detects glob characters', () => {
    expect(globToRegExp('**/*.ts')).toBe(globToRegExp('**/*.ts'));
    expect(isGlob('a/b.json')).toBe(false);
    expect(isGlob('a/*.json')).toBe(true);
    expect(isGlob('a/{b,c}.json')).toBe(true);
  });
});

describe('expandGlob', () => {
  let dir: string;
  let cleanup: () => Promise<void>;
  beforeEach(async () => {
    ({ dir, cleanup } = await fixture({
      'apps/web/content.json': '{}',
      'apps/api/content.json': '{}',
      'apps/api/deep/content.json': '{}',
      'apps/node_modules/pkg/content.json': '{}',
      'apps/web/notes.txt': '',
      'root.json': '{}',
    }));
  });
  afterEach(() => cleanup());

  it('returns sorted absolute paths of matching files', async () => {
    expect(await expandGlob('apps/*/content.json', dir)).toEqual([join(dir, 'apps/api/content.json'), join(dir, 'apps/web/content.json')]);
  });

  it('walks any depth for ** and skips node_modules', async () => {
    expect(await expandGlob('apps/**/content.json', dir)).toEqual([
      join(dir, 'apps/api/content.json'),
      join(dir, 'apps/api/deep/content.json'),
      join(dir, 'apps/web/content.json'),
    ]);
  });

  it('enters node_modules when the literal part of the pattern names it', async () => {
    expect(await expandGlob('apps/node_modules/*/content.json', dir)).toEqual([join(dir, 'apps/node_modules/pkg/content.json')]);
  });

  it('accepts absolute patterns and plain paths', async () => {
    expect(await expandGlob(join(dir, '*.json'), '/somewhere/else')).toEqual([join(dir, 'root.json')]);
    expect(await expandGlob('root.json', dir)).toEqual([join(dir, 'root.json')]);
    expect(await expandGlob('missing.json', dir)).toEqual([]);
    expect(await expandGlob('nowhere/*.json', dir)).toEqual([]);
  });

  it('follows symbolic links to files', async () => {
    await symlink(join(dir, 'root.json'), join(dir, 'apps/web/link.json'));
    expect(await expandGlob('apps/web/*.json', dir)).toEqual([join(dir, 'apps/web/content.json'), join(dir, 'apps/web/link.json')]);
  });
});

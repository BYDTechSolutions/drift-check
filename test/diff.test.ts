import { describe, expect, it } from 'vitest';
import { diffLines, splitLines, unifiedDiff } from '../src/diff.js';

/** Apply a unified diff's edit script back to `a`, to prove the diff is correct. */
function apply(a: string[], b: string[]): string[] {
  return diffLines(a, b)
    .filter((op) => op.kind !== '-')
    .map((op) => op.line);
}

describe('splitLines', () => {
  it('ignores one final newline', () => {
    expect(splitLines('')).toEqual([]);
    expect(splitLines('a\nb\n')).toEqual(['a', 'b']);
    expect(splitLines('a\nb')).toEqual(['a', 'b']);
    expect(splitLines('a\n\n')).toEqual(['a', '']);
  });
});

describe('diffLines', () => {
  it('finds a shortest edit for a small change', () => {
    const ops = diffLines(['a', 'b', 'c', 'd'], ['a', 'x', 'c', 'd', 'e']);
    expect(ops.map((o) => `${o.kind}${o.line}`)).toEqual([' a', '-b', '+x', ' c', ' d', '+e']);
  });

  it('always yields b when the additions are applied to a', () => {
    const cases: Array<[string[], string[]]> = [
      [[], ['a']],
      [['a'], []],
      [['a', 'b', 'c'], ['c', 'b', 'a']],
      [['x', 'a', 'y', 'b', 'z'], ['a', 'q', 'b', 'r']],
    ];
    for (const [a, b] of cases) expect(apply(a, b)).toEqual(b);
  });

  it('falls back to remove-all/add-all past the cell cap, and is still correct', () => {
    const a = ['same', 'a1', 'a2', 'a3', 'end'];
    const b = ['same', 'b1', 'a2', 'b3', 'end'];
    const ops = diffLines(a, b, 4);
    expect(ops.map((o) => `${o.kind}${o.line}`)).toEqual([' same', '-a1', '-a2', '-a3', '+b1', '+a2', '+b3', ' end']);
    expect(apply(a, b)).toEqual(b);
  });
});

describe('unifiedDiff', () => {
  it('returns an empty string for equal text', () => {
    expect(unifiedDiff('a\nb\n', 'a\nb\n')).toBe('');
  });

  it('prints headers, hunk ranges and context like diff -u', () => {
    const a = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`).join('\n') + '\n';
    const b = a.replace('line 3\n', 'line three\n').replace('line 18\n', '');
    expect(unifiedDiff(a, b, { fromFile: 'src.txt', toFile: 'copy.txt' })).toBe(
      [
        '--- src.txt',
        '+++ copy.txt',
        '@@ -1,6 +1,6 @@',
        ' line 1',
        ' line 2',
        '-line 3',
        '+line three',
        ' line 4',
        ' line 5',
        ' line 6',
        '@@ -15,6 +15,5 @@',
        ' line 15',
        ' line 16',
        ' line 17',
        '-line 18',
        ' line 19',
        ' line 20',
      ].join('\n'),
    );
  });

  it('merges changes whose context overlaps into one hunk', () => {
    const diff = unifiedDiff('1\n2\n3\n4\n5\n', '1\nX\n3\nY\n5\n', { context: 1 });
    expect(diff.match(/^@@/gm)).toHaveLength(1);
    expect(diff).toContain('@@ -1,5 +1,5 @@');
  });

  it('uses zero-length ranges for files that are empty on one side', () => {
    expect(unifiedDiff('', 'a\nb\n')).toContain('@@ -0,0 +1,2 @@');
    expect(unifiedDiff('a\n', '')).toContain('@@ -1 +0,0 @@');
  });

  it('honors context 0', () => {
    expect(unifiedDiff('a\nb\nc\n', 'a\nB\nc\n', { context: 0 })).toBe('--- a\n+++ b\n@@ -2 +2 @@\n-b\n+B');
  });

  it('caps the body at maxLines and says how much was cut', () => {
    const a = Array.from({ length: 30 }, (_, i) => `${i}`).join('\n');
    const b = Array.from({ length: 30 }, (_, i) => `${i}!`).join('\n');
    const lines = unifiedDiff(a, b, { maxLines: 5 }).split('\n');
    expect(lines).toHaveLength(2 + 5 + 1);
    expect(lines.at(-1)).toBe('... 56 more diff lines');
  });
});

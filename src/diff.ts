/**
 * A small line-based unified diff.
 *
 * The common leading and trailing lines are trimmed first, so a small edit in
 * a large file costs little. The middle is compared with a longest common
 * subsequence table, which needs (n + 1) × (m + 1) cells; when that would pass
 * {@link DiffOptions.maxCells}, the whole middle is shown as removed and added
 * instead. The output is always a correct diff, just not always the shortest.
 */

/** Options for {@link unifiedDiff}. */
export interface DiffOptions {
  /** Label for the `---` line. Default: `a`. */
  fromFile?: string;
  /** Label for the `+++` line. Default: `b`. */
  toFile?: string;
  /** Unchanged lines of context around each change. Default: 3. */
  context?: number;
  /** Keep at most this many lines after the header, then say how many were cut. Default: no limit. */
  maxLines?: number;
  /** The largest LCS table to build before falling back to a coarse diff. Default: 4,000,000 cells. */
  maxCells?: number;
}

type Op = { kind: ' ' | '-' | '+'; line: string; a: number; b: number };

/** Split text into lines, without their line terminators. A final newline does not add an empty line. */
export function splitLines(text: string): string[] {
  if (text === '') return [];
  const lines = text.split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  return lines;
}

/**
 * The edit script turning `a` into `b`, one entry per line: `' '` kept, `'-'`
 * removed, `'+'` added. `a`/`b` are 0-based line indexes in each input.
 */
export function diffLines(a: readonly string[], b: readonly string[], maxCells = 4_000_000): Op[] {
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }

  const ops: Op[] = [];
  for (let i = 0; i < start; i++) ops.push({ kind: ' ', line: a[i]!, a: i, b: i });

  const n = endA - start;
  const m = endB - start;
  if ((n + 1) * (m + 1) > maxCells) {
    for (let i = start; i < endA; i++) ops.push({ kind: '-', line: a[i]!, a: i, b: start });
    for (let j = start; j < endB; j++) ops.push({ kind: '+', line: b[j]!, a: endA, b: j });
  } else {
    // table[i][j] = LCS length of a[start+i..endA) and b[start+j..endB)
    const width = m + 1;
    const table = new Uint32Array((n + 1) * width);
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        table[i * width + j] =
          a[start + i] === b[start + j]
            ? table[(i + 1) * width + j + 1]! + 1
            : Math.max(table[(i + 1) * width + j]!, table[i * width + j + 1]!);
      }
    }
    let i = 0;
    let j = 0;
    while (i < n && j < m) {
      if (a[start + i] === b[start + j]) {
        ops.push({ kind: ' ', line: a[start + i]!, a: start + i, b: start + j });
        i++;
        j++;
      } else if (table[(i + 1) * width + j]! >= table[i * width + j + 1]!) {
        ops.push({ kind: '-', line: a[start + i]!, a: start + i, b: start + j });
        i++;
      } else {
        ops.push({ kind: '+', line: b[start + j]!, a: start + i, b: start + j });
        j++;
      }
    }
    for (; i < n; i++) ops.push({ kind: '-', line: a[start + i]!, a: start + i, b: start + j });
    for (; j < m; j++) ops.push({ kind: '+', line: b[start + j]!, a: start + i, b: start + j });
  }

  for (let i = endA, j = endB; i < a.length; i++, j++) ops.push({ kind: ' ', line: a[i]!, a: i, b: j });
  return ops;
}

function range(start: number, count: number): string {
  // Unified diff: a zero-length range names the line before it.
  if (count === 0) return `${start},0`;
  return count === 1 ? `${start + 1}` : `${start + 1},${count}`;
}

/**
 * A unified diff from `a` to `b`, in the format `diff -u` and `git diff`
 * print. Returns an empty string when the texts have the same lines.
 */
export function unifiedDiff(a: string, b: string, options: DiffOptions = {}): string {
  const context = Math.max(0, options.context ?? 3);
  const ops = diffLines(splitLines(a), splitLines(b), options.maxCells);
  const changed = ops.map((op, i) => (op.kind === ' ' ? -1 : i)).filter((i) => i >= 0);
  if (!changed.length) return '';

  // Group changes whose context overlaps into hunks.
  const hunks: Array<[number, number]> = [];
  for (const index of changed) {
    const from = Math.max(0, index - context);
    const to = Math.min(ops.length - 1, index + context);
    const last = hunks[hunks.length - 1];
    if (last && from <= last[1] + 1) last[1] = to;
    else hunks.push([from, to]);
  }

  const body: string[] = [];
  for (const [from, to] of hunks) {
    const slice = ops.slice(from, to + 1);
    const first = slice[0]!;
    const countA = slice.filter((op) => op.kind !== '+').length;
    const countB = slice.filter((op) => op.kind !== '-').length;
    const startA = countA ? (slice.find((op) => op.kind !== '+')?.a ?? first.a) : first.a;
    const startB = countB ? (slice.find((op) => op.kind !== '-')?.b ?? first.b) : first.b;
    body.push(`@@ -${range(startA, countA)} +${range(startB, countB)} @@`);
    for (const op of slice) body.push(`${op.kind}${op.line}`);
  }

  const max = options.maxLines;
  if (max !== undefined && body.length > max) {
    const cut = body.length - max;
    body.length = max;
    body.push(`... ${cut} more diff line${cut === 1 ? '' : 's'}`);
  }
  return [`--- ${options.fromFile ?? 'a'}`, `+++ ${options.toFile ?? 'b'}`, ...body].join('\n');
}

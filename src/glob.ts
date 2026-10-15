/**
 * A small glob matcher and file finder, so the package needs no dependency
 * for it. (`fs.glob` and `path.matchesGlob` arrived in Node 22 and were
 * experimental there; `engines` starts at 20.)
 *
 * Supported: `**` (any number of path segments, including none), `*` (any run
 * of characters except `/`), `?` (one character except `/`), `{a,b}`
 * alternation (nestable), and `[abc]` / `[!abc]` classes. Patterns use `/`,
 * are matched against the whole path, and match dotfiles like any other name.
 */
import { readdir, stat } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';

const cache = new Map<string, RegExp>();
const MAGIC = /[*?[{]/;

/** True when `pattern` contains a glob character (`*`, `?`, `[` or `{`). */
export function isGlob(pattern: string): boolean {
  return MAGIC.test(pattern);
}

/** Compile a glob to an anchored regular expression over `/`-separated paths. */
export function globToRegExp(glob: string): RegExp {
  const cached = cache.get(glob);
  if (cached) return cached;
  const re = new RegExp(`^${translate(toPosix(glob).replace(/^\.\//, ''))}$`);
  cache.set(glob, re);
  return re;
}

/** True when the `/`-separated `path` matches `glob`. */
export function matchesGlob(path: string, glob: string): boolean {
  return globToRegExp(glob).test(toPosix(path).replace(/^\.\//, ''));
}

function toPosix(p: string): string {
  return p.replace(/\\/g, '/');
}

function translate(p: string): string {
  let out = '';
  let i = 0;
  while (i < p.length) {
    const c = p[i]!;
    if (c === '*') {
      if (p[i + 1] === '*') {
        const atStart = i === 0 || p[i - 1] === '/';
        const atEnd = i + 2 === p.length || p[i + 2] === '/';
        if (atStart && atEnd) {
          if (p[i + 2] === '/') {
            out += '(?:[^/]*/)*';
            i += 3;
          } else {
            out += '.*';
            i += 2;
          }
          continue;
        }
        out += '[^/]*';
        i += 2;
        continue;
      }
      out += '[^/]*';
      i++;
    } else if (c === '?') {
      out += '[^/]';
      i++;
    } else if (c === '{') {
      const end = matchingBrace(p, i);
      if (end === -1) {
        out += '\\{';
        i++;
        continue;
      }
      out += `(?:${splitTopLevel(p.slice(i + 1, end)).map(translate).join('|')})`;
      i = end + 1;
    } else if (c === '[') {
      const end = p.indexOf(']', i + 2);
      if (end === -1) {
        out += '\\[';
        i++;
        continue;
      }
      let body = p.slice(i + 1, end);
      const negate = body.startsWith('!') || body.startsWith('^');
      if (negate) body = body.slice(1);
      body = body.replace(/[\\\]^]/g, '\\$&');
      out += negate ? `[^/${body}]` : `[${body}]`;
      i = end + 1;
    } else {
      out += c.replace(/[.+^$()|\\}]/g, '\\$&');
      i++;
    }
  }
  return out;
}

function matchingBrace(p: string, open: number): number {
  let depth = 0;
  for (let i = open; i < p.length; i++) {
    if (p[i] === '{') depth++;
    else if (p[i] === '}' && --depth === 0) return i;
  }
  return -1;
}

function splitTopLevel(s: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '{') depth++;
    else if (s[i] === '}') depth--;
    else if (s[i] === ',' && depth === 0) {
      parts.push(s.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(s.slice(start));
  return parts;
}

/** Folders a glob never walks into unless the pattern names them literally. */
export const SKIPPED_DIRS: readonly string[] = ['node_modules', '.git'];

/**
 * Find the files matching `pattern`, as sorted absolute paths. A relative
 * pattern resolves against `cwd`. Only files are returned (symbolic links are
 * followed). The walk starts at the pattern's literal leading folders, goes
 * only as deep as the pattern can reach, and does not enter `node_modules` or
 * `.git` unless the pattern spells them out.
 */
export async function expandGlob(pattern: string, cwd: string): Promise<string[]> {
  const absolute = toPosix(isAbsolute(pattern) ? pattern : join(cwd, pattern));
  const segments = absolute.split('/');
  const firstMagic = segments.findIndex((s) => isGlob(s));
  if (firstMagic === -1) {
    return (await isFile(absolute)) ? [resolve(absolute)] : [];
  }
  const base = segments.slice(0, firstMagic).join('/') || '/';
  const rest = segments.slice(firstMagic);
  const maxDepth = rest.some((s) => s.includes('**')) ? Infinity : rest.length;
  const regex = globToRegExp(absolute);
  const found: string[] = [];
  await walk(base, 1, maxDepth, async (file) => {
    if (regex.test(toPosix(file))) found.push(resolve(file));
  });
  return found.sort();
}

async function walk(dir: string, depth: number, maxDepth: number, visit: (file: string) => Promise<void>): Promise<void> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = dir.endsWith('/') ? `${dir}${entry.name}` : `${dir}/${entry.name}`;
    let isDir = entry.isDirectory();
    let isFileEntry = entry.isFile();
    if (entry.isSymbolicLink()) {
      try {
        const s = await stat(full);
        isDir = s.isDirectory();
        isFileEntry = s.isFile();
      } catch {
        continue;
      }
    }
    if (isFileEntry && depth <= maxDepth) await visit(full);
    else if (isDir && depth < maxDepth && !SKIPPED_DIRS.includes(entry.name)) await walk(full, depth + 1, maxDepth, visit);
  }
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

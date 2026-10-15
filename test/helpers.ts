import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { CliIo } from '../src/run.js';

/** A temporary folder holding the given files (paths relative to it). */
export async function fixture(files: Record<string, string | Buffer> = {}): Promise<{ dir: string; write: (files: Record<string, string | Buffer>) => Promise<void>; cleanup: () => Promise<void> }> {
  const dir = await mkdtemp(join(tmpdir(), 'drift-check-test-'));
  const write = async (more: Record<string, string | Buffer>) => {
    for (const [path, content] of Object.entries(more)) {
      await mkdir(dirname(join(dir, path)), { recursive: true });
      await writeFile(join(dir, path), content);
    }
  };
  await write(files);
  return { dir, write, cleanup: () => rm(dir, { recursive: true, force: true }) };
}

export interface CapturedIo extends CliIo {
  out: () => string;
  err: () => string;
}

export function captureIo(cwd: string): CapturedIo {
  let out = '';
  let err = '';
  return {
    cwd,
    stdout: (t) => {
      out += t;
    },
    stderr: (t) => {
      err += t;
    },
    out: () => out,
    err: () => err,
  };
}

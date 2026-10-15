import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EXIT, run } from '../src/run.js';
import { VERSION } from '../src/index.js';
import { captureIo, fixture } from './helpers.js';

let dir: string;
let cleanup: () => Promise<void>;

const CONFIG = {
  groups: [
    { name: 'content', source: 'proto/services.json', files: ['web/services.json', 'api/services.json'], mode: 'json' },
    { name: 'tokens', files: ['web/tokens.css', 'admin/tokens.css'], mode: 'text' },
  ],
};

beforeEach(async () => {
  ({ dir, cleanup } = await fixture({
    'drift-check.config.json': JSON.stringify(CONFIG),
    'proto/services.json': '{"title":"Build","items":[1,2]}\n',
    'web/services.json': '{"items":[1,2],"title":"Build"}\n',
    'api/services.json': '{"title":"Build","items":[1,2]}\n',
    'web/tokens.css': ':root { --teal: #0a7; }\n',
    'admin/tokens.css': ':root { --teal: #0a7; }   \r\n',
  }));
});
afterEach(() => cleanup());

async function cli(args: string[], cwd = dir) {
  const io = captureIo(cwd);
  const code = await run(args, io);
  return { code, out: io.out(), err: io.err() };
}

describe('general', () => {
  it('prints help and the version', async () => {
    const help = await cli(['--help']);
    expect(help.code).toBe(EXIT.OK);
    expect(help.out).toMatch(/Usage:/);
    const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')) as { version: string };
    const version = await cli(['-v']);
    expect(version.out.trim()).toBe(pkg.version);
    expect(VERSION).toBe(pkg.version);
  });

  it('exits 2 on usage errors', async () => {
    expect((await cli(['--nope'])).code).toBe(EXIT.USAGE);
    expect((await cli(['extra'])).code).toBe(EXIT.USAGE);
    expect((await cli(['--format', 'xml'])).err).toMatch(/--format must be/);
    expect((await cli(['--diff-lines', '-3'])).code).toBe(EXIT.USAGE);
    expect((await cli(['--diff-lines', 'ten'])).code).toBe(EXIT.USAGE);
    const dry = await cli(['--dry-run']);
    expect(dry.code).toBe(EXIT.USAGE);
    expect(dry.err).toMatch(/only works with --fix/);
  });
});

describe('config', () => {
  it('exits 2 when there is no config file', async () => {
    const empty = await fixture();
    try {
      const result = await cli([], empty.dir);
      expect(result.code).toBe(EXIT.USAGE);
      expect(result.err).toMatch(/No config file/);
      expect((await cli(['--config', 'missing.json'], empty.dir)).err).toMatch(/Config file not found/);
    } finally {
      await empty.cleanup();
    }
  });

  it('exits 2 for an invalid config, naming the problem', async () => {
    await writeFile(join(dir, 'drift-check.config.json'), JSON.stringify({ groups: [{ name: 'g', files: ['a'], mode: 'loose' }] }));
    const result = await cli([]);
    expect(result.code).toBe(EXIT.USAGE);
    expect(result.err).toMatch(/groups\[0\] \("g"\): "mode" must be "bytes", "text", "json"/);
    await writeFile(join(dir, 'drift-check.config.json'), '{ nope');
    expect((await cli([])).err).toMatch(/Could not load/);
  });

  it('prefers drift-check.config.mjs, and resolves paths against the config file folder', async () => {
    await writeFile(
      join(dir, 'drift-check.config.mjs'),
      "export default { groups: [{ name: 'only-web', files: ['web/services.json', 'api/services.json'] }] };\n",
    );
    const result = await cli([]);
    expect(result.out).toMatch(/only-web/);
    expect(result.code).toBe(EXIT.DRIFT);

    const elsewhere = await fixture();
    try {
      const viaFlag = await cli(['--config', join(dir, 'drift-check.config.json')], elsewhere.dir);
      expect(viaFlag.code).toBe(EXIT.OK);
    } finally {
      await elsewhere.cleanup();
    }
  });
});

describe('check', () => {
  it('exits 0 when every group agrees, under each group\'s mode', async () => {
    const result = await cli([]);
    expect(result.code).toBe(EXIT.OK);
    expect(result.out).toMatch(/^ok {4}content \(json, source proto\/services\.json\)/m);
    expect(result.out).toMatch(/^ok {4}tokens \(text, no source\)/m);
    expect(result.out).toMatch(/2 groups, 5 files, all in agreement\. PASS/);
  });

  it('exits 1 on drift, naming the file and showing a diff', async () => {
    await writeFile(join(dir, 'api/services.json'), '{"title":"Built","items":[1,2]}\n');
    await writeFile(join(dir, 'admin/tokens.css'), ':root { --teal: #0b8; }\n');
    const result = await cli([]);
    expect(result.code).toBe(EXIT.DRIFT);
    expect(result.out).toMatch(/^DRIFT content/m);
    expect(result.out).toMatch(/DIFFERS {2}api\/services\.json/);
    expect(result.out).toContain('      --- proto/services.json\n      +++ api/services.json');
    expect(result.out).toContain('-  "title": "Build"\n      +  "title": "Built"');
    expect(result.out).toMatch(/first {4}web\/tokens\.css/);
    expect(result.out).toMatch(/2 of 2 groups drifted \(2 differ\)\. FAIL/);
  });

  it('exits 1 on a missing file, and 0 once it is marked optional', async () => {
    await writeFile(join(dir, 'drift-check.config.json'), JSON.stringify({ groups: [{ name: 'g', files: ['web/tokens.css', 'gone.css'] }] }));
    const missing = await cli([]);
    expect(missing.code).toBe(EXIT.DRIFT);
    expect(missing.out).toMatch(/MISSING {2}gone\.css {2}\(missing\)/);
    await writeFile(join(dir, 'drift-check.config.json'), JSON.stringify({ groups: [{ name: 'g', files: ['web/tokens.css', { path: 'gone.css', optional: true }] }] }));
    expect((await cli([])).code).toBe(EXIT.OK);
  });

  it('--diff-lines limits the diff and 0 removes it', async () => {
    await writeFile(join(dir, 'api/services.json'), '{"title":"Built","items":[3,4]}\n');
    const short = await cli(['--diff-lines', '2']);
    expect(short.out).toMatch(/more diff lines/);
    const none = await cli(['--diff-lines', '0']);
    expect(none.out).not.toContain('---');
    expect(none.code).toBe(EXIT.DRIFT);
  });

  it('--format json prints the report', async () => {
    await writeFile(join(dir, 'web/services.json'), '{"title":"Other"}');
    const result = await cli(['--format', 'json']);
    expect(result.code).toBe(EXIT.DRIFT);
    const report = JSON.parse(result.out);
    expect(report.ok).toBe(false);
    expect(report.groups[0].files[1]).toMatchObject({ path: 'web/services.json', status: 'differs' });
    expect(report.summary.differs).toBe(1);
  });

  it('--format github prints one escaped error annotation per problem', async () => {
    await writeFile(join(dir, 'web/services.json'), '{"title":"Other"}');
    await writeFile(join(dir, 'drift-check.config.json'), JSON.stringify({ groups: [CONFIG.groups[0], { name: 'x', files: ['web/tokens.css', 'nope.css'] }] }));
    const result = await cli(['-f', 'github']);
    expect(result.code).toBe(EXIT.DRIFT);
    const lines = result.out.trim().split('\n');
    expect(lines[0]).toMatch(/^::error file=web\/services\.json,title=drift-check%3A content::web\/services\.json differs from proto\/services\.json%0A--- proto/);
    expect(lines[0]).not.toContain('\n');
    expect(lines[1]).toBe('::error title=drift-check%3A x::nope.css: missing');
    expect(lines[2]).toMatch(/FAIL$/);
  });
});

describe('--fix', () => {
  beforeEach(async () => {
    await writeFile(join(dir, 'api/services.json'), '{"title":"Old"}\n');
    await writeFile(join(dir, 'admin/tokens.css'), ':root { --teal: #000; }\n');
  });

  it('copies the source, reports the group it cannot fix, and exits 1 while drift remains', async () => {
    const result = await cli(['--fix']);
    expect(result.out).toContain('content: api/services.json updated from proto/services.json');
    expect(result.out).toMatch(/tokens: not fixed, no source/);
    expect(result.out).toMatch(/1 file written/);
    expect(result.code).toBe(EXIT.DRIFT);
    expect(await readFile(join(dir, 'api/services.json'), 'utf8')).toBe('{"title":"Build","items":[1,2]}\n');
  });

  it('exits 0 once everything agrees', async () => {
    await writeFile(join(dir, 'admin/tokens.css'), ':root { --teal: #0a7; }\n');
    const result = await cli(['--fix']);
    expect(result.code).toBe(EXIT.OK);
    expect(result.out).toMatch(/PASS$/m);
    expect((await cli([])).code).toBe(EXIT.OK);
  });

  it('--dry-run writes nothing and exits 1 when something would change', async () => {
    await writeFile(join(dir, 'admin/tokens.css'), ':root { --teal: #0a7; }\n');
    const result = await cli(['--fix', '--dry-run']);
    expect(result.code).toBe(EXIT.DRIFT);
    expect(result.out).toContain('content: api/services.json would be updated from proto/services.json');
    expect(result.out).toMatch(/nothing was changed/);
    expect(await readFile(join(dir, 'api/services.json'), 'utf8')).toBe('{"title":"Old"}\n');
  });

  it('--dry-run exits 0 when there is nothing to do', async () => {
    await writeFile(join(dir, 'api/services.json'), '{"title":"Build","items":[1,2]}\n');
    await writeFile(join(dir, 'admin/tokens.css'), ':root { --teal: #0a7; }\n');
    const result = await cli(['--fix', '--dry-run']);
    expect(result.code).toBe(EXIT.OK);
    expect(result.out).toMatch(/nothing to fix/);
  });

  it('--format json prints the fix result', async () => {
    const result = await cli(['--fix', '--dry-run', '--format', 'json']);
    const parsed = JSON.parse(result.out);
    expect(parsed.dryRun).toBe(true);
    expect(parsed.changes).toHaveLength(1);
    expect(parsed.skipped[0].group).toBe('tokens');
  });
});

describe('examples', () => {
  it('the three-apps example passes', async () => {
    const result = await cli(['--config', 'examples/three-apps/drift-check.config.json'], fileURLToPath(new URL('..', import.meta.url)));
    expect(result.code).toBe(EXIT.OK);
  });

  it('the .mjs example is a valid config', async () => {
    const { validateConfig } = await import('../src/index.js');
    // @ts-expect-error: a plain .mjs file has no type declarations
    const { default: config } = (await import('../examples/drift-check.config.mjs')) as { default: unknown };
    expect(() => validateConfig(config)).not.toThrow();
  });
});

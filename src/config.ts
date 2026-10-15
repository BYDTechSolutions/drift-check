import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { isGlob } from './glob.js';
import type { Config, Mode } from './types.js';

/** Thrown for a missing or invalid config, or bad options. The CLI exits with code 2 on it. */
export class DriftConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DriftConfigError';
  }
}

/** File names looked for in the working folder, in this order. */
export const CONFIG_FILES = ['drift-check.config.mjs', 'drift-check.config.js', 'drift-check.config.json'] as const;

/** The comparison modes. */
export const MODES: readonly Mode[] = ['bytes', 'text', 'json'];

/**
 * Type helper for a config file. Returns its argument unchanged.
 *
 * @example
 * ```js
 * // drift-check.config.mjs
 * import { defineConfig } from '@bydtech/drift-check';
 * export default defineConfig({
 *   groups: [{ name: 'content', source: 'shared/content.json', files: ['web/content.json', 'api/content.json'], mode: 'json' }],
 * });
 * ```
 */
export function defineConfig(config: Config): Config {
  return config;
}

/** What {@link loadConfig} found. */
export interface LoadedConfig {
  config: Config;
  /** The config file's absolute path. */
  path: string;
  /** The config file's folder: the root that relative paths in it resolve against. */
  root: string;
}

/**
 * Load and validate a config file: `path` when given, otherwise the first of
 * {@link CONFIG_FILES} in `cwd`. A `.mjs`/`.js` file must default-export the
 * config. Throws {@link DriftConfigError} when there is none or it is invalid.
 */
export async function loadConfig(options: { cwd?: string; path?: string } = {}): Promise<LoadedConfig> {
  const cwd = options.cwd ?? process.cwd();
  let file: string | undefined;
  if (options.path) {
    file = resolve(cwd, options.path);
    if (!existsSync(file)) throw new DriftConfigError(`Config file not found: ${options.path}`);
  } else {
    file = CONFIG_FILES.map((name) => resolve(cwd, name)).find((p) => existsSync(p));
    if (!file) throw new DriftConfigError(`No config file: looked for ${CONFIG_FILES.join(', ')} in ${cwd}. Pass --config <path>.`);
  }

  let loaded: unknown;
  try {
    if (file.endsWith('.json')) {
      loaded = JSON.parse(await readFile(file, 'utf8'));
    } else {
      const mod = (await import(pathToFileURL(file).href)) as { default?: unknown };
      loaded = mod.default;
    }
  } catch (error) {
    throw new DriftConfigError(`Could not load ${file}: ${(error as Error).message}`);
  }
  validateConfig(loaded, file);
  return { config: loaded, path: file, root: dirname(file) };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Throw a {@link DriftConfigError} naming the first problem in `config`; otherwise narrow it to {@link Config}. */
export function validateConfig(config: unknown, source = 'config'): asserts config is Config {
  if (!isObject(config)) throw new DriftConfigError(`${source} must be an object with "groups" (use \`export default\` in a .mjs file)`);
  for (const key of Object.keys(config)) {
    if (key !== 'groups' && key !== '$schema') throw new DriftConfigError(`${source}: unknown option "${key}"`);
  }
  const groups = config.groups;
  if (!Array.isArray(groups) || groups.length === 0) throw new DriftConfigError(`${source}: "groups" must be a non-empty array`);
  const names = new Set<string>();
  groups.forEach((group: unknown, i) => {
    let where = `${source}: groups[${i}]`;
    if (!isObject(group)) throw new DriftConfigError(`${where} must be an object`);
    for (const key of Object.keys(group)) {
      if (!['name', 'source', 'files', 'mode', 'optional'].includes(key)) throw new DriftConfigError(`${where}: unknown option "${key}"`);
    }
    if (typeof group.name !== 'string' || !group.name.trim()) throw new DriftConfigError(`${where} needs a "name"`);
    if (names.has(group.name)) throw new DriftConfigError(`${where}: duplicate group name "${group.name}"`);
    names.add(group.name);
    where = `${where} ("${group.name}")`;
    if (group.mode !== undefined && !MODES.includes(group.mode as Mode)) {
      throw new DriftConfigError(`${where}: "mode" must be ${MODES.map((m) => `"${m}"`).join(', ')}`);
    }
    if (group.optional !== undefined && typeof group.optional !== 'boolean') throw new DriftConfigError(`${where}: "optional" must be true or false`);
    if (group.source !== undefined) {
      if (typeof group.source !== 'string' || !group.source) throw new DriftConfigError(`${where}: "source" must be a path`);
      if (isGlob(group.source)) throw new DriftConfigError(`${where}: "source" must be a single path, not a glob ("${group.source}")`);
    }
    if (!Array.isArray(group.files) || group.files.length === 0) throw new DriftConfigError(`${where}: "files" must be a non-empty array`);
    group.files.forEach((entry: unknown, j) => {
      const at = `${where}: files[${j}]`;
      if (typeof entry === 'string') {
        if (!entry) throw new DriftConfigError(`${at} is empty`);
        return;
      }
      if (!isObject(entry)) throw new DriftConfigError(`${at} must be a path or { "path", "optional" }`);
      for (const key of Object.keys(entry)) {
        if (key !== 'path' && key !== 'optional') throw new DriftConfigError(`${at}: unknown option "${key}"`);
      }
      if (typeof entry.path !== 'string' || !entry.path) throw new DriftConfigError(`${at} needs a "path"`);
      if (entry.optional !== undefined && typeof entry.optional !== 'boolean') throw new DriftConfigError(`${at}: "optional" must be true or false`);
    });
  });
}

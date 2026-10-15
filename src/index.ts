/**
 * Fail CI when files that must stay identical across folders or repos have
 * drifted apart, and copy the source of truth back over them.
 *
 * @packageDocumentation
 */
export { DEFAULT_DIFF_LINES, checkDrift, fixDrift } from './check.js';
export { InvalidContentError, canonicalJson, isBinary, normalizeText } from './compare.js';
export { CONFIG_FILES, DriftConfigError, MODES, defineConfig, loadConfig, validateConfig, type LoadedConfig } from './config.js';
export { diffLines, splitLines, unifiedDiff, type DiffOptions } from './diff.js';
export { FORMATS, formatFix, formatReport, summaryLine, type Format } from './format.js';
export { SKIPPED_DIRS, expandGlob, globToRegExp, isGlob, matchesGlob } from './glob.js';
export type {
  CheckOptions,
  Config,
  FileEntry,
  FileReport,
  FileStatus,
  FixChange,
  FixOptions,
  FixResult,
  FixSkip,
  Group,
  GroupReport,
  Mode,
  Report,
} from './types.js';
export { VERSION } from './version.js';

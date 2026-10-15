import type { Mode } from './types.js';

/** Thrown by {@link normalize} when a file is not valid JSON in `json` mode. */
export class InvalidContentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidContentError';
  }
}

/**
 * Text-mode normalization: drop a UTF-8 byte order mark, turn CRLF and CR into
 * LF, remove spaces and tabs at the end of each line, and end the text with
 * exactly one newline (none for an empty file).
 */
export function normalizeText(text: string): string {
  const lines = text
    .replace(/^﻿/, '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/, ''));
  while (lines.length && lines[lines.length - 1] === '') lines.pop();
  return lines.length ? `${lines.join('\n')}\n` : '';
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) out[key] = sortKeys((value as Record<string, unknown>)[key]);
    return out;
  }
  return value;
}

/**
 * JSON printed canonically: keys sorted at every level, two-space indent,
 * a final newline. Two documents with the same data give the same string.
 */
export function canonicalJson(text: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.replace(/^﻿/, ''));
  } catch (error) {
    throw new InvalidContentError(`not valid JSON (${(error as Error).message})`);
  }
  return `${JSON.stringify(sortKeys(parsed), null, 2)}\n`;
}

/** True when the buffer looks binary: a NUL byte in its first 8,000 bytes, as git decides. */
export function isBinary(bytes: Buffer): boolean {
  return bytes.subarray(0, 8000).includes(0);
}

/**
 * The form two members are compared in, for a mode. `bytes` compares the
 * buffers themselves; `text` and `json` compare the returned strings.
 * Throws {@link InvalidContentError} for invalid JSON.
 */
export function normalize(bytes: Buffer, mode: Mode): Buffer | string {
  if (mode === 'bytes') return bytes;
  const text = bytes.toString('utf8');
  return mode === 'text' ? normalizeText(text) : canonicalJson(text);
}

/** Whether two normalized forms are equal. */
export function same(a: Buffer | string, b: Buffer | string): boolean {
  if (Buffer.isBuffer(a) && Buffer.isBuffer(b)) return a.equals(b);
  return a === b;
}

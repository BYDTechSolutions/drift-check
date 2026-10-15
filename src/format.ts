import type { FileReport, FixResult, Report } from './types.js';

/** Output formats. */
export type Format = 'text' | 'json' | 'github';

/** The formats, for validation. */
export const FORMATS: readonly Format[] = ['text', 'json', 'github'];

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

function indent(text: string, by = '      '): string {
  return text
    .split('\n')
    .map((line) => `${by}${line}`)
    .join('\n');
}

/** Escape a GitHub workflow command's message. */
function ghData(s: string): string {
  return s.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
}

/** Escape a GitHub workflow command's property value. */
function ghProp(s: string): string {
  return ghData(s).replace(/:/g, '%3A').replace(/,/g, '%2C');
}

const LABEL: Record<FileReport['status'], string> = {
  reference: 'source',
  match: 'same',
  differs: 'DIFFERS',
  missing: 'MISSING',
  skipped: 'skipped',
  invalid: 'INVALID',
};

function isProblem(file: FileReport): boolean {
  return file.status === 'differs' || file.status === 'missing' || file.status === 'invalid';
}

/** The last line of a text report: what was checked and whether it passed. */
export function summaryLine(report: Report): string {
  const s = report.summary;
  if (report.ok) return `drift-check: ${plural(s.groups, 'group')}, ${plural(s.files, 'file')}, all in agreement. PASS`;
  const parts: string[] = [];
  if (s.differs) parts.push(`${s.differs} differ${s.differs === 1 ? 's' : ''}`);
  if (s.missing) parts.push(`${s.missing} missing`);
  if (s.invalid) parts.push(`${s.invalid} invalid`);
  return `drift-check: ${s.driftedGroups} of ${plural(s.groups, 'group')} drifted (${parts.join(', ')}). FAIL`;
}

function problemSentence(file: FileReport, reference: string | undefined): string {
  if (file.status === 'differs') return `${file.path} differs from ${reference ?? 'the reference'}${file.message ? `: ${file.message}` : ''}`;
  return `${file.path}: ${file.message ?? file.status}`;
}

/** Render a check report for the terminal, a machine (`json`), or GitHub Actions annotations (`github`). */
export function formatReport(report: Report, format: Format = 'text'): string {
  if (format === 'json') return JSON.stringify(report, null, 2);

  const lines: string[] = [];
  if (format === 'github') {
    for (const group of report.groups) {
      for (const file of group.files.filter(isProblem)) {
        // An annotation on a missing file cannot point at it; GitHub shows it in the run summary instead.
        const props = [file.status === 'missing' ? undefined : `file=${ghProp(file.path)}`, `title=${ghProp(`drift-check: ${group.name}`)}`]
          .filter(Boolean)
          .join(',');
        const body = file.diff ? `${problemSentence(file, group.reference)}\n${file.diff}` : problemSentence(file, group.reference);
        lines.push(`::error ${props}::${ghData(body)}`);
      }
    }
    lines.push(summaryLine(report));
    return lines.join('\n');
  }

  for (const group of report.groups) {
    const how = group.source !== undefined ? `${group.mode}, source ${group.source}` : `${group.mode}, no source`;
    lines.push(`${group.ok ? 'ok   ' : 'DRIFT'} ${group.name} (${how})`);
    for (const file of group.files) {
      lines.push(`    ${LABEL[file.status].padEnd(7)}  ${file.path}${file.message ? `  (${file.message})` : ''}`);
      if (file.diff) lines.push(indent(file.diff));
    }
  }
  lines.push('', summaryLine(report));
  return lines.join('\n');
}

/** Render the result of `fixDrift`: one line per file written (or that would be), the groups left alone, then the check summary. */
export function formatFix(result: FixResult, format: Format = 'text'): string {
  if (format === 'json') return JSON.stringify(result, null, 2);
  const lines: string[] = [];
  const verb = (action: 'updated' | 'created') => (result.dryRun ? `would be ${action}` : action);
  for (const change of result.changes) lines.push(`${change.group}: ${change.path} ${verb(change.action)} from ${change.from}`);
  for (const skip of result.skipped) lines.push(`${skip.group}: not fixed, ${skip.reason}`);
  const n = result.changes.length;
  if (!n && !result.skipped.length) lines.push('drift-check: nothing to fix.');
  else if (result.dryRun) lines.push(`drift-check: dry run, ${plural(n, 'file')} would be written; nothing was changed.`);
  else lines.push(`drift-check: ${plural(n, 'file')} written.`);
  if (format === 'github') {
    for (const skip of result.skipped) lines.push(`::error title=${ghProp(`drift-check: ${skip.group}`)}::${ghData(`not fixed, ${skip.reason}`)}`);
  }
  if (!result.dryRun) lines.push(summaryLine(result.report));
  return lines.join('\n');
}

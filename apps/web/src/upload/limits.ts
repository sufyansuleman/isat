/** Online limits for file upload. Checked before any parsing; nothing is partially processed. */
export const MAX_FILE_BYTES = 25 * 1024 * 1024;
export const MAX_DATA_ROWS = 100_000;
export const LIMIT_MESSAGE =
  'File exceeds the online limit (100,000 rows / 25 MB). For more than 100,000 individuals, use the ISAT command-line tool for Linux (in preparation).';
export const CHUNK_ROWS = 1000;

export type LimitCheck = { ok: true } | { ok: false; message: string };
const REJECT: LimitCheck = { ok: false, message: LIMIT_MESSAGE };

/** Size check on the File object, before reading it. */
export function checkFileSize(size: number): LimitCheck {
  return size > MAX_FILE_BYTES ? REJECT : { ok: true };
}

/** Fast data-row count (header excluded) from a newline count; trailing blank lines are ignored. */
export function countDataRows(text: string): number {
  const t = text.trimEnd();
  if (t === '') return 0;
  let nl = 0, k = -1;
  while ((k = t.indexOf('\n', k + 1)) !== -1) nl++;
  return nl; // lines = nl + 1; data rows = lines - 1
}

/** Row-count check on the file text, before parsing. */
export function checkRowCount(text: string): LimitCheck {
  return countDataRows(text) > MAX_DATA_ROWS ? REJECT : { ok: true };
}

export function hasAllowedExtension(name: string): boolean {
  return /\.(csv|tsv)$/i.test(name);
}

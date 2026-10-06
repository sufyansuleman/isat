// Shared composition of "transformed columns" in a results CSV (used by the web export and the CLI `transform` command),
// and quote-aware raw record splitting for reading results files back. Pure; no file or DOM access.

/** CSV cell for a transformed value ('' = missing). */
export const transformedCell = (t: number): string => (Number.isNaN(t) ? '' : String(t));

/**
 * Fields with one extra field inserted directly after each position in `pos` (ascending, distinct).
 * Header and data rows both go through this, so a column and its transformed twin always sit together.
 */
export function insertAfter(fields: string[], pos: number[], extra: string[]): string[] {
  const out: string[] = [];
  let j = 0;
  for (let k = 0; k < fields.length; k++) {
    out.push(fields[k]!);
    if (j < pos.length && pos[j] === k) { out.push(extra[j]!); j++; }
  }
  return out;
}

/** Header fields -> header fields with `<name><suffix>` after each transformed column. */
export function transformedHeaderFields(header: string[], pos: number[], suffix: string): string[] {
  return insertAfter(header, pos, pos.map((p) => header[p]! + suffix));
}

/** One data record (raw CSV fields) -> fields with the transformed cells inserted; tvals[j] belongs to pos[j]. */
export function transformedRowFields(fields: string[], pos: number[], tvals: ArrayLike<number>): string[] {
  const extra: string[] = new Array(pos.length);
  for (let j = 0; j < pos.length; j++) extra[j] = transformedCell(tvals[j]!);
  return insertAfter(fields, pos, extra);
}

/** The transform block of the settings file (shape shared by the web and the CLI). */
export interface TransformBlockInput { kind: string; withinSex: boolean; addedColumns: boolean; suffix: string }
export function transformBlock(t: TransformBlockInput | undefined): Record<string, unknown> {
  if (!t || t.kind === 'none') return { kind: 'none' };
  return {
    kind: t.kind, within_sex: t.withinSex, applied_to: 'oriented values (as in the results CSV)',
    transformed_columns_added: t.addedColumns, column_suffix: t.suffix,
    blom_offset: 0.375, log_base: 'e', z_sd: 'sample (n - 1)',
  };
}

// ---------- raw record splitting (quotes kept) ----------

/** Splits one CSV record into raw fields (surrounding quotes and doubled quotes kept as written). */
export function splitRawFields(rec: string, delim = ','): string[] {
  if (rec.indexOf('"') < 0) return rec.split(delim);
  const out: string[] = [];
  const n = rec.length;
  let i = 0;
  for (;;) {
    let j = i;
    if (rec.charCodeAt(i) === 34) {
      j = i + 1;
      for (;;) {
        const k = rec.indexOf('"', j);
        if (k < 0) { j = n; break; }
        if (rec.charCodeAt(k + 1) === 34) { j = k + 2; continue; }
        j = k + 1; break;
      }
    }
    const d = rec.indexOf(delim, j);
    if (d < 0) { out.push(rec.slice(i)); return out; }
    out.push(rec.slice(i, d));
    i = d + 1;
  }
}

/** Field text as the value it represents (quotes removed, doubled quotes collapsed). */
export function unquoteField(f: string): string {
  return f.charCodeAt(0) === 34 && f.length >= 2 && f.charCodeAt(f.length - 1) === 34 ? f.slice(1, -1).replace(/""/g, '"') : f;
}

/**
 * A block ending on a row boundary (from RowSplitter) -> records as raw fields. Records end at LF or CRLF
 * outside quotes (the line ending of every ISAT results file); blank records are dropped.
 */
export function splitRawRecords(block: string, delim = ','): string[][] {
  const out: string[][] = [];
  const n = block.length;
  let i = 0;
  let nq = block.indexOf('"'); // next quote at or after i (-1 = none)
  while (i < n) {
    let nl = block.indexOf('\n', i);
    let q = 0; // quotes seen in [i, nl)
    for (;;) {
      if (nl < 0) break;
      while (nq >= 0 && nq < nl) { q++; nq = block.indexOf('"', nq + 1); }
      if ((q & 1) === 0) break; // odd -> this newline is inside a quoted field
      nl = block.indexOf('\n', nl + 1);
    }
    const end = nl < 0 ? n : nl;
    let e = end;
    if (e > i && block.charCodeAt(e - 1) === 13) e--;
    if (e > i) out.push(splitRawFields(block.slice(i, e), delim));
    i = end + 1;
  }
  return out;
}

/** Number of non-blank records in a block ending on a row boundary (same notion of a record as the parser; no allocation per record). */
export function countRecords(block: string): number {
  let count = 0, inQ = false, has = false;
  const n = block.length;
  for (let i = 0; i < n; i++) {
    const c = block.charCodeAt(i);
    if (c === 34) { inQ = !inQ; has = true; }
    else if (!inQ && (c === 10 || c === 13)) {
      if (c === 13 && block.charCodeAt(i + 1) === 10) i++;
      if (has) count++;
      has = false;
    } else has = true;
  }
  if (has) count++;
  return count;
}

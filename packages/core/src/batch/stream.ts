// Streaming batch path: text arrives in pieces; rows are parsed, calculated and written out chunk by chunk.
// Runtime-agnostic (no file or DOM access). Output is built from the same helpers as composeCsv, so it is identical.
import type { ConversionSettings } from '../units';
import type { Inputs } from '../types';
import {
  DELIMS, classifyColumn, columnConflicts, dataColumns, detectDelimiter, parseBody, processRow, toCanonical,
  type ColumnInfo, type DataCol, type DelimiterName, type UnitChoice,
} from './parse';
import { csvChunkText, csvHead, emptyCounts, mergeCounts, processChunk, type AvignonUse, type Counts } from './batch';

/**
 * Incremental row splitter: feed text, get back blocks that end on a row boundary (a newline outside double quotes).
 * Quotes are tracked by parity, so a quoted field may contain newlines.
 */
export class RowSplitter {
  private buf = '';
  private scanned = 0;
  private inQ = false;
  private boundary = 0;

  /** Returns text ending on a row boundary ('' when none is complete yet). */
  push(text: string): string {
    this.buf += text;
    const b = this.buf;
    let i = this.scanned;
    for (; i < b.length; i++) {
      const c = b.charCodeAt(i);
      if (c === 34) this.inQ = !this.inQ;
      else if (!this.inQ) {
        if (c === 10) this.boundary = i + 1;
        else if (c === 13) {
          if (i + 1 >= b.length) break; // wait: may be the first half of CRLF
          if (b.charCodeAt(i + 1) !== 10) this.boundary = i + 1;
        }
      }
    }
    this.scanned = i;
    if (this.boundary === 0) return '';
    const out = b.slice(0, this.boundary);
    this.buf = b.slice(this.boundary);
    this.scanned -= this.boundary;
    this.boundary = 0;
    return out;
  }

  /** The remaining text (a final row without newline). */
  end(): string {
    const out = this.buf;
    this.buf = ''; this.scanned = 0; this.inQ = false; this.boundary = 0;
    return out;
  }
}

/** One parsed data row, values still in the units used in the file. */
export interface StreamRow {
  /** 1-based data row number. */
  n: number;
  id: string;
  inputs: Inputs;
  /** Input-problem messages for this row (empty when none). */
  msgs: string[];
}

export interface RowStreamOptions { delimiter?: DelimiterName | 'auto'; }

/** Header once, then rows: push text pieces, receive parsed rows. */
export class RowStream {
  delimiter: DelimiterName | undefined;
  header: string[] | undefined;
  columns: ColumnInfo[] = [];
  fileErrors: string[] = [];
  idCol = -1;
  /** Data rows seen so far. */
  rows = 0;
  private dataCols: DataCol[] = [];
  private readonly splitter = new RowSplitter();
  private readonly forced: DelimiterName | undefined;
  private first = true;

  constructor(opts: RowStreamOptions = {}) {
    this.forced = opts.delimiter && opts.delimiter !== 'auto' ? opts.delimiter : undefined;
  }

  get generatedIds(): boolean { return this.idCol < 0; }

  push(text: string): StreamRow[] {
    if (this.first && text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    if (text !== '') this.first = false;
    return this.parse(this.splitter.push(text));
  }

  end(): StreamRow[] { return this.parse(this.splitter.end()); }

  private parse(block: string): StreamRow[] {
    if (block === '') return [];
    if (!this.delimiter) this.delimiter = this.forced ?? detectDelimiter(block);
    const table = parseBody(block, DELIMS[this.delimiter]);
    let start = 0;
    if (!this.header) {
      if (!table.length) return [];
      this.header = table[0]!;
      this.columns = this.header.map(classifyColumn);
      this.idCol = this.columns.findIndex((c) => c.kind === 'id');
      this.dataCols = dataColumns(this.columns);
      this.fileErrors = columnConflicts(this.columns);
      start = 1;
    }
    const out: StreamRow[] = [];
    for (let r = start; r < table.length; r++) {
      const n = ++this.rows;
      const pr = processRow(table[r]!, n, this.idCol, this.dataCols);
      out.push({ n, id: pr.id, inputs: pr.inputs, msgs: pr.msgs });
    }
    return out;
  }
}

export interface ResultsStreamOptions {
  units: UnitChoice;
  settings: Partial<ConversionSettings>;
  av: AvignonUse;
  orientation: 'published' | 'sensitivity';
  includeStatus: boolean;
}

/** Calculates parsed rows and returns CSV text identical to composeCsv for the same rows. Holds only counters. */
export class ResultsStream {
  readonly counts: Counts = emptyCounts();
  written = 0;
  withProblems = 0;
  constructor(private readonly o: ResultsStreamOptions) {}

  /** Header line (with line ending). */
  header(): string { return csvHead(this.o.orientation, this.o.includeStatus); }

  /** CSV lines for these rows ('' when there are none). */
  rows(rows: StreamRow[]): string {
    if (!rows.length) return '';
    const { units, settings, av, orientation, includeStatus } = this.o;
    const canonical = rows.map((r) => toCanonical(r.inputs, units, settings));
    const { payload, counts } = processChunk(canonical, rows.map((r) => r.id), settings, av, rows.map((r) => r.msgs.join(' | ')));
    mergeCounts(this.counts, counts);
    this.written += rows.length;
    for (const r of rows) if (r.msgs.length) this.withProblems++;
    return csvChunkText(payload, orientation, includeStatus);
  }
}

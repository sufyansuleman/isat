// File helpers shared by the commands. Node built-ins only.
import { closeSync, existsSync, openSync, readSync, renameSync, statSync, unlinkSync, writeSync } from 'node:fs';
import { resolve } from 'node:path';

/** File or data error (exit code 2). */
export class DataError extends Error {}

export const READ_BYTES = 1024 * 1024;
export const WRITE_BYTES = 1024 * 1024;
export const PROGRESS_ROWS = 100_000;

export const fmtN = (n: number) => n.toLocaleString('en-GB');

/** results.csv -> results.settings.json (extension replaced, other names get the suffix appended). */
export function settingsPathFor(output: string): string {
  return output.replace(/\.(csv|tsv|txt)$/i, '') + '.settings.json';
}

export function* readPieces(path: string): Generator<string> {
  let fd: number;
  try { fd = openSync(path, 'r'); } catch (e) { throw new DataError(`cannot read ${path}: ${(e as NodeJS.ErrnoException).code ?? String(e)}`); }
  try {
    const buf = new Uint8Array(READ_BYTES);
    const dec = new TextDecoder('utf-8');
    for (;;) {
      const n = readSync(fd, buf, 0, buf.length, null);
      if (n === 0) break;
      const s = dec.decode(buf.subarray(0, n), { stream: true });
      if (s !== '') yield s;
    }
    const tail = dec.decode();
    if (tail !== '') yield tail;
  } finally { closeSync(fd); }
}

export function checkInput(path: string): void {
  if (!existsSync(path)) throw new DataError(`file not found: ${path}`);
  if (!statSync(path).isFile()) throw new DataError(`not a file: ${path}`);
}

/** Output must not be one of the inputs and must not exist unless --force. */
export function guardOutputs(inputs: string[], outputs: string[], force: boolean): void {
  for (const o of outputs) {
    for (const i of inputs) if (resolve(o) === resolve(i)) throw new DataError(`the output file is an input file: ${o}`);
    if (existsSync(o) && !force) throw new DataError(`${o} already exists (use --force to overwrite)`);
  }
}

/** Buffered writer to <path>.partial, renamed to <path> on commit (removed on abort). */
export class OutFile {
  private fd: number;
  private pending = '';
  private readonly tmp: string;
  constructor(readonly path: string) {
    this.tmp = path + '.partial';
    try { this.fd = openSync(this.tmp, 'w'); } catch (e) { throw new DataError(`cannot write ${this.tmp}: ${(e as NodeJS.ErrnoException).code ?? String(e)}`); }
  }
  write(s: string): void {
    this.pending += s;
    if (this.pending.length >= WRITE_BYTES) this.flush();
  }
  /** Raw bytes (used by merge to copy chunk files unchanged). */
  writeBytes(b: Uint8Array): void { this.flush(); writeSync(this.fd, b); }
  private flush(): void { if (this.pending !== '') { writeSync(this.fd, this.pending); this.pending = ''; } }
  commit(): void { this.flush(); closeSync(this.fd); this.fd = -1; renameSync(this.tmp, this.path); }
  abort(): void {
    if (this.fd >= 0) { try { closeSync(this.fd); } catch { /* already closed */ } this.fd = -1; }
    try { unlinkSync(this.tmp); } catch { /* nothing written */ }
  }
}

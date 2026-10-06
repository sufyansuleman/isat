// Compact participant ID -> small integer table (open addressing; the IDs are stored once as UTF-16 code units).
// About 25 bytes per ID instead of ~150 for a Map<string, number>, which matters at 1,000,000 rows.

export class IdTable {
  private slots: Int32Array;      // entry index + 1 (0 = empty)
  private mask: number;
  private starts: Uint32Array;    // entry k = chars[starts[k], starts[k + 1])
  private hashes: Uint32Array;
  private values: Uint8Array;
  private chars: Uint16Array;
  private nChars = 0;
  n = 0;

  constructor(capacity = 1024) {
    let cap = 16;
    while (cap < capacity * 2) cap *= 2;
    this.slots = new Int32Array(cap);
    this.mask = cap - 1;
    this.starts = new Uint32Array(capacity + 1);
    this.hashes = new Uint32Array(capacity);
    this.values = new Uint8Array(capacity);
    this.chars = new Uint16Array(capacity * 8);
  }

  private static hash(s: string): number {
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
    return (h ^ (h >>> 15)) >>> 0;
  }

  private equals(k: number, s: string): boolean {
    const a = this.starts[k]!;
    if (this.starts[k + 1]! - a !== s.length) return false;
    for (let i = 0; i < s.length; i++) if (this.chars[a + i] !== s.charCodeAt(i)) return false;
    return true;
  }

  /** Entry index of `s`, or -1. */
  find(s: string): number {
    const h = IdTable.hash(s);
    for (let i = h & this.mask; ; i = (i + 1) & this.mask) {
      const e = this.slots[i]!;
      if (e === 0) return -1;
      if (this.hashes[e - 1] === h && this.equals(e - 1, s)) return e - 1;
    }
  }

  value(k: number): number { return this.values[k]!; }
  setValue(k: number, v: number): void { this.values[k] = v; }

  /** Adds `s` with value `v` and returns true, or returns false when it is already there. */
  add(s: string, v: number): boolean {
    const h = IdTable.hash(s);
    let i = h & this.mask;
    for (; this.slots[i] !== 0; i = (i + 1) & this.mask) {
      const e = this.slots[i]! - 1;
      if (this.hashes[e] === h && this.equals(e, s)) return false;
    }
    if (this.n + 1 > this.hashes.length) { this.growEntries(); return this.add(s, v); }
    if (this.nChars + s.length > this.chars.length) this.growChars(s.length);
    const k = this.n++;
    for (let c = 0; c < s.length; c++) this.chars[this.nChars + c] = s.charCodeAt(c);
    this.starts[k] = this.nChars;
    this.nChars += s.length;
    this.starts[k + 1] = this.nChars;
    this.hashes[k] = h;
    this.values[k] = v;
    this.slots[i] = k + 1;
    if ((this.n + 1) * 2 > this.slots.length) this.rehash(this.slots.length * 2);
    return true;
  }

  private growEntries(): void {
    const cap = this.hashes.length * 2;
    const st = new Uint32Array(cap + 1); st.set(this.starts); this.starts = st;
    const hs = new Uint32Array(cap); hs.set(this.hashes); this.hashes = hs;
    const vs = new Uint8Array(cap); vs.set(this.values); this.values = vs;
    if (cap * 2 > this.slots.length) this.rehash(this.slots.length * 2);
  }

  private growChars(extra: number): void {
    const c = new Uint16Array(Math.max(this.chars.length * 2, this.nChars + extra));
    c.set(this.chars.subarray(0, this.nChars));
    this.chars = c;
  }

  private rehash(size: number): void {
    this.slots = new Int32Array(size);
    this.mask = size - 1;
    for (let k = 0; k < this.n; k++) {
      let i = this.hashes[k]! & this.mask;
      while (this.slots[i] !== 0) i = (i + 1) & this.mask;
      this.slots[i] = k + 1;
    }
  }
}

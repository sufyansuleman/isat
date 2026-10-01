export function esc(s: unknown): string {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** 4 significant figures; never exponent notation for ordinary magnitudes. */
export function fmt4(v: number): string {
  const s = v.toPrecision(4);
  return s.includes('e') ? String(Number(s)) : s;
}

/** Round to 15 significant digits to drop binary conversion noise (used when filling forms). */
export function clean(v: number): string {
  return String(Number(v.toPrecision(15)));
}

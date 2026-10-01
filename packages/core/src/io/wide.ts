import type { Inputs } from '../types';

export interface WideRow {
  participant_id?: string;
  inputs: Inputs;
  problems: string[]; // unparseable cells etc.
}

const isEmpty = (v: unknown) =>
  v === undefined || v === null || (typeof v === 'string' && ['', 'na', 'nan', 'null'].includes(v.trim().toLowerCase()));

/**
 * Wide-format row -> Inputs. Columns: G<t>, I<t> (t in minutes), FFA (fasting) or FFA<t>, TG, HDL_c/HDL,
 * weight, bmi, waist, age, sex (1 = male, 2 = female). Empty cells are missing (never 0). Values are
 * assumed to be in canonical units. Pure: no file access.
 */
export function parseWideRow(row: Record<string, string | number | null | undefined>): WideRow {
  const inputs: Inputs = {};
  const problems: string[] = [];
  let participant_id: string | undefined;
  for (const [rawKey, raw] of Object.entries(row)) {
    const key = rawKey.trim();
    const lk = key.toLowerCase();
    if (lk === 'participant_id' || lk === 'id') {
      participant_id = isEmpty(raw) ? undefined : String(raw).trim();
      continue;
    }
    if (isEmpty(raw)) continue;
    if (lk === 'sex') {
      const s = String(raw).trim().toLowerCase();
      if (s === '1' || s === 'male' || s === 'm') inputs.sex = 'male';
      else if (s === '2' || s === 'female' || s === 'f') inputs.sex = 'female';
      else problems.push(`sex: unrecognised value "${String(raw)}"`);
      continue;
    }
    const num = typeof raw === 'number' ? raw : Number(String(raw).trim());
    const series = /^(g|i|ffa)(\d*)$/.exec(lk);
    const scalar = { tg: 'tg', hdl: 'hdl', hdl_c: 'hdl', weight: 'weight', bmi: 'bmi', waist: 'waist', age: 'age', fat_mass: 'fat_mass', rate_glycerol: 'rate_glycerol', rate_palmitate: 'rate_palmitate' }[lk] as
      | 'tg' | 'hdl' | 'weight' | 'bmi' | 'waist' | 'age' | 'fat_mass' | 'rate_glycerol' | 'rate_palmitate' | undefined;
    if (!series && !scalar) continue; // ignore unknown columns
    if (!Number.isFinite(num)) {
      problems.push(`${key}: not a number ("${String(raw)}")`);
      continue;
    }
    if (scalar) inputs[scalar] = num;
    else {
      const name = series![1] === 'g' ? 'glucose' : series![1] === 'i' ? 'insulin' : 'ffa';
      const t = series![2] === '' ? 0 : Number(series![2]);
      (inputs[name] ??= {})[t] = num;
    }
  }
  return { participant_id, inputs, problems };
}

/** Minimal CSV text -> rows (comma separated, double-quote aware, header row required). */
export function parseCsv(text: string): Record<string, string>[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '');
  const split = (l: string) => {
    const out: string[] = [];
    let cur = '', q = false;
    for (let k = 0; k < l.length; k++) {
      const ch = l[k]!;
      if (q) { if (ch === '"') { if (l[k + 1] === '"') { cur += '"'; k++; } else q = false; } else cur += ch; }
      else if (ch === '"') q = true;
      else if (ch === ',') { out.push(cur); cur = ''; }
      else cur += ch;
    }
    out.push(cur);
    return out;
  };
  const header = split(lines[0] ?? '');
  return lines.slice(1).map((l) => Object.fromEntries(split(l).map((v, k) => [header[k] ?? `col${k}`, v])));
}

// Minimal hand-written argument parser (no dependencies).

export class UsageError extends Error {}

export interface FlagSpec {
  /** Flags that take a value, by long name (without dashes). */
  value: string[];
  /** Flags without a value. */
  bool: string[];
  /** Short aliases, e.g. { o: 'output' }. */
  short?: Record<string, string>;
}

export interface Parsed { positional: string[]; values: Record<string, string>; flags: Set<string> }

/** `--name value`, `--name=value`, `-o value`; `--` ends option parsing. */
export function parseArgs(argv: string[], spec: FlagSpec): Parsed {
  const out: Parsed = { positional: [], values: {}, flags: new Set() };
  for (let k = 0; k < argv.length; k++) {
    const a = argv[k]!;
    if (a === '--') { out.positional.push(...argv.slice(k + 1)); break; }
    let name: string | undefined, inline: string | undefined;
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      name = eq < 0 ? a.slice(2) : a.slice(2, eq);
      inline = eq < 0 ? undefined : a.slice(eq + 1);
    } else if (a.length > 1 && a.startsWith('-') && !/^-\d/.test(a)) {
      name = spec.short?.[a.slice(1)];
      if (!name) throw new UsageError(`unknown option ${a}`);
    } else { out.positional.push(a); continue; }
    if (spec.bool.includes(name)) {
      if (inline !== undefined) throw new UsageError(`option --${name} does not take a value`);
      out.flags.add(name);
    } else if (spec.value.includes(name)) {
      const v = inline ?? argv[++k];
      if (v === undefined) throw new UsageError(`option --${name} needs a value`);
      out.values[name] = v;
    } else throw new UsageError(`unknown option ${a}`);
  }
  return out;
}

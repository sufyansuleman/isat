// Small LaTeX-subset -> MathML converter (no dependency). Covers exactly what the formula_latex fields in
// packages/core/methods/*.yaml use. Output is built with DOM APIs only; no HTML is parsed from strings.
const NS = 'http://www.w3.org/1998/Math/MathML';

type Tok = { t: 'cmd' | 'num' | 'word' | 'sym' | 'space'; v: string };

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i]!;
    if (ch === '\\') {
      const m = /^\\([A-Za-z]+|.)/.exec(src.slice(i));
      if (!m) throw new Error('dangling backslash');
      out.push({ t: 'cmd', v: m[1]! });
      i += m[0].length;
    } else if (/\s/.test(ch)) {
      while (i < src.length && /\s/.test(src[i]!)) i++;
      out.push({ t: 'space', v: ' ' });
    } else if (/[0-9]/.test(ch)) {
      const m = /^\d+(\.\d+)?/.exec(src.slice(i))!;
      out.push({ t: 'num', v: m[0] });
      i += m[0].length;
    } else if (/[A-Za-z]/.test(ch)) {
      const m = /^[A-Za-z]+/.exec(src.slice(i))!;
      out.push({ t: 'word', v: m[0] });
      i += m[0].length;
    } else { out.push({ t: 'sym', v: ch }); i++; }
  }
  return out;
}

const el = (name: string, ...kids: Array<Node | string>): Element => {
  const e = document.createElementNS(NS, name);
  for (const k of kids) e.append(k);
  return e;
};
const leaf = (name: 'mi' | 'mn' | 'mo' | 'mtext', text: string, normal = false): Element => {
  const e = el(name, text);
  if (normal && name === 'mi') e.setAttribute('mathvariant', 'normal');
  return e;
};
const space = (w: string): Element => { const s = el('mspace'); s.setAttribute('width', w); return s; };

const OPERATORS: Record<string, string> = { times: '×', cdot: '·', pm: '±' };
const FUNCS = new Set(['log', 'ln', 'exp']);
const SYMBOLS: Record<string, string> = { mu: 'μ', alpha: 'α', beta: 'β' };

class Parser {
  private p = 0;
  constructor(private toks: Tok[], private normal = false) {}

  private peek(): Tok | undefined { return this.toks[this.p]; }

  /** Parse until a closing "}" (consumed by the caller) or end of input. */
  parseSeq(untilBrace: boolean): Element {
    const kids: Element[] = [];
    let sawSpace = false;
    const isOperand = (e?: Element) => !!e && e.localName !== 'mo' && e.localName !== 'mspace';
    for (;;) {
      const tk = this.peek();
      if (!tk) { if (untilBrace) throw new Error('unbalanced {'); break; }
      if (tk.t === 'sym' && tk.v === '}') { if (!untilBrace) throw new Error('unbalanced }'); break; }
      if (tk.t === 'space') { this.p++; sawSpace = true; continue; }
      if (tk.t === 'cmd' && (tk.v === ',' || tk.v === ' ' || tk.v === ';' || tk.v === '!')) {
        this.p++; kids.push(space(tk.v === ',' ? '0.1667em' : tk.v === '!' ? '0em' : '0.3333em')); sawSpace = false; continue;
      }
      const atom = this.parseScripted();
      if (sawSpace && isOperand(atom) && isOperand(kids[kids.length - 1])) kids.push(space('0.1667em'));
      sawSpace = false;
      kids.push(atom);
    }
    return kids.length === 1 ? kids[0]! : el('mrow', ...kids);
  }

  private parseScripted(): Element {
    const base = this.parseAtom();
    let sub: Element | undefined, sup: Element | undefined;
    for (;;) {
      const tk = this.peek();
      if (tk?.t === 'sym' && (tk.v === '_' || tk.v === '^')) {
        this.p++;
        const arg = this.parseArg();
        if (tk.v === '_') sub = arg; else sup = arg;
      } else break;
    }
    if (sub && sup) return el('msubsup', base, sub, sup);
    if (sub) return el('msub', base, sub);
    if (sup) return el('msup', base, sup);
    return base;
  }

  /** A braced group or a single atom (used for scripts and command arguments). */
  private parseArg(): Element {
    while (this.peek()?.t === 'space') this.p++;
    const tk = this.peek();
    if (!tk) throw new Error('missing argument');
    if (tk.t === 'sym' && tk.v === '{') {
      this.p++;
      const inner = this.parseSeq(true);
      this.p++; // "}"
      return inner.localName === 'mrow' ? inner : el('mrow', inner);
    }
    if (tk.t === 'num') { this.p++; return leaf('mn', tk.v); }
    return this.parseAtom();
  }

  private parseAtom(): Element {
    const tk = this.toks[this.p++];
    if (!tk) throw new Error('unexpected end');
    switch (tk.t) {
      case 'num': return leaf('mn', tk.v);
      case 'word': return leaf('mi', tk.v, this.normal && tk.v.length === 1);
      case 'sym': {
        if (tk.v === '{') {
          const inner = this.parseSeq(true); this.p++;
          return inner.localName === 'mrow' ? inner : el('mrow', inner);
        }
        if (tk.v === '_' || tk.v === '^' || tk.v === '}') throw new Error(`unexpected ${tk.v}`);
        return leaf('mo', tk.v === '-' ? '−' : tk.v);
      }
      case 'cmd': return this.command(tk.v);
      default: throw new Error('unexpected token');
    }
  }

  private command(name: string): Element {
    if (OPERATORS[name]) return leaf('mo', OPERATORS[name]!);
    if (SYMBOLS[name]) return leaf('mi', SYMBOLS[name]!);
    if (FUNCS.has(name)) return leaf('mi', name, true);
    switch (name) {
      case 'frac': { const a = this.parseArg(), b = this.parseArg(); return el('mfrac', a, b); }
      case 'sqrt': return el('msqrt', this.parseArg());
      case 'mathrm': {
        const sub = new Parser(this.groupTokens(), true);
        return el('mrow', sub.parseSeq(false));
      }
      case 'bar': return el('mover', this.parseArg(), leaf('mo', '¯'));
      case 'overline': return el('mover', this.parseArg(), leaf('mo', '¯'));
      default: throw new Error(`unsupported command \\${name}`);
    }
  }

  /** Tokens of the next braced group (or single token), consumed. */
  private groupTokens(): Tok[] {
    while (this.peek()?.t === 'space') this.p++;
    const tk = this.toks[this.p++];
    if (!tk) throw new Error('missing argument');
    if (!(tk.t === 'sym' && tk.v === '{')) return [tk];
    let depth = 1; const out: Tok[] = [];
    while (depth > 0) {
      const n = this.toks[this.p++];
      if (!n) throw new Error('unbalanced {');
      if (n.t === 'sym' && n.v === '{') depth++;
      if (n.t === 'sym' && n.v === '}') { depth--; if (depth === 0) break; }
      out.push(n);
    }
    return out;
  }
}

/** Free text (no TeX markup) such as "male: (waist-65) TG": shown verbatim as MathML text. */
const isProse = (s: string) => !/[\\^_{}]/.test(s) && (/^[a-z]+:/.test(s) || /\bsee\b/.test(s));

/** Converts a LaTeX-subset formula to a <math display="block"> element. Throws on unsupported input. */
export function latexToMathml(latex: string): Element {
  const math = el('math');
  math.setAttribute('display', 'block');
  if (isProse(latex)) { math.append(leaf('mtext', latex)); return math; }
  math.append(new Parser(tokenize(latex)).parseSeq(false));
  return math;
}

/** Replaces the <code> fallback in every `.formula[data-latex]` with MathML; leaves the fallback if conversion throws. */
export function hydrateFormulas(root: ParentNode): void {
  root.querySelectorAll<HTMLElement>('.formula[data-latex]').forEach((host) => {
    try { host.replaceChildren(latexToMathml(host.dataset['latex']!)); } catch { /* keep <code> fallback */ }
  });
}

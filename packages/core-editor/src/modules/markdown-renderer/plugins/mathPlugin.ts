import { escapeHtml } from '../utils';
import type { MathPlugin } from './registry';

/**
 * Offline LaTeX → MathML converter (MathML Core, rendered natively by Chromium/WebView2).
 *
 * Covers the math subset people write in Markdown: fractions, roots, scripts and limits, big
 * operators, functions, accents, fonts (\mathbb, \mathcal, …), delimiters (\left…\right, \big),
 * spacing, colours, boxes, and the matrix / cases / aligned families of environments.
 * Unknown commands are shown as an error so mistakes stay visible.
 */

// ---------------------------------------------------------------------------------------------
// Symbol tables
// ---------------------------------------------------------------------------------------------

const greek: Record<string, string> = {
  alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ϵ', varepsilon: 'ε', zeta: 'ζ', eta: 'η',
  theta: 'θ', vartheta: 'ϑ', iota: 'ι', kappa: 'κ', varkappa: 'ϰ', lambda: 'λ', mu: 'μ', nu: 'ν',
  xi: 'ξ', omicron: 'ο', pi: 'π', varpi: 'ϖ', rho: 'ρ', varrho: 'ϱ', sigma: 'σ', varsigma: 'ς',
  tau: 'τ', upsilon: 'υ', phi: 'ϕ', varphi: 'φ', chi: 'χ', psi: 'ψ', omega: 'ω', digamma: 'ϝ',
};

const upperGreek: Record<string, string> = {
  Gamma: 'Γ', Delta: 'Δ', Theta: 'Θ', Lambda: 'Λ', Xi: 'Ξ', Pi: 'Π', Sigma: 'Σ', Upsilon: 'Υ',
  Phi: 'Φ', Psi: 'Ψ', Omega: 'Ω', varGamma: 'Γ', varDelta: 'Δ', varTheta: 'Θ', varLambda: 'Λ',
  varXi: 'Ξ', varPi: 'Π', varSigma: 'Σ', varUpsilon: 'Υ', varPhi: 'Φ', varPsi: 'Ψ', varOmega: 'Ω',
};

/** Identifier-like symbols (<mi>). */
const ordinarySymbols: Record<string, string> = {
  infty: '∞', partial: '∂', nabla: '∇', hbar: 'ℏ', hslash: 'ℏ', ell: 'ℓ', wp: '℘', Re: 'ℜ', Im: 'ℑ',
  aleph: 'ℵ', beth: 'ℶ', gimel: 'ℷ', emptyset: '∅', varnothing: '∅', imath: 'ı', jmath: 'ȷ',
  angle: '∠', measuredangle: '∡', triangle: '△', square: '□', Box: '□', blacksquare: '■',
  diamondsuit: '♢', heartsuit: '♡', clubsuit: '♣', spadesuit: '♠', flat: '♭', natural: '♮', sharp: '♯',
  prime: '′', degree: '°', top: '⊤', bot: '⊥', checkmark: '✓', dagger: '†', ddagger: '‡',
  P: '¶', S: '§', copyright: '©', mho: '℧', Finv: 'Ⅎ', complement: '∁', eth: 'ð',
};

/** Operators, relations, arrows and punctuation (<mo>). */
const operatorSymbols: Record<string, string> = {
  pm: '±', mp: '∓', times: '×', div: '÷', cdot: '⋅', ast: '∗', star: '⋆', circ: '∘', bullet: '∙',
  oplus: '⊕', ominus: '⊖', otimes: '⊗', oslash: '⊘', odot: '⊙', uplus: '⊎', sqcup: '⊔', sqcap: '⊓',
  wedge: '∧', land: '∧', vee: '∨', lor: '∨', cap: '∩', cup: '∪', setminus: '∖', smallsetminus: '∖',
  wr: '≀', amalg: '⨿', diamond: '⋄', bigtriangleup: '△', bigtriangledown: '▽', triangleleft: '◃',
  triangleright: '▹', lhd: '⊲', rhd: '⊳', unlhd: '⊴', unrhd: '⊵', dotplus: '∔', ltimes: '⋉', rtimes: '⋊',
  leq: '≤', le: '≤', geq: '≥', ge: '≥', neq: '≠', ne: '≠', leqslant: '⩽', geqslant: '⩾', ll: '≪', gg: '≫',
  lll: '⋘', ggg: '⋙', prec: '≺', succ: '≻', preceq: '⪯', succeq: '⪰', sim: '∼', simeq: '≃', approx: '≈',
  cong: '≅', equiv: '≡', doteq: '≐', propto: '∝', asymp: '≍', models: '⊨', vdash: '⊢', dashv: '⊣',
  perp: '⊥', parallel: '∥', nparallel: '∦', mid: '∣', nmid: '∤', in: '∈', notin: '∉', ni: '∋', owns: '∋',
  subset: '⊂', supset: '⊃', subseteq: '⊆', supseteq: '⊇', subsetneq: '⊊', supsetneq: '⊋',
  nsubseteq: '⊈', nsupseteq: '⊉', sqsubset: '⊏', sqsupset: '⊐', sqsubseteq: '⊑', sqsupseteq: '⊒',
  approxeq: '≊', thicksim: '∼', thickapprox: '≈', lesssim: '≲', gtrsim: '≳', nless: '≮', ngtr: '≯',
  nleq: '≰', ngeq: '≱', nsim: '≁', ncong: '≇', bowtie: '⋈', Join: '⋈', smile: '⌣', frown: '⌢',
  therefore: '∴', because: '∵', colon: ':', forall: '∀', exists: '∃', nexists: '∄', neg: '¬', lnot: '¬',
  to: '→', rightarrow: '→', gets: '←', leftarrow: '←', leftrightarrow: '↔', Rightarrow: '⇒',
  Leftarrow: '⇐', Leftrightarrow: '⇔', implies: '⟹', impliedby: '⟸', iff: '⟺', longrightarrow: '⟶',
  longleftarrow: '⟵', longleftrightarrow: '⟷', Longrightarrow: '⟹', Longleftarrow: '⟸',
  Longleftrightarrow: '⟺', mapsto: '↦', longmapsto: '⟼', hookrightarrow: '↪', hookleftarrow: '↩',
  uparrow: '↑', downarrow: '↓', updownarrow: '↕', Uparrow: '⇑', Downarrow: '⇓', Updownarrow: '⇕',
  nearrow: '↗', searrow: '↘', swarrow: '↙', nwarrow: '↖', rightleftharpoons: '⇌', leftrightharpoons: '⇋',
  rightharpoonup: '⇀', rightharpoondown: '⇁', leftharpoonup: '↼', leftharpoondown: '↽',
  leadsto: '⇝', rightrightarrows: '⇉', leftleftarrows: '⇇', twoheadrightarrow: '↠', nrightarrow: '↛',
  nleftarrow: '↚', nRightarrow: '⇏', nLeftarrow: '⇍', nLeftrightarrow: '⇎', circlearrowleft: '↺',
  circlearrowright: '↻', dots: '…', ldots: '…', cdots: '⋯', vdots: '⋮', ddots: '⋱', dotsc: '…', dotsb: '⋯',
  langle: '⟨', rangle: '⟩', lceil: '⌈', rceil: '⌉', lfloor: '⌊', rfloor: '⌋', lvert: '|', rvert: '|',
  vert: '|', lVert: '‖', rVert: '‖', Vert: '‖', '|': '‖', backslash: '∖', surd: '√',
  '{': '{', '}': '}', lbrace: '{', rbrace: '}', lbrack: '[', rbrack: ']', ulcorner: '⌜', urcorner: '⌝',
  '#': '#', '$': '$', '%': '%', '&': '&', '_': '_',
};

/** Large operators; `limits` ones put their scripts under/over in display mode. */
const largeOperators: Record<string, { char: string; limits: boolean }> = {
  sum: { char: '∑', limits: true }, prod: { char: '∏', limits: true }, coprod: { char: '∐', limits: true },
  bigcup: { char: '⋃', limits: true }, bigcap: { char: '⋂', limits: true }, bigoplus: { char: '⨁', limits: true },
  bigotimes: { char: '⨂', limits: true }, bigodot: { char: '⨀', limits: true }, biguplus: { char: '⨄', limits: true },
  bigvee: { char: '⋁', limits: true }, bigwedge: { char: '⋀', limits: true }, bigsqcup: { char: '⨆', limits: true },
  int: { char: '∫', limits: false }, iint: { char: '∬', limits: false }, iiint: { char: '∭', limits: false },
  oint: { char: '∮', limits: false }, oiint: { char: '∯', limits: false },
};

/** Named functions written upright; `limits` ones take under-scripts in display mode. */
const functions: Record<string, boolean> = {
  sin: false, cos: false, tan: false, cot: false, sec: false, csc: false, arcsin: false, arccos: false,
  arctan: false, sinh: false, cosh: false, tanh: false, coth: false, log: false, ln: false, lg: false,
  exp: false, arg: false, deg: false, dim: false, hom: false, ker: false, sgn: false,
  lim: true, limsup: true, liminf: true, max: true, min: true, sup: true, inf: true, det: true,
  gcd: true, Pr: true, argmax: true, argmin: true,
};

const accents: Record<string, { char: string; under?: boolean; stretchy?: boolean }> = {
  hat: { char: '^' }, widehat: { char: '^', stretchy: true }, check: { char: 'ˇ' }, tilde: { char: '~' },
  widetilde: { char: '~', stretchy: true }, acute: { char: '´' }, grave: { char: '`' }, dot: { char: '˙' },
  ddot: { char: '¨' }, dddot: { char: '⃛' }, breve: { char: '˘' }, bar: { char: '¯' }, vec: { char: '→' },
  mathring: { char: '˚' }, overline: { char: '‾', stretchy: true }, underline: { char: '_', under: true, stretchy: true },
  overrightarrow: { char: '→', stretchy: true }, overleftarrow: { char: '←', stretchy: true },
  overleftrightarrow: { char: '↔', stretchy: true }, underrightarrow: { char: '→', under: true, stretchy: true },
  underleftarrow: { char: '←', under: true, stretchy: true }, widecheck: { char: 'ˇ', stretchy: true },
};

const spaces: Record<string, string> = {
  ',': '0.1667em', thinspace: '0.1667em', ':': '0.2222em', '>': '0.2222em', medspace: '0.2222em',
  ';': '0.2778em', thickspace: '0.2778em', '!': '-0.1667em', negthinspace: '-0.1667em', quad: '1em',
  qquad: '2em', ' ': '0.25em', enspace: '0.5em',
};

const delimiterNames: Record<string, string> = {
  '(': '(', ')': ')', '[': '[', ']': ']', '|': '|', '/': '/', '<': '⟨', '>': '⟩', '.': '',
  '\\{': '{', '\\}': '}', '\\lbrace': '{', '\\rbrace': '}', '\\langle': '⟨', '\\rangle': '⟩',
  '\\lvert': '|', '\\rvert': '|', '\\vert': '|', '\\lVert': '‖', '\\rVert': '‖', '\\Vert': '‖', '\\|': '‖',
  '\\lceil': '⌈', '\\rceil': '⌉', '\\lfloor': '⌊', '\\rfloor': '⌋', '\\uparrow': '↑', '\\downarrow': '↓',
  '\\updownarrow': '↕', '\\Uparrow': '⇑', '\\Downarrow': '⇓', '\\backslash': '∖', '\\lbrack': '[', '\\rbrack': ']',
};

const bigSizes: Record<string, string> = {
  big: '1.2em', bigl: '1.2em', bigr: '1.2em', bigm: '1.2em', Big: '1.8em', Bigl: '1.8em', Bigr: '1.8em', Bigm: '1.8em',
  bigg: '2.4em', biggl: '2.4em', biggr: '2.4em', biggm: '2.4em', Bigg: '3em', Biggl: '3em', Biggr: '3em', Biggm: '3em',
};

// ---------------------------------------------------------------------------------------------
// Font variants: MathML Core only supports mathvariant="normal", so other alphabets are mapped
// to the Unicode Mathematical Alphanumeric Symbols block.
// ---------------------------------------------------------------------------------------------

type Variant = 'normal' | 'bold' | 'italic' | 'bold-italic' | 'script' | 'fraktur' | 'double-struck' | 'sans-serif' | 'monospace';

const variantBases: Record<Exclude<Variant, 'normal'>, { upper: number; lower: number; digit?: number; exceptions: Record<string, string> }> = {
  'bold': { upper: 0x1D400, lower: 0x1D41A, digit: 0x1D7CE, exceptions: {} },
  'italic': { upper: 0x1D434, lower: 0x1D44E, exceptions: { h: 'ℎ' } },
  'bold-italic': { upper: 0x1D468, lower: 0x1D482, exceptions: {} },
  'script': { upper: 0x1D49C, lower: 0x1D4B6, exceptions: { B: 'ℬ', E: 'ℰ', F: 'ℱ', H: 'ℋ', I: 'ℐ', L: 'ℒ', M: 'ℳ', R: 'ℛ', e: 'ℯ', g: 'ℊ', o: 'ℴ' } },
  'fraktur': { upper: 0x1D504, lower: 0x1D51E, exceptions: { C: 'ℭ', H: 'ℌ', I: 'ℑ', R: 'ℜ', Z: 'ℨ' } },
  'double-struck': { upper: 0x1D538, lower: 0x1D552, digit: 0x1D7D8, exceptions: { C: 'ℂ', H: 'ℍ', N: 'ℕ', P: 'ℙ', Q: 'ℚ', R: 'ℝ', Z: 'ℤ' } },
  'sans-serif': { upper: 0x1D5A0, lower: 0x1D5BA, digit: 0x1D7E2, exceptions: {} },
  'monospace': { upper: 0x1D670, lower: 0x1D68A, digit: 0x1D7F6, exceptions: {} },
};

function applyVariant(char: string, variant: Variant): string {
  if (variant === 'normal') {
    return char;
  }
  const base = variantBases[variant];
  const exception = lookup(base.exceptions, char);
  if (exception !== undefined) {
    return exception;
  }
  const code = char.charCodeAt(0);
  if (code >= 65 && code <= 90) {
    return String.fromCodePoint(base.upper + code - 65);
  }
  if (code >= 97 && code <= 122) {
    return String.fromCodePoint(base.lower + code - 97);
  }
  if (code >= 48 && code <= 57 && base.digit !== undefined) {
    return String.fromCodePoint(base.digit + code - 48);
  }
  return char;
}

const fontCommands: Record<string, Variant> = {
  mathbb: 'double-struck', Bbb: 'double-struck', mathcal: 'script', mathscr: 'script', mathfrak: 'fraktur',
  mathsf: 'sans-serif', mathtt: 'monospace', mathbf: 'bold', bf: 'bold', boldsymbol: 'bold-italic', bm: 'bold-italic',
  mathit: 'italic', mathrm: 'normal', rm: 'normal', operatorname: 'normal',
};

const textCommands = new Set(['text', 'textrm', 'textnormal', 'mbox', 'hbox', 'textbf', 'textit', 'textsf', 'texttt', 'textup', 'textmd']);

const colorPattern = /^(#[0-9a-f]{3,8}|[a-z]{3,20})$/i;

/** Own-property lookup, so names like `\\constructor` never hit Object.prototype. */
function lookup<T>(table: Record<string, T>, key: string): T | undefined {
  return Object.prototype.hasOwnProperty.call(table, key) ? table[key] : undefined;
}

// ---------------------------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------------------------

interface Atom {
  html: string;
  /** Scripts go under/over (munder/mover) instead of beside. */
  limits: boolean;
  /** Emitted after the scripts, e.g. the function-application operator of `\sin`. */
  suffix?: string;
}

class LatexParser {
  private pos = 0;
  private variant: Variant | null = null;

  constructor(private readonly input: string, private readonly display: boolean) {}

  /** Parses until the end, a closing `}`, or (when `stopAtRight`) a `\right`. */
  parseExpr(stopAtRight = false): string {
    const parts: string[] = [];
    while (this.pos < this.input.length) {
      this.skipSpaces();
      const char = this.peek();
      if (char === undefined || char === '}') {
        break;
      }
      if (stopAtRight && this.startsWithCommand('right')) {
        break;
      }
      const term = this.parseTerm();
      if (term.length > 0) {
        parts.push(term);
      }
    }
    return wrapRow(parts);
  }

  private peek(offset = 0): string | undefined {
    return this.input[this.pos + offset];
  }

  private skipSpaces(): void {
    while (/\s/.test(this.peek() ?? '')) {
      this.pos += 1;
    }
  }

  private startsWithCommand(name: string): boolean {
    return this.input.startsWith(`\\${name}`, this.pos) && !/[a-zA-Z]/.test(this.input[this.pos + name.length + 1] ?? '');
  }

  private readCommandName(): string {
    // At a backslash.
    this.pos += 1;
    const letters = /^[a-zA-Z]+/.exec(this.input.slice(this.pos));
    if (letters !== null) {
      this.pos += letters[0].length;
      if (this.peek() === '*') {
        // Starred forms (\operatorname*, \align*, …) behave the same here.
        this.pos += 1;
      }
      return letters[0];
    }
    const symbol = this.peek() ?? '';
    this.pos += 1;
    return symbol;
  }

  /** Raw text of a `{…}` group (or a single token), without parsing. */
  private readRawGroup(): string {
    this.skipSpaces();
    if (this.peek() !== '{') {
      const char = this.peek() ?? '';
      this.pos += 1;
      return char;
    }

    let depth = 0;
    const start = this.pos + 1;
    for (; this.pos < this.input.length; this.pos += 1) {
      const char = this.input[this.pos];
      if (char === '\\') {
        this.pos += 1;
      } else if (char === '{') {
        depth += 1;
      } else if (char === '}') {
        depth -= 1;
        if (depth === 0) {
          this.pos += 1;
          return this.input.slice(start, this.pos - 1);
        }
      }
    }
    return this.input.slice(start);
  }

  private readOptional(): string | null {
    this.skipSpaces();
    if (this.peek() !== '[') {
      return null;
    }
    const close = this.input.indexOf(']', this.pos);
    if (close === -1) {
      return null;
    }
    const value = this.input.slice(this.pos + 1, close);
    this.pos = close + 1;
    return value;
  }

  private parseArgument(): string {
    this.skipSpaces();
    const char = this.peek();
    if (char === '{') {
      this.pos += 1;
      const inner = this.parseExpr();
      if (this.peek() === '}') {
        this.pos += 1;
      }
      return inner;
    }
    if (char === undefined) {
      return '<mrow></mrow>';
    }
    return this.parseAtom().html;
  }

  private withVariant(variant: Variant, run: () => string): string {
    const previous = this.variant;
    this.variant = variant;
    try {
      return run();
    } finally {
      this.variant = previous;
    }
  }

  private parseTerm(): string {
    const atom = this.parseAtom();
    return this.parseScripts(atom);
  }

  private parseScripts(atom: Atom): string {
    let base = atom.html;
    let sub: string | null = null;
    let sup: string | null = null;
    let primes = '';

    for (;;) {
      this.skipSpaces();
      const char = this.peek();
      if (char === '\'') {
        primes += '′';
        this.pos += 1;
      } else if (char === '^' && sup === null) {
        this.pos += 1;
        sup = this.parseArgument();
      } else if (char === '_' && sub === null) {
        this.pos += 1;
        sub = this.parseArgument();
      } else if (this.startsWithCommand('limits')) {
        this.pos += 7;
        atom.limits = true;
      } else if (this.startsWithCommand('nolimits')) {
        this.pos += 9;
        atom.limits = false;
      } else {
        break;
      }
    }

    const suffix = atom.suffix ?? '';
    if (primes.length > 0) {
      sup = sup === null ? `<mo>${primes}</mo>` : `<mrow><mo>${primes}</mo>${sup}</mrow>`;
    }

    if (sub === null && sup === null) {
      return base + suffix;
    }

    if (atom.limits) {
      if (sub !== null && sup !== null) {
        base = `<munderover>${base}${sub}${sup}</munderover>`;
      } else {
        base = sub !== null ? `<munder>${base}${sub}</munder>` : `<mover>${base}${sup}</mover>`;
      }
      return base + suffix;
    }

    if (sub !== null && sup !== null) {
      return `<msubsup>${base}${sub}${sup}</msubsup>${suffix}`;
    }
    return (sub !== null ? `<msub>${base}${sub}</msub>` : `<msup>${base}${sup}</msup>`) + suffix;
  }

  private parseAtom(): Atom {
    this.skipSpaces();
    const char = this.peek();
    if (char === undefined) {
      return { html: '', limits: false };
    }

    if (char === '{') {
      return { html: this.parseArgument(), limits: false };
    }

    if (char === '\\') {
      return this.parseCommand();
    }

    // Numbers: digits with an optional decimal part form one <mn>.
    const number = /^\d+(?:\.\d+)?/.exec(this.input.slice(this.pos));
    if (number !== null) {
      this.pos += number[0].length;
      const text = this.variant === null ? number[0] : Array.from(number[0], digit => applyVariant(digit, this.variant as Variant)).join('');
      return { html: `<mn>${escapeHtml(text)}</mn>`, limits: false };
    }

    this.pos += 1;
    if (/[a-zA-Z]/.test(char)) {
      if (this.variant === 'normal') {
        return { html: `<mi mathvariant="normal">${char}</mi>`, limits: false };
      }
      return { html: `<mi>${escapeHtml(this.variant === null ? char : applyVariant(char, this.variant))}</mi>`, limits: false };
    }
    if (char === '~') {
      return { html: '<mspace width="0.25em"></mspace>', limits: false };
    }
    if ('()[]|'.includes(char)) {
      return { html: `<mo stretchy="false">${char}</mo>`, limits: false };
    }
    if (/[+\-=*/<>,.:;!?@'"`]/.test(char)) {
      const symbol = char === '-' ? '−' : char === '*' ? '∗' : char;
      return { html: `<mo>${escapeHtml(symbol)}</mo>`, limits: false };
    }
    if (char === '&' || char === '#' || char === '$' || char === '%' || char === '^' || char === '_') {
      return { html: '', limits: false };
    }
    return { html: `<mi>${escapeHtml(char)}</mi>`, limits: false };
  }

  private parseDelimiter(): string {
    this.skipSpaces();
    if (this.peek() === '\\') {
      const start = this.pos;
      const name = this.readCommandName();
      const key = `\\${name}`;
      return lookup(delimiterNames, key) ?? escapeHtml(this.input.slice(start, this.pos));
    }
    const char = this.peek() ?? '';
    this.pos += 1;
    return lookup(delimiterNames, char) ?? escapeHtml(char);
  }

  private parseCommand(): Atom {
    const name = this.readCommandName();
    const atom = (html: string, limits = false, suffix?: string): Atom => ({ html, limits, suffix });
    const applyFunction = '<mo>&#x2061;</mo>';

    const greekChar = lookup(greek, name);
    if (greekChar !== undefined) {
      return atom(`<mi>${greekChar}</mi>`);
    }
    const upperGreekChar = lookup(upperGreek, name);
    if (upperGreekChar !== undefined) {
      return atom(`<mi mathvariant="normal">${upperGreekChar}</mi>`);
    }
    const ordinary = lookup(ordinarySymbols, name);
    if (ordinary !== undefined) {
      return atom(`<mi>${ordinary}</mi>`);
    }
    const operator = lookup(operatorSymbols, name);
    if (operator !== undefined) {
      return atom(`<mo>${escapeHtml(operator)}</mo>`);
    }
    const largeOp = lookup(largeOperators, name);
    if (largeOp !== undefined) {
      return atom(`<mo largeop="true" movablelimits="true">${largeOp.char}</mo>`, largeOp.limits && this.display);
    }
    const functionLimits = lookup(functions, name);
    if (functionLimits !== undefined) {
      // Function application (U+2061) keeps spacing right, e.g. "sin x".
      return atom(`<mi mathvariant="normal">${name}</mi>`, functionLimits && this.display, applyFunction);
    }
    const space = lookup(spaces, name);
    if (space !== undefined) {
      return atom(`<mspace width="${space}"></mspace>`);
    }
    const accent = lookup(accents, name);
    if (accent !== undefined) {
      const body = this.parseArgument();
      const mo = `<mo stretchy="${accent.stretchy === true ? 'true' : 'false'}">${escapeHtml(accent.char)}</mo>`;
      return atom(accent.under === true ? `<munder accentunder="true">${body}${mo}</munder>` : `<mover accent="true">${body}${mo}</mover>`);
    }
    const variant = lookup(fontCommands, name);
    if (variant !== undefined) {
      if (name === 'operatorname') {
        const text = this.readRawGroup();
        return atom(`<mi mathvariant="normal">${escapeHtml(text)}</mi>`, this.display, applyFunction);
      }
      return atom(`<mrow>${this.withVariant(variant, () => this.parseArgument())}</mrow>`);
    }
    if (textCommands.has(name)) {
      const text = this.readRawGroup().replace(/\\([{}$&#%_ ])/g, '$1');
      const style = name === 'textbf' ? ' style="font-weight: bold"' : name === 'textit' ? ' style="font-style: italic"' : '';
      return atom(`<mtext${style}>${escapeHtml(text)}</mtext>`);
    }
    const bigSize = lookup(bigSizes, name);
    if (bigSize !== undefined) {
      const delimiter = this.parseDelimiter();
      return atom(delimiter.length === 0 ? '' : `<mo stretchy="true" symmetric="true" minsize="${bigSize}" maxsize="${bigSize}">${delimiter}</mo>`);
    }

    switch (name) {
      case 'frac':
      case 'dfrac':
      case 'tfrac':
      case 'cfrac': {
        const numerator = this.parseArgument();
        const denominator = this.parseArgument();
        const fraction = `<mfrac>${numerator}${denominator}</mfrac>`;
        return atom(name === 'dfrac' ? `<mstyle displaystyle="true">${fraction}</mstyle>` : name === 'tfrac' ? `<mstyle displaystyle="false">${fraction}</mstyle>` : fraction);
      }
      case 'binom':
      case 'dbinom':
      case 'tbinom': {
        const top = this.parseArgument();
        const bottom = this.parseArgument();
        return atom(`<mrow><mo>(</mo><mfrac linethickness="0">${top}${bottom}</mfrac><mo>)</mo></mrow>`);
      }
      case 'sqrt': {
        const index = this.readOptional();
        const radicand = this.parseArgument();
        return atom(index === null ? `<msqrt>${radicand}</msqrt>` : `<mroot>${radicand}${new LatexParser(index, false).parseExpr()}</mroot>`);
      }
      case 'overset':
      case 'stackrel': {
        const over = this.parseArgument();
        const body = this.parseArgument();
        return atom(`<mover>${body}${over}</mover>`);
      }
      case 'underset': {
        const under = this.parseArgument();
        const body = this.parseArgument();
        return atom(`<munder>${body}${under}</munder>`);
      }
      case 'overbrace':
      case 'underbrace': {
        const body = this.parseArgument();
        const brace = name === 'overbrace' ? '⏞' : '⏟';
        const html = name === 'overbrace'
          ? `<mover>${body}<mo stretchy="true">${brace}</mo></mover>`
          : `<munder>${body}<mo stretchy="true">${brace}</mo></munder>`;
        return atom(html, true);
      }
      case 'left': {
        const open = this.parseDelimiter();
        const inner = this.parseExpr(true);
        let close = '';
        if (this.startsWithCommand('right')) {
          this.pos += 6;
          close = this.parseDelimiter();
        }
        const fence = (delimiter: string) => delimiter.length === 0 ? '' : `<mo fence="true" stretchy="true">${delimiter}</mo>`;
        return atom(`<mrow>${fence(open)}${inner}${fence(close)}</mrow>`);
      }
      case 'right':
        // Unmatched \right: show the delimiter.
        return atom(`<mo>${this.parseDelimiter()}</mo>`);
      case 'middle':
        return atom(`<mo stretchy="true">${this.parseDelimiter()}</mo>`);
      case 'not': {
        this.skipSpaces();
        const next = this.parseAtom().html;
        const text = next.replace(/<[^>]+>/g, '');
        return atom(`<mo>${text}̸</mo>`);
      }
      case 'color':
      case 'textcolor': {
        const color = this.readRawGroup().trim();
        const body = this.parseArgument();
        return atom(colorPattern.test(color) ? `<mstyle mathcolor="${color}">${body}</mstyle>` : body);
      }
      // <menclose> is not part of MathML Core (Chromium ignores it), so boxes and strikes are CSS.
      case 'boxed':
      case 'fbox':
        return atom(`<mrow class="markedit-math-boxed">${this.parseArgument()}</mrow>`);
      case 'cancel':
        return atom(`<mrow class="markedit-math-cancel">${this.parseArgument()}</mrow>`);
      case 'bcancel':
        return atom(`<mrow class="markedit-math-bcancel">${this.parseArgument()}</mrow>`);
      case 'xcancel':
        return atom(`<mrow class="markedit-math-cancel markedit-math-bcancel">${this.parseArgument()}</mrow>`);
      case 'phantom':
        return atom(`<mphantom>${this.parseArgument()}</mphantom>`);
      case 'hspace':
      case 'mspace': {
        const width = this.readRawGroup().trim();
        return atom(/^-?\d*\.?\d+(em|ex|pt|px|mu)$/.test(width) ? `<mspace width="${width.replace(/mu$/, 'em')}"></mspace>` : '');
      }
      case 'pmod': {
        const body = this.parseArgument();
        return atom(`<mrow><mspace width="0.5em"></mspace><mo>(</mo><mi mathvariant="normal">mod</mi><mspace width="0.3333em"></mspace>${body}<mo>)</mo></mrow>`);
      }
      case 'bmod':
      case 'mod':
        return atom('<mo lspace="0.2222em" rspace="0.2222em">mod</mo>');
      case 'displaystyle':
      case 'textstyle':
      case 'scriptstyle':
      case 'limits':
      case 'nolimits':
      case 'nonumber':
      case 'notag':
      case 'allowbreak':
        return atom('');
      case 'tag':
      case 'label':
      case 'vspace':
        this.readRawGroup();
        return atom('');
      case '\\':
        // Line break outside an environment (handled at top level); ignore here.
        return atom('');
      case 'substack': {
        const raw = this.readRawGroup();
        return atom(renderTable(splitRows(raw), 'substack', false));
      }
      case 'begin':
        return atom(this.parseEnvironment());
      case 'end':
        // Stray \end: skip its name.
        this.readRawGroup();
        return atom('');
      default:
        return atom(`<merror><mtext>\\${escapeHtml(name)}</mtext></merror>`);
    }
  }

  private parseEnvironment(): string {
    const env = this.readRawGroup().trim().replace(/\*$/, '');
    if (env === 'array' || env === 'alignat') {
      // Column spec / count; alignment comes from the environment defaults below.
      this.readRawGroup();
    }

    // Find the matching \end{env}, honouring nested environments of the same name.
    const beginToken = `\\begin{${env}`;
    const endPattern = new RegExp(`\\\\end\\{${env.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\*?\\}`, 'g');
    let depth = 1;
    let cursor = this.pos;
    let bodyEnd = this.input.length;
    let after = this.input.length;
    while (depth > 0) {
      endPattern.lastIndex = cursor;
      const end = endPattern.exec(this.input);
      const nestedBegin = this.input.indexOf(beginToken, cursor);
      if (end === null) {
        break;
      }
      if (nestedBegin !== -1 && nestedBegin < end.index) {
        depth += 1;
        cursor = nestedBegin + beginToken.length;
        continue;
      }
      depth -= 1;
      if (depth === 0) {
        bodyEnd = end.index;
        after = end.index + end[0].length;
      }
      cursor = end.index + end[0].length;
    }

    const body = this.input.slice(this.pos, bodyEnd);
    this.pos = after;
    return renderEnvironment(env, body, this.display);
  }
}

function wrapRow(parts: string[]): string {
  if (parts.length === 0) {
    return '<mrow></mrow>';
  }
  return parts.length === 1 ? parts[0] : `<mrow>${parts.join('')}</mrow>`;
}

/** Splits environment content into rows (`\\`) and cells (`&`) at the top level. */
function splitRows(body: string): string[][] {
  const rows: string[][] = [];
  let cells: string[] = [];
  let current = '';
  let braceDepth = 0;
  let envDepth = 0;

  for (let index = 0; index < body.length; index += 1) {
    const char = body[index];
    if (char === '\\') {
      const rest = body.slice(index);
      if (rest.startsWith('\\begin{')) {
        envDepth += 1;
      } else if (rest.startsWith('\\end{')) {
        envDepth -= 1;
      } else if (rest.startsWith('\\\\') && braceDepth === 0 && envDepth === 0) {
        cells.push(current);
        rows.push(cells);
        cells = [];
        current = '';
        index += 1;
        // Optional spacing argument: \\[2pt]
        const spacing = /^\[[^\]]*\]/.exec(body.slice(index + 1));
        if (spacing !== null) {
          index += spacing[0].length;
        }
        continue;
      }
      current += char + (body[index + 1] ?? '');
      index += 1;
      continue;
    }
    if (char === '{') {
      braceDepth += 1;
    } else if (char === '}') {
      braceDepth -= 1;
    } else if (char === '&' && braceDepth === 0 && envDepth === 0) {
      cells.push(current);
      current = '';
      continue;
    }
    current += char;
  }

  cells.push(current);
  rows.push(cells);
  // Drop a trailing empty row left by a final `\\`.
  if (rows.length > 1 && rows[rows.length - 1].every(cell => cell.trim().length === 0)) {
    rows.pop();
  }
  return rows;
}

function renderTable(rows: string[][], kind: string, display: boolean): string {
  const alternating = ['aligned', 'align', 'split', 'alignat', 'eqnarray', 'alignedat', 'flalign'].includes(kind);
  const leftAligned = ['cases', 'rcases', 'dcases'].includes(kind);
  const centred = ['gathered', 'gather', 'multline', 'substack', 'equation'].includes(kind);
  const cellDisplay = alternating || centred || display;

  const html = rows.map(row => `<mtr>${row.map((cell, column) => {
    let align = 'center';
    if (alternating) {
      align = column % 2 === 0 ? 'right' : 'left';
    } else if (leftAligned) {
      align = 'left';
    }
    const content = new LatexParser(cell.trim(), cellDisplay).parseExpr();
    return `<mtd style="text-align: ${align}"${alternating && column % 2 === 1 ? ' class="markedit-math-align-left"' : ''}>${content}</mtd>`;
  }).join('')}</mtr>`).join('');

  const spacing = alternating ? ' columnspacing="0em"' : kind === 'substack' ? ' rowspacing="0em"' : '';
  return `<mtable${spacing}${cellDisplay ? ' displaystyle="true"' : ''}>${html}</mtable>`;
}

function renderEnvironment(env: string, body: string, display: boolean): string {
  const rows = splitRows(body);
  const fenced: Record<string, [string, string]> = {
    pmatrix: ['(', ')'], bmatrix: ['[', ']'], Bmatrix: ['{', '}'], vmatrix: ['|', '|'], Vmatrix: ['‖', '‖'],
    cases: ['{', ''], dcases: ['{', ''], rcases: ['', '}'],
  };

  const table = renderTable(rows, env, display);
  const fence = lookup(fenced, env);
  if (fence !== undefined) {
    const [open, close] = fence;
    const mo = (delimiter: string) => delimiter.length === 0 ? '' : `<mo fence="true" stretchy="true">${delimiter}</mo>`;
    return `<mrow>${mo(open)}${table}${mo(close)}</mrow>`;
  }
  return table;
}

/** Converts a LaTeX math expression to a `<math>` element. */
export function renderLatexToMathML(latex: string, displayMode: boolean): string {
  const source = latex.trim();
  let inner: string;

  // Top-level `\\` or `&` without an environment (common in $$ … $$ blocks): lay out as aligned.
  const rows = splitRows(source);
  if (rows.length > 1 || rows[0].length > 1) {
    inner = renderTable(rows, rows[0].length > 1 ? 'aligned' : 'gathered', displayMode);
  } else {
    inner = new LatexParser(source, displayMode).parseExpr();
  }

  return `<math xmlns="http://www.w3.org/1998/Math/MathML"${displayMode ? ' display="block"' : ''}>${inner}</math>`;
}

export function renderLatexToHtml(latex: string, displayMode: boolean): string {
  const math = renderLatexToMathML(latex, displayMode);
  return displayMode
    ? `<div class="markedit-math-block">${math}</div>`
    : `<span class="markedit-math-inline">${math}</span>`;
}

/** Built-in math plugin: LaTeX rendered to native MathML, fully offline. */
export const latexMathPlugin: MathPlugin = {
  id: 'latex-mathml',
  name: 'LaTeX (MathML)',
  render: renderLatexToMathML,
};

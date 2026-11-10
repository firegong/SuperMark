import { escapeHtml } from '../utils';

const latexSymbols: Record<string, string | undefined> = {
  alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε', zeta: 'ζ', eta: 'η', theta: 'θ', iota: 'ι',
  kappa: 'κ', lambda: 'λ', mu: 'μ', nu: 'ν', xi: 'ξ', omicron: 'ο', pi: 'π', rho: 'ρ', sigma: 'σ',
  tau: 'τ', upsilon: 'υ', phi: 'φ', chi: 'χ', psi: 'ψ', omega: 'ω',
  Gamma: 'Γ', Delta: 'Δ', Theta: 'Θ', Lambda: 'Λ', Xi: 'Ξ', Pi: 'Π', Sigma: 'Σ', Upsilon: 'Υ',
  Phi: 'Φ', Psi: 'Ψ', Omega: 'Ω',
  infty: '∞', partial: '∂', nabla: '∇', pm: '±', times: '×', div: '÷', cdot: '·', leq: '≤',
  geq: '≥', neq: '≠', approx: '≈', rightarrow: '→', Rightarrow: '⇒', leftarrow: '←', Leftarrow: '⇐',
  mapsto: '↦', in: '∈', notin: '∉', subset: '⊂', supset: '⊃', subseteq: '⊆', supseteq: '⊇',
  cup: '∪', cap: '∩', setminus: '∖', emptyset: '∅', forall: '∀', exists: '∃', neg: '¬',
  wedge: '∧', vee: '∨', top: '⊤', bot: '⊥', sum: '∑', prod: '∏', int: '∫', oint: '∮',
  sim: '∼', equiv: '≡', dots: '…', ldots: '…', cdots: '⋯', vdots: '⋮', ddots: '⋱',
};

const operatorChars = new Set([
  '+', '-', '=', '*', '/', '<', '>', '(', ')', '[', ']', '{', '}', '|', ',', '.', ':', ';',
  '!', '&', '%', '@', '#', '~', '?', '\\', "'",
]);

function charToMathML(char: string): string {
  if (/\d/.test(char)) {
    return `<mn>${escapeHtml(char)}</mn>`;
  }
  if (/[a-zA-Z]/.test(char)) {
    return `<mi>${escapeHtml(char)}</mi>`;
  }
  if (operatorChars.has(char)) {
    return `<mo>${escapeHtml(char)}</mo>`;
  }
  if (/\s/.test(char)) {
    return '';
  }
  return `<mtext>${escapeHtml(char)}</mtext>`;
}

class LatexParser {
  private pos = 0;

  constructor(private readonly input: string) {}

  parseExpr(): string {
    const parts: string[] = [];
    while (this.pos < this.input.length) {
      const char = this.peek();
      if (char === '}') {
        break;
      }
      parts.push(this.parseTerm());
    }

    if (parts.length === 0) {
      return '<mrow></mrow>';
    }
    if (parts.length === 1) {
      return parts[0];
    }
    return `<mrow>${parts.join('')}</mrow>`;
  }

  private peek(): string | undefined {
    return this.input[this.pos];
  }

  private advance(): string | undefined {
    const char = this.input[this.pos];
    this.pos += 1;
    return char;
  }

  private skipSpaces(): void {
    while (/\s/.test(this.peek() ?? '')) {
      this.pos += 1;
    }
  }

  private parseTerm(): string {
    this.skipSpaces();
    const char = this.peek();
    let base: string;

    if (char === '{') {
      base = this.parseGroup();
    } else if (char === '\\') {
      base = this.parseCommand();
    } else if (char === undefined) {
      return '';
    } else {
      base = charToMathML(this.advance() ?? '');
    }

    let next = this.peek();
    while (next === '^' || next === '_') {
      base = this.parseSubSup(base);
      next = this.peek();
    }

    return base;
  }

  private parseGroup(): string {
    if (this.peek() !== '{') {
      return '<mrow></mrow>';
    }

    this.pos += 1;
    const inner = this.parseExpr();
    if (this.peek() === '}') {
      this.pos += 1;
    }
    return inner;
  }

  private parseCommand(): string {
    if (this.peek() !== '\\') {
      return '';
    }

    this.pos += 1;
    const nameMatch = /^[a-zA-Z]+/.exec(this.input.slice(this.pos));
    const name = nameMatch !== null ? nameMatch[0] : (this.advance() ?? '');
    if (nameMatch !== null) {
      this.pos += name.length;
    }

    switch (name) {
      case 'frac': {
        const numerator = this.parseArgument();
        const denominator = this.parseArgument();
        return `<mfrac>${numerator}${denominator}</mfrac>`;
      }
      case 'sqrt': {
        this.skipSpaces();
        if (this.peek() === '[') {
          this.pos += 1;
          const index = this.parseExpr();
          if (this.peek() === ']') {
            this.pos += 1;
          }
          const radicand = this.parseArgument();
          return `<mroot>${radicand}${index}</mroot>`;
        }
        return `<msqrt>${this.parseArgument()}</msqrt>`;
      }
      case 'text': {
        const arg = this.parseArgument();
        const text = arg.replace(/<[^>]+>/g, '');
        return `<mtext>${escapeHtml(text)}</mtext>`;
      }
      case 'sum':
      case 'prod':
      case 'int':
      case 'oint':
      case 'lim':
        return `<mo>${latexSymbols[name] ?? name}</mo>`;
      case 'overline': {
        const arg = this.parseArgument();
        return `<mover>${arg}<mo stretchy="true">‾</mo></mover>`;
      }
      case 'underline': {
        const arg = this.parseArgument();
        return `<munder>${arg}<mo stretchy="true">_</mo></munder>`;
      }
      case 'mathbf':
      case 'bm': {
        const arg = this.parseArgument();
        return `<mstyle mathvariant="bold">${arg}</mstyle>`;
      }
      case 'mathrm': {
        const arg = this.parseArgument();
        return `<mstyle mathvariant="normal">${arg}</mstyle>`;
      }
      case 'mathit': {
        const arg = this.parseArgument();
        return `<mstyle mathvariant="italic">${arg}</mstyle>`;
      }
      case 'left':
      case 'right':
      case 'middle': {
        this.skipSpaces();
        const delimiter = this.advance() ?? '';
        return delimiter.length > 0 ? `<mo>${escapeHtml(delimiter)}</mo>` : '';
      }
      case 'begin':
      case 'end': {
        this.skipSpaces();
        if (this.peek() === '{') {
          this.parseGroup();
        }
        return '';
      }
      default: {
        if (latexSymbols[name] !== undefined) {
          return `<mo>${latexSymbols[name]}</mo>`;
        }
        return `<mi>${escapeHtml(name)}</mi>`;
      }
    }
  }

  private parseArgument(): string {
    this.skipSpaces();
    const char = this.peek();
    if (char === '{') {
      return this.parseGroup();
    }
    if (char === '\\') {
      return this.parseCommand();
    }
    if (char === undefined) {
      return '<mrow></mrow>';
    }
    return charToMathML(this.advance() ?? '');
  }

  private parseSubSup(base: string): string {
    const first = this.peek();
    if (first !== '^' && first !== '_') {
      return base;
    }

    this.pos += 1;
    const firstArg = this.parseArgument();
    const second = this.peek();
    const hasBoth = (first === '^' && second === '_') || (first === '_' && second === '^');

    if (hasBoth) {
      this.pos += 1;
      const secondArg = this.parseArgument();
      const sub = first === '_' ? firstArg : secondArg;
      const sup = first === '^' ? firstArg : secondArg;
      return `<msubsup>${base}${sub}${sup}</msubsup>`;
    }

    return first === '^' ? `<msup>${base}${firstArg}</msup>` : `<msub>${base}${firstArg}</msub>`;
  }
}

export function renderLatexToMathML(latex: string, displayMode: boolean): string {
  const parser = new LatexParser(latex);
  const inner = parser.parseExpr();
  return `<math xmlns="http://www.w3.org/1998/Math/MathML"${displayMode ? ' display="block"' : ''}>${inner}</math>`;
}

export function renderLatexToHtml(latex: string, displayMode: boolean): string {
  const math = renderLatexToMathML(latex, displayMode);
  return displayMode
    ? `<div class="markedit-math-block">${math}</div>`
    : `<span class="markedit-math-inline">${math}</span>`;
}

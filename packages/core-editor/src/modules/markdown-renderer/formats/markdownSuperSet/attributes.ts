/**
 * Attribute parsing shared by fenced code info strings (§13–15), fenced divs (§16),
 * bracketed spans (`[a]{.underline}`) and image attributes (`{width=50%}`).
 */

export interface AttributeSet {
  id: string | null;
  classes: string[];
  keywords: string[];
  values: Map<string, string>;
}

export interface CodeInfo {
  lang: string;
  /** `{=format}` raw block. */
  rawFormat: string | null;
  /** `{lang ...}` chunk form. */
  braced: boolean;
  run: boolean;
  render: boolean;
  attributes: AttributeSet;
}

export function emptyAttributes(): AttributeSet {
  return { id: null, classes: [], keywords: [], values: new Map() };
}

/**
 * Tokenizes `.class #id key=value key="quoted value" keyword`.
 *
 * Unquoted values may contain spaces as long as the following words are not another `key=`
 * token (`caption=example label=x` → caption is `example`), matching the §13.2 example.
 */
export function parseAttributes(source: string): AttributeSet {
  const result = emptyAttributes();
  let rest = source.trim();

  while (rest.length > 0) {
    const keyValue = /^([A-Za-z_][\w:.-]*)\s*=\s*/.exec(rest);
    if (keyValue !== null) {
      const key = keyValue[1].toLowerCase();
      rest = rest.slice(keyValue[0].length);
      let value: string;
      const quote = rest[0];
      if (quote === '"' || quote === '\'') {
        const end = rest.indexOf(quote, 1);
        value = end === -1 ? rest.slice(1) : rest.slice(1, end);
        rest = end === -1 ? '' : rest.slice(end + 1);
      } else {
        const next = /\s+(?=[A-Za-z_][\w:.-]*\s*=|[.#][\w-]|(?:run|render)(?:\s|$))/.exec(rest);
        value = next === null ? rest : rest.slice(0, next.index);
        rest = next === null ? '' : rest.slice(next.index);
        value = value.trim();
      }

      result.values.set(key, value);
      rest = rest.trimStart();
      continue;
    }

    const token = /^\S+/.exec(rest)?.[0] ?? '';
    rest = rest.slice(token.length).trimStart();
    if (token.startsWith('.') && token.length > 1) {
      result.classes.push(token.slice(1));
    } else if (token.startsWith('#') && token.length > 1) {
      result.id = token.slice(1);
    } else if (token.length > 0) {
      result.keywords.push(token);
    }
  }

  return result;
}

export function parseCodeInfo(info: string): CodeInfo {
  const trimmed = info.trim();
  const braced = /^\{(.*)\}\s*$/.exec(trimmed);

  if (braced !== null) {
    const inner = braced[1].trim();
    if (inner.startsWith('=')) {
      const format = inner.slice(1).trim().split(/\s+/)[0].toLowerCase();
      return { lang: format, rawFormat: format, braced: true, run: false, render: false, attributes: emptyAttributes() };
    }

    const attributes = parseAttributes(inner);
    let lang = '';
    if (attributes.keywords.length > 0 && !['run', 'render'].includes(attributes.keywords[0])) {
      lang = attributes.keywords.shift() ?? '';
    } else if (attributes.classes.length > 0) {
      lang = attributes.classes[0];
    }

    return {
      lang,
      rawFormat: null,
      braced: true,
      // §28: only a keyword *after* the language name switches behaviour.
      run: attributes.keywords.includes('run'),
      render: attributes.keywords.includes('render'),
      attributes,
    };
  }

  const firstSpace = trimmed.search(/\s/);
  const lang = firstSpace === -1 ? trimmed : trimmed.slice(0, firstSpace);
  const attributes = firstSpace === -1 ? emptyAttributes() : parseAttributes(trimmed.slice(firstSpace));
  return { lang, rawFormat: null, braced: false, run: false, render: false, attributes };
}

/** Reads the `#| key: value` option lines directly below a chunk's opening fence (§13.6). */
export function extractChunkOptions(lines: string[]): { options: Map<string, string>; body: string[] } {
  const options = new Map<string, string>();
  let index = 0;
  while (index < lines.length) {
    const match = /^#\|\s*([\w-]+)\s*:\s*(.*?)\s*$/.exec(lines[index]);
    if (match === null) {
      break;
    }

    options.set(match[1].toLowerCase(), match[2].replace(/^["']|["']$/g, ''));
    index += 1;
  }

  return { options, body: lines.slice(index) };
}

export function optionFlag(options: Map<string, string>, key: string, fallback: boolean): boolean {
  const value = options.get(key)?.toLowerCase();
  if (value === undefined) {
    return fallback;
  }

  return value === 'true' || value === 'yes' || value === '1';
}

/** CSS-safe size such as `50%`, `300`, `12em`. */
export function sanitizeSize(value: string | undefined): string | null {
  if (value === undefined) {
    return null;
  }

  const match = /^(\d+(?:\.\d+)?)(%|px|em|rem|cm|mm|in|pt|vw)?$/.exec(value.trim());
  if (match === null) {
    return null;
  }

  return `${match[1]}${(match[2] as string | undefined) ?? 'px'}`;
}

/** Keeps class names that are safe to emit and do not collide with app chrome. */
export function safeClassNames(classes: string[]): string[] {
  return classes.filter(cls => /^[\w-]+$/.test(cls) && !cls.startsWith('markedit-'));
}

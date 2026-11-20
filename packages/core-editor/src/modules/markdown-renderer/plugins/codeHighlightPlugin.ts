import { tags, Tag } from '@lezer/highlight';
import { escapeHtml } from '../utils';
import { activeHighlighter, highlightWithParser } from './syntaxHighlight';

/**
 * Highlighted HTML for fenced code: the language's own parser when one is known (see
 * syntaxHighlight.ts), else a generic tokenizer; either way in the active theme's colors.
 */
export function highlightCode(code: string, lang: string): string {
  if (lang.toLowerCase() === 'mermaid') {
    return escapeHtml(code);
  }

  const highlighter = activeHighlighter();
  const parsed = highlightWithParser(code, lang, highlighter);
  if (parsed !== undefined) {
    return parsed;
  }

  const span = (tag: Tag, text: string) => {
    const classes = highlighter.style([tag]);
    return classes === null ? escapeHtml(text) : `<span class="${escapeHtml(classes)}">${escapeHtml(text)}</span>`;
  };

  const keywordSet = new Set([
    'break', 'case', 'catch', 'class', 'const', 'continue', 'debugger', 'default', 'delete', 'do', 'else',
    'export', 'extends', 'finally', 'for', 'function', 'if', 'import', 'in', 'instanceof', 'new', 'return',
    'super', 'switch', 'this', 'throw', 'try', 'typeof', 'var', 'void', 'while', 'with', 'yield', 'let', 'static',
    'await', 'async', 'of', 'from', 'as', 'true', 'false', 'null', 'undefined',
    'def', 'elif', 'except', 'lambda', 'pass', 'raise', 'nonlocal', 'global', 'print',
    'public', 'private', 'protected', 'internal', 'virtual', 'override', 'abstract', 'sealed', 'readonly',
    'struct', 'enum', 'namespace', 'using', 'params', 'ref', 'out', 'event', 'delegate', 'where',
    'interface', 'implements', 'package', 'synchronized', 'final', 'native', 'transient', 'volatile', 'strictfp',
    'goto', 'const', 'byte', 'short', 'int', 'long', 'float', 'double', 'char', 'boolean',
  ]);

  const typeSet = new Set([
    'interface', 'type', 'declare', 'module', 'namespace', 'enum', 'struct', 'class',
    'int', 'float', 'double', 'bool', 'boolean', 'string', 'number', 'object', 'any', 'unknown', 'never', 'void',
    'Array', 'Record', 'Promise', 'Map', 'Set', 'Date', 'RegExp', 'Error',
  ]);

  let result = '';
  let i = 0;

  const readString = (quote: string): string => {
    let value = quote;
    i += 1;
    while (i < code.length) {
      const char = code[i];
      value += char;
      if (char === '\\' && i + 1 < code.length) {
        i += 1;
        value += code[i];
      } else if (char === quote) {
        i += 1;
        break;
      }
      i += 1;
    }
    return value;
  };

  const readCommentSlash = (): string => {
    let value = '//';
    i += 2;
    while (i < code.length && code[i] !== '\n') {
      value += code[i];
      i += 1;
    }
    return value;
  };

  const readCommentBlock = (): string => {
    let value = '/*';
    i += 2;
    while (i < code.length - 1) {
      value += code[i];
      if (code[i] === '*' && code[i + 1] === '/') {
        value += '/';
        i += 2;
        break;
      }
      i += 1;
    }
    return value;
  };

  const readNumber = (): string => {
    let value = '';
    while (i < code.length && /[\d._oxb]/.test(code[i].toLowerCase())) {
      value += code[i];
      i += 1;
    }
    return value;
  };

  const readWord = (): string => {
    let value = '';
    while (i < code.length && /[a-zA-Z0-9_$]/.test(code[i])) {
      value += code[i];
      i += 1;
    }
    return value;
  };

  while (i < code.length) {
    const char = code[i];

    if (char === '/' && code[i + 1] === '/') {
      const comment = readCommentSlash();
      result += span(tags.comment, comment);
      continue;
    }

    if (char === '/' && code[i + 1] === '*') {
      const comment = readCommentBlock();
      result += span(tags.comment, comment);
      continue;
    }

    if (char === '"' || char === "'" || char === '`') {
      const string = readString(char);
      result += span(tags.string, string);
      continue;
    }

    if (/\d/.test(char) || (char === '.' && /\d/.test(code[i + 1] ?? ''))) {
      const number = readNumber();
      result += span(tags.number, number);
      continue;
    }

    if (/[a-zA-Z_$]/.test(char)) {
      const word = readWord();
      if (keywordSet.has(word)) {
        result += span(tags.keyword, word);
      } else if (typeSet.has(word)) {
        result += span(tags.typeName, word);
      } else {
        result += escapeHtml(word);
      }
      continue;
    }

    result += escapeHtml(char);
    i += 1;
  }

  return result;
}

import { escapeHtml } from './utils';

/**
 * The markup contract between parsers and the preview (src/chrome/preview, markdownPreview.ts).
 *
 * Every parser that renders HTML fragments builds these parts with the helpers below, so the
 * preview's shared features keep working whichever parser is active:
 * - `data-line` on blocks (0-based source line): scroll sync, double-click to jump to the source
 * - task checkboxes with `data-line`: clicking toggles the marker in the source
 * - code blocks: language label and Copy button
 * - tables: preview table styles
 *
 * test/parserContract.test.ts checks every registered parser against this contract.
 */
export const previewClasses = {
  block: 'markedit-preview-block',
  table: 'markedit-preview-table',
  taskCheckbox: 'markedit-preview-task-checkbox',
  codeBlock: 'markedit-preview-code-block',
  codeLanguage: 'markedit-preview-code-lang',
  codeCopy: 'markedit-preview-code-copy',
} as const;

/** `class` and `data-line` attributes of a top-level block that starts at source line `line`. */
export function blockAttributes(line: number, extraClass = ''): string {
  const className = extraClass.length > 0 ? `${previewClasses.block} ${extraClass}` : previewClasses.block;
  return `class="${className}" data-line="${line}"`;
}

/**
 * A task list checkbox for source line `line`. `extraClass` and `extraAttributes` (already
 * escaped, starting with a space) let a parser add its own state classes and data.
 */
export function taskCheckboxHtml(line: number, checked: boolean, extraClass = '', extraAttributes = ''): string {
  const className = extraClass.length > 0 ? `${previewClasses.taskCheckbox} ${extraClass}` : previewClasses.taskCheckbox;
  return `<input type="checkbox" class="${className}" data-line="${line}"${extraAttributes}${checked ? ' checked' : ''}>`;
}

/** A code block: `codeHtml` is the (highlighted, escaped) code, `lang` the fence language. */
export function codeBlockHtml(codeHtml: string, lang: string): string {
  const langAttr = lang.length > 0 ? ` data-language="${escapeHtml(lang)}"` : '';
  const langLabel = lang.length > 0 ? `<span class="${previewClasses.codeLanguage}">${escapeHtml(lang)}</span>` : '';
  return `<div class="${previewClasses.codeBlock}"${langAttr}>${langLabel}<button type="button" class="${previewClasses.codeCopy}">Copy</button><pre><code>${codeHtml}</code></pre></div>`;
}

/** The opening tag of a table; `extraAttributes` (already escaped) starts with a space. */
export function tableOpenTag(extraClass = '', extraAttributes = ''): string {
  const className = extraClass.length > 0 ? `${previewClasses.table} ${extraClass}` : previewClasses.table;
  return `<table class="${className}"${extraAttributes}>`;
}

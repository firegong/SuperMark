import type { MarkdownFormat } from '../../types';
import { gmarkdownEngine } from './engine';
import { gmarkdownPreview } from './preview';

/**
 * gmarkdown Markdown (docs/reference/GMARKDOWN-SYNTAX.md): engine.ts with preprocess.ts,
 * blocks.ts, tables.ts and inline.ts turns the text into HTML; preview.ts shows it with `@import`
 * files and code tabs. To update or replace this format, change only this folder and keep the
 * id `gmarkdown`.
 */
export const gmarkdownFormat: MarkdownFormat = { engine: gmarkdownEngine, preview: gmarkdownPreview };

export { gmarkdownEngine, gmarkdownPreview };
export type { GmarkdownOptions } from './context';

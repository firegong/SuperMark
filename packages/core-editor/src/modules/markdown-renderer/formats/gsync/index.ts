import type { MarkdownFormat } from '../../types';
import { gsyncEngine } from './engine';
import { gsyncPreview } from './preview';

/**
 * gsync Markdown (docs/reference/GMARKDOWN-SYNTAX.md): engine.ts with preprocess.ts,
 * blocks.ts, tables.ts and inline.ts turns the text into HTML; preview.ts shows it with `@import`
 * files and code tabs. To update or replace this format, change only this folder and keep the
 * id `gsync`.
 */
export const gsyncFormat: MarkdownFormat = { engine: gsyncEngine, preview: gsyncPreview };

export { gsyncEngine, gsyncPreview };
export type { GsyncOptions } from './context';

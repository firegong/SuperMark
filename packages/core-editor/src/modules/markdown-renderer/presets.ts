import { DefaultMarkdownEngine } from './engine';
import type { MarkdownRendererEngine } from './types';
import { SuperMarkdownEngine } from './super/engine';

export const commonmarkEngine: MarkdownRendererEngine = new DefaultMarkdownEngine('commonmark', 'CommonMark', 'commonmark');
export const gfmEngine: MarkdownRendererEngine = new DefaultMarkdownEngine('gfm', 'GitHub Flavored Markdown', 'gfm');
export const extendedEngine: MarkdownRendererEngine = new DefaultMarkdownEngine('extended', 'Extended Markdown', 'extended');

export const superMarkdownEngine: MarkdownRendererEngine = new SuperMarkdownEngine();

export const defaultRendererEngine: MarkdownRendererEngine = extendedEngine;

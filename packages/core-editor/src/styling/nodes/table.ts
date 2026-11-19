import { createBlockWrappers, createLineDeco } from '../matchers/lezer';
import { createBlockPlugin, createDecoPlugin } from '../helper';

/**
 * Always use monospace font for Table.
 *
 * Tables get no [preview] button in the editor (unlike Mermaid and math): the split preview
 * and the Markdown view already render them.
 */
export const tableStyle = [
  createBlockPlugin(() => createBlockWrappers('Table', 'cm-md-tableWrapper')),
  createDecoPlugin(() => createLineDeco('Table', 'cm-md-monospace cm-md-table')),
];


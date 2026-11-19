import { EditorSelection } from '@codemirror/state';
import { documentLength } from '../../common/utils';

/**
 * Generally used to insert blocks like fenced code.
 */
export default function insertBlockWithMarks(marks: string) {
  const editor = window.editor;
  const lineBreak = editor.state.lineBreak;

  const updates = editor.state.changeByRange(({ from, to }) => {
    const line = editor.state.doc.lineAt(from);
    const selected = editor.state.sliceDoc(from, to);
    const prefix = line.from === from ? '' : lineBreak;
    const suffix = line.to === to ? '' : lineBreak;

    // Replace with the updated content and keep the original selection
    const insert = `${prefix}${marks}${lineBreak}${selected}${lineBreak}${marks}${suffix}`;
    // Measure in document positions: a CRLF line break is one position, not two.
    const state = editor.state;
    const anchor = from + documentLength(state, `${prefix}${marks}${lineBreak}`);
    const head = anchor + documentLength(state, selected);

    return {
      range: EditorSelection.range(anchor, head),
      changes: { from, to, insert },
    };
  });

  editor.dispatch(updates);
}

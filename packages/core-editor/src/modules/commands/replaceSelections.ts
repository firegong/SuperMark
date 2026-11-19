import { EditorSelection } from '@codemirror/state';
import { documentLength, toDocumentLineBreaks } from '../../common/utils';

export default function replaceSelections(replacement: string) {
  const editor = window.editor;
  const state = editor.state;
  const insert = toDocumentLineBreaks(state, replacement);
  const length = documentLength(state, insert);
  const updates = state.changeByRange(({ from, to }) => ({
    range: EditorSelection.cursor(from + length),
    changes: {
      from, to, insert,
    },
  }));

  editor.dispatch(updates);
}

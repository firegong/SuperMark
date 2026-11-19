import { EditorSelection, SelectionRange } from '@codemirror/state';
import { SearchCursor, SearchQuery } from '@codemirror/search';

export default function rangesFromQuery(query: SearchQuery, range?: SelectionRange): SelectionRange[] {
  // An incomplete regular expression (e.g. "(") is invalid while typing; getCursor would throw.
  if (!query.valid) {
    return [];
  }

  const cursor = query.getCursor(window.editor.state, range?.from, range?.to) as SearchCursor;
  const ranges: SelectionRange[] = [];

  while (!cursor.next().done) {
    ranges.push(EditorSelection.range(cursor.value.from, cursor.value.to));
  }

  return ranges;
}

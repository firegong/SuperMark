import { describe, expect, test } from '@jest/globals';
import { EditorSelection, EditorState } from '@codemirror/state';
import * as editor from './utils/editor';
import wrapBlock from '../src/modules/input/wrapBlock';
import insertBlockWithMarks from '../src/modules/commands/insertBlockWithMarks';
import replaceSelections from '../src/modules/commands/replaceSelections';
import { insertText } from '../src/core';
import { documentLength, toDocumentLineBreaks } from '../src/common/utils';

const crlf = EditorState.lineSeparator.of('\r\n');

function setUpCrlf(doc: string) {
  editor.setUp(doc, crlf);
}

function selectAll() {
  window.editor.dispatch({ selection: EditorSelection.range(0, window.editor.state.doc.length) });
}

describe('CRLF documents', () => {
  test('helpers measure in document positions', () => {
    setUpCrlf('a\r\nb');
    const state = window.editor.state;
    expect(documentLength(state, 'a\r\nb')).toBe(3);
    expect(documentLength(state, 'a\nb')).toBe(3);
    expect(toDocumentLineBreaks(state, 'a\nb\r\nc')).toBe('a\r\nb\r\nc');
  });

  test('wrapping a multi-line selection keeps the selection inside the document', () => {
    setUpCrlf('a\r\nb\r\nc');
    selectAll();
    expect(() => wrapBlock('*', window.editor)).not.toThrow();
    expect(window.editor.state.sliceDoc()).toBe('*a\r\nb\r\nc*');
    const { from, to } = window.editor.state.selection.main;
    expect(window.editor.state.sliceDoc(from, to)).toBe('a\r\nb\r\nc');
  });

  test('insertBlockWithMarks selects the original text', () => {
    setUpCrlf('x a\r\nb');
    window.editor.dispatch({ selection: EditorSelection.range(2, 5) });
    insertBlockWithMarks('```');
    const { from, to } = window.editor.state.selection.main;
    expect(window.editor.state.sliceDoc(from, to)).toBe('a\r\nb');
  });

  test('inserted LF text is split into real lines', () => {
    setUpCrlf('start');
    insertText('\npasted\n', 5, 5);
    expect(window.editor.state.doc.lines).toBe(3);
    expect(window.editor.state.selection.main.head).toBe(window.editor.state.doc.length);

    replaceSelections('x\ny');
    expect(window.editor.state.doc.lines).toBe(4);
    expect(window.editor.state.selection.main.head).toBe(window.editor.state.doc.length);
  });
});

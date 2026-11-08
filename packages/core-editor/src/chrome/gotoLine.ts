import { createElement } from './utils';

interface SelectionModule {
  gotoLine: (args: { lineNumber: CodeGen_Int }) => void;
}

export function createGotoLinePrompt(onClose: () => void): HTMLElement {
  const selection = window.webModules.selection as unknown as SelectionModule;

  const root = createElement('div', 'markedit-chrome-panel markedit-chrome-goto');
  const input = createElement('input', 'markedit-chrome-input markedit-chrome-goto-input');
  input.type = 'number';
  input.min = '1';
  input.max = String(window.editor.state.doc.lines);
  input.placeholder = 'Go to line';
  root.appendChild(input);

  input.addEventListener('keydown', event => {
    if (event.key !== 'Enter') {
      return;
    }

    const line = parseInt(input.value, 10);
    const maxLine = window.editor.state.doc.lines;

    if (!Number.isNaN(line)) {
      const clamped = Math.max(1, Math.min(line, maxLine));
      selection.gotoLine({ lineNumber: clamped as CodeGen_Int });
    }

    onClose();
    event.preventDefault();
  });

  setTimeout(() => input.focus(), 0);

  return root;
}

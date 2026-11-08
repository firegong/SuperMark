import { createButton, createElement } from './utils';

export interface TextBoxOptions {
  title?: string;
  defaultValue?: string;
  placeholder?: string;
}

export interface PromptModalController {
  readonly element: HTMLElement;
  readonly promise: Promise<string | undefined>;
  focus(): void;
  close(): void;
}

export function createPromptModal(options: TextBoxOptions = {}, onClose: () => void): PromptModalController {
  const core = window.webModules.core as unknown as { restoreFocus: () => void } | undefined;
  const { title = '', defaultValue = '', placeholder = '' } = options;

  let resolvePromise: (value: string | undefined) => void;
  const promise = new Promise<string | undefined>(resolve => {
    resolvePromise = resolve;
  });

  let settled = false;
  const close = (value?: string) => {
    if (settled) {
      return;
    }

    settled = true;
    resolvePromise(value);
    backdrop.remove();
    onClose();
    core?.restoreFocus();
  };

  const backdrop = createElement('div', 'markedit-chrome-modal-backdrop');
  backdrop.addEventListener('click', event => {
    if (event.target === backdrop) {
      close(undefined);
    }
  });

  const dialog = createElement('div', 'markedit-chrome-panel markedit-chrome-modal', backdrop);
  createElement('div', 'markedit-chrome-modal-title', dialog, title);

  const input = createElement('input', 'markedit-chrome-input markedit-chrome-modal-input');
  input.type = 'text';
  input.value = defaultValue;
  input.placeholder = placeholder;
  dialog.appendChild(input);

  const footer = createElement('div', 'markedit-chrome-modal-footer', dialog);
  const okButton = createButton('OK', () => close(input.value), 'markedit-chrome-button markedit-chrome-action-button');
  const cancelButton = createButton('Cancel', () => close(undefined), 'markedit-chrome-button');
  footer.appendChild(okButton);
  footer.appendChild(cancelButton);

  input.addEventListener('keydown', event => {
    if (event.key === 'Enter') {
      close(input.value);
      event.preventDefault();
    } else if (event.key === 'Escape') {
      close(undefined);
      event.preventDefault();
    }
  });

  const focus = () => {
    input.focus();
    input.select();
  };

  return { element: backdrop, promise, focus, close };
}

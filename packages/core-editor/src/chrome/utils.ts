export function createElement<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  parent?: HTMLElement,
  text?: string,
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  if (className !== undefined) {
    element.className = className;
  }
  if (text !== undefined) {
    element.textContent = text;
  }
  parent?.appendChild(element);
  return element;
}

export function createButton(
  label: string,
  onClick: () => void,
  className = 'markedit-chrome-button',
): HTMLButtonElement {
  const button = createElement('button', className);
  button.type = 'button';
  button.textContent = label;
  button.addEventListener('click', onClick);
  return button;
}

export function createToggle(
  label: string,
  isActive: () => boolean,
  onToggle: () => void,
): HTMLButtonElement {
  const button = createElement('button', 'markedit-chrome-button markedit-chrome-toggle');
  button.type = 'button';
  button.textContent = label;

  const update = () => {
    button.classList.toggle('markedit-chrome-active', isActive());
  };

  button.addEventListener('click', () => {
    onToggle();
    update();
  });
  update();

  return button;
}

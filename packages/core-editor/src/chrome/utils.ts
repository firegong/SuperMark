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

export type WindowControlsPlatform = 'macos' | 'windows';

export function detectWindowControlsPlatform(): WindowControlsPlatform {
  const dataset = document.documentElement.dataset.windowControls;
  if (dataset === 'macos' || dataset === 'windows') {
    return dataset;
  }

  if (/Win/i.test(navigator.platform) || /Windows/i.test(navigator.userAgent)) {
    return 'windows';
  }

  return 'macos';
}

function createCloseXIcon(size = 10): SVGSVGElement {
  const svgNS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${size} ${size}`);
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.5');
  svg.setAttribute('stroke-linecap', 'round');

  const inset = 2;
  const path = document.createElementNS(svgNS, 'path');
  path.setAttribute('d', `M${inset} ${inset} L${size - inset} ${size - inset} M${size - inset} ${inset} L${inset} ${size - inset}`);
  svg.appendChild(path);

  return svg;
}

export function createWindowControls(
  onClose: () => void,
  platform: WindowControlsPlatform = detectWindowControlsPlatform(),
): HTMLElement {
  const container = createElement('div', `markedit-window-controls is-${platform}`);

  if (platform === 'macos') {
    const closeButton = createElement('button', 'markedit-traffic-light is-close markedit-chrome-close-button');
    closeButton.type = 'button';
    closeButton.setAttribute('aria-label', 'Close');
    closeButton.appendChild(createCloseXIcon(10));
    closeButton.addEventListener('click', onClose);
    container.appendChild(closeButton);

    const minimize = createElement('span', 'markedit-traffic-light is-minimize');
    container.appendChild(minimize);

    const zoom = createElement('span', 'markedit-traffic-light is-zoom');
    container.appendChild(zoom);
  } else {
    const closeButton = createElement('button', 'markedit-win-caption-close markedit-chrome-close-button');
    closeButton.type = 'button';
    closeButton.setAttribute('aria-label', 'Close');
    closeButton.appendChild(createCloseXIcon(10));
    closeButton.addEventListener('click', onClose);
    container.appendChild(closeButton);
  }

  return container;
}

export interface SetupTitleBarOptions {
  rightActions?: HTMLElement;
  centeredTitle?: boolean;
}

export function setupModalTitleBar(
  titleRow: HTMLElement,
  titleEl: HTMLElement,
  onClose: () => void,
  options: SetupTitleBarOptions = {},
  platform: WindowControlsPlatform = detectWindowControlsPlatform(),
): void {
  titleRow.classList.add(`is-${platform}`);

  if (platform === 'macos') {
    const controls = createWindowControls(onClose, platform);
    titleRow.insertBefore(controls, titleEl);

    if (options.centeredTitle !== false) {
      const spacer = createElement('div', 'markedit-window-controls-spacer');
      titleRow.appendChild(spacer);
    }

    if (options.rightActions !== undefined) {
      titleRow.appendChild(options.rightActions);
    }
  } else {
    if (options.rightActions !== undefined) {
      const controls = createWindowControls(onClose, platform);
      options.rightActions.appendChild(controls);
      titleRow.appendChild(options.rightActions);
    } else {
      titleRow.appendChild(createWindowControls(onClose, platform));
    }
  }
}

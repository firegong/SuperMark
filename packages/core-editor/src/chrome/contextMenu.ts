import { WebMenuItem } from '../@types/WebMenuItem';
import { createElement } from './utils';

interface MenuItemState {
  isEnabled?: boolean;
  isSelected?: boolean;
}

interface ContextMenuAPI {
  getMenuItemState: (args: { id: string }) => MenuItemState;
  handleContextMenuAction: (args: { id: string }) => void;
}

export interface ContextMenuOptions {
  items: WebMenuItem[];
  location?: { x: number; y: number };
}

function formatShortcut(modifiers: string[], key: string): string {
  return [...modifiers, key].join('+');
}

function clampToViewport(element: HTMLElement, x: number, y: number): void {
  const rect = element.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) {
    return;
  }

  const padding = 8;
  const maxX = Math.max(padding, window.innerWidth - rect.width - padding);
  const maxY = Math.max(padding, window.innerHeight - rect.height - padding);

  element.style.left = `${Math.max(padding, Math.min(x, maxX))}px`;
  element.style.top = `${Math.max(padding, Math.min(y, maxY))}px`;
}

export function showContextMenu(options: ContextMenuOptions, onClose: () => void): HTMLElement {
  const api = window.webModules.api as unknown as Partial<ContextMenuAPI>;
  const { items, location } = options;
  const x = location?.x ?? 0;
  const y = location?.y ?? 0;

  const backdrop = createElement('div', 'markedit-chrome-context-backdrop');
  const menu = createElement('div', 'markedit-chrome-panel markedit-chrome-context-menu', backdrop);
  menu.style.left = `${x}px`;
  menu.style.top = `${y}px`;

  const renderItems = (menuItems: WebMenuItem[], container: HTMLElement) => {
    for (const item of menuItems) {
      if (item.separator) {
        createElement('div', 'markedit-chrome-context-separator', container);
        continue;
      }

      const title = item.title ?? '';
      const state = item.stateGetterID !== undefined ? (api.getMenuItemState?.({ id: item.stateGetterID }) ?? {}) : {};
      const isEnabled = state.isEnabled !== false;
      const isSelected = state.isSelected === true;

      const row = createElement('div', 'markedit-chrome-context-item', container);
      row.classList.toggle('markedit-chrome-disabled', !isEnabled);

      const label = createElement('span', 'markedit-chrome-context-label', row);
      label.textContent = isSelected ? `✓ ${title}` : title;

      if (item.modifiers !== undefined && item.key !== undefined) {
        createElement('span', 'markedit-chrome-context-shortcut', row, formatShortcut(item.modifiers, item.key));
      }

      const children = item.children as WebMenuItem[] | undefined;
      if (children !== undefined && children.length > 0) {
        row.classList.add('markedit-chrome-has-submenu');
        const submenu = createElement('div', 'markedit-chrome-panel markedit-chrome-context-menu markedit-chrome-submenu', row);
        renderItems(children, submenu);
      }

      if (isEnabled && item.actionID !== undefined) {
        row.addEventListener('click', () => {
          api.handleContextMenuAction?.({ id: item.actionID as string });
          close();
        });
      }
    }
  };

  const close = () => {
    backdrop.remove();
    onClose();
  };

  renderItems(items, menu);
  clampToViewport(menu, x, y);

  backdrop.addEventListener('click', event => {
    if (event.target === backdrop) {
      close();
    }
  });

  return backdrop;
}

import type {
  Definition,
  FootnoteDefinition,
  List,
  ListItem,
  Nodes,
  Parents,
  PhrasingContent,
  Root,
  RootContent,
  Table,
} from 'mdast';
import { blockAttributes, codeBlockHtml, tableOpenTag, taskCheckboxHtml } from '../previewMarkup';
import { escapeHtml, isUnsafeUrl } from '../utils';

/**
 * Renders an mdast syntax tree (https://github.com/syntax-tree/mdast) as preview HTML.
 *
 * Parsers that produce a tree (parsers/micromark.ts, or any other mdast-based parser added later)
 * share this renderer, which follows the preview markup contract (previewMarkup.ts): every block
 * gets `data-line` from the tree's source positions, so scroll sync, double-click to source and
 * task checkboxes work the same as with the built-in engines.
 */

export interface MdastRenderHooks {
  highlightCode(code: string, lang: string): string;
  renderMath(latex: string, displayMode: boolean): string;
  /** A rendered diagram for a fenced block, or null when `lang` is not a diagram. */
  renderDiagram(lang: string, code: string): string | null;
}

/** Nesting limit, as in the other engines: deeper content is shown as plain text. */
const maxNestingDepth = 64;

/** The text content of a node, without recursion (deep trees must not overflow the stack). */
function plainText(node: Nodes): string {
  let text = '';
  const stack: Nodes[] = [node];
  while (stack.length > 0) {
    const current = stack.pop() as Nodes;
    if ('value' in current && typeof current.value === 'string') {
      text += current.value;
    } else if ('children' in current) {
      for (let index = current.children.length - 1; index >= 0; index -= 1) {
        stack.push(current.children[index]);
      }
    }
  }
  return text;
}

/** Heading ids in any script (`## 설계` → `설계`), unique within the document. */
function slug(text: string): string {
  const base = text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 80);
  return base.length > 0 ? base : 'section';
}

class MdastRenderer {
  private readonly definitions = new Map<string, Definition>();
  private readonly footnoteDefinitions = new Map<string, FootnoteDefinition>();
  private readonly footnoteOrder: string[] = [];
  private readonly headingIds = new Map<string, number>();
  private depth = 0;

  constructor(private readonly hooks: MdastRenderHooks) {}

  render(root: Root): string {
    this.collectDefinitions(root);
    return this.blocks(root.children) + this.footnotes();
  }

  private collectDefinitions(root: Root): void {
    const stack: Nodes[] = [root];
    while (stack.length > 0) {
      const node = stack.pop() as Nodes;
      if (node.type === 'definition' && !this.definitions.has(node.identifier)) {
        this.definitions.set(node.identifier, node);
      } else if (node.type === 'footnoteDefinition' && !this.footnoteDefinitions.has(node.identifier)) {
        this.footnoteDefinitions.set(node.identifier, node);
      }
      if ('children' in node) {
        stack.push(...(node.children as Nodes[]));
      }
    }
  }

  private line(node: Nodes): number {
    return Math.max(0, (node.position?.start.line ?? 1) - 1);
  }

  private blocks(nodes: RootContent[]): string {
    return nodes.map(node => this.block(node)).join('');
  }

  /** Children of a container block, with the nesting limit. */
  private nested(parent: Parents, render: () => string): string {
    if (this.depth >= maxNestingDepth) {
      return `<p>${escapeHtml(plainText(parent))}</p>`;
    }
    this.depth += 1;
    try {
      return render();
    } finally {
      this.depth -= 1;
    }
  }

  private block(node: RootContent): string {
    const attributes = blockAttributes(this.line(node));
    switch (node.type) {
      case 'paragraph':
        return `<p ${attributes}>${this.inline(node.children)}</p>`;
      case 'heading': {
        const id = this.uniqueId(slug(plainText(node)));
        return `<div ${attributes}><h${node.depth} id="${escapeHtml(id)}" class="markedit-preview-heading"><a class="markedit-preview-anchor" href="#${escapeHtml(id)}" aria-hidden="true">#</a>${this.inline(node.children)}</h${node.depth}></div>`;
      }
      case 'thematicBreak':
        return `<hr ${attributes}>`;
      case 'blockquote':
        return `<div ${attributes}><blockquote class="markedit-preview-blockquote">${this.nested(node, () => this.blocks(node.children))}</blockquote></div>`;
      case 'list':
        return this.list(node);
      case 'code': {
        const lang = (node.lang ?? '').trim();
        const diagram = lang.length > 0 ? this.hooks.renderDiagram(lang, node.value) : null;
        if (diagram !== null) {
          return `<div ${attributes}>${diagram}</div>`;
        }
        const code = lang.length > 0 ? this.hooks.highlightCode(node.value, lang) : escapeHtml(node.value);
        return `<div ${attributes}>${codeBlockHtml(code, lang)}</div>`;
      }
      case 'math':
        return `<div ${attributes}>${this.hooks.renderMath(node.value, true)}</div>`;
      case 'html':
        // Raw HTML is shown as text, as in the other fragment parsers (no script in the preview).
        return `<p ${attributes}>${escapeHtml(node.value)}</p>`;
      case 'table':
        return this.table(node, attributes);
      // Definitions are rendered where they are used, list items and table parts by their
      // parents; front matter is not parsed by this renderer's parsers.
      case 'definition':
      case 'footnoteDefinition':
      case 'yaml':
      case 'listItem':
      case 'tableRow':
      case 'tableCell':
        return '';
      // Inline content at block level (not produced by a parser, but allowed by the types).
      case 'text':
      case 'emphasis':
      case 'strong':
      case 'delete':
      case 'inlineCode':
      case 'break':
      case 'inlineMath':
      case 'link':
      case 'image':
      case 'linkReference':
      case 'imageReference':
      case 'footnoteReference':
        return this.phrase(node);
    }
  }

  private uniqueId(base: string): string {
    const count = this.headingIds.get(base) ?? 0;
    this.headingIds.set(base, count + 1);
    return count === 0 ? base : `${base}-${count}`;
  }

  private list(list: List): string {
    const tag = list.ordered === true ? 'ol' : 'ul';
    const start = list.ordered === true && list.start !== null && list.start !== undefined && list.start !== 1 ? ` start="${list.start}"` : '';
    const hasTasks = list.children.some(item => typeof item.checked === 'boolean');
    const listClass = hasTasks ? 'markedit-preview-list markedit-preview-task-list' : 'markedit-preview-list';
    const items = this.nested(list, () => list.children.map(item => this.listItem(item, list.spread === true || item.spread === true)).join(''));
    return `<${tag} class="${listClass}"${start}>${items}</${tag}>`;
  }

  private listItem(item: ListItem, loose: boolean): string {
    const line = this.line(item);
    const isTask = typeof item.checked === 'boolean';
    const checkbox = isTask ? taskCheckboxHtml(line, item.checked === true) : '';
    // Tight lists show their paragraphs without <p>, like other parsers.
    const content = item.children.map(child => (
      !loose && child.type === 'paragraph' ? this.inline(child.children) : this.block(child)
    )).join('');
    return `<li ${blockAttributes(line, isTask ? 'markedit-preview-task-item' : '')}>${checkbox}${content}</li>`;
  }

  private table(table: Table, attributes: string): string {
    const align = (index: number) => {
      const value = table.align?.[index];
      return value === null || value === undefined ? '' : ` style="text-align: ${value}"`;
    };
    const header = table.children.at(0);
    const rows = table.children.slice(1);
    const headerCells = (header === undefined ? [] : header.children).map((cell, index) => `<th${align(index)}>${this.inline(cell.children)}</th>`).join('');
    const bodyRows = rows.map(row => {
      const cells = row.children.map((cell, index) => `<td${align(index)}>${this.inline(cell.children)}</td>`).join('');
      return `<tr data-line="${this.line(row)}">${cells}</tr>`;
    }).join('');
    return `<div ${attributes}>${tableOpenTag()}<thead><tr>${headerCells}</tr></thead><tbody>${bodyRows}</tbody></table></div>`;
  }

  private inline(nodes: PhrasingContent[]): string {
    return nodes.map(node => this.phrase(node)).join('');
  }

  private phrase(node: PhrasingContent): string {
    switch (node.type) {
      case 'text':
        return escapeHtml(node.value);
      case 'emphasis':
        return `<em>${this.inline(node.children)}</em>`;
      case 'strong':
        return `<strong>${this.inline(node.children)}</strong>`;
      case 'delete':
        return `<del>${this.inline(node.children)}</del>`;
      case 'inlineCode':
        return `<code class="markedit-preview-code">${escapeHtml(node.value)}</code>`;
      case 'break':
        return '<br>';
      case 'html':
        return escapeHtml(node.value);
      case 'inlineMath':
        return this.hooks.renderMath(node.value, false);
      case 'link':
        return this.link(node.url, node.title, this.inline(node.children));
      case 'image':
        return this.image(node.url, node.title, node.alt ?? '');
      case 'linkReference': {
        const definition = this.definitions.get(node.identifier);
        return definition === undefined
          ? `[${this.inline(node.children)}]`
          : this.link(definition.url, definition.title, this.inline(node.children));
      }
      case 'imageReference': {
        const definition = this.definitions.get(node.identifier);
        return definition === undefined ? escapeHtml(`![${node.alt ?? ''}]`) : this.image(definition.url, definition.title, node.alt ?? '');
      }
      case 'footnoteReference':
        return this.footnoteReference(node.identifier, node.label ?? node.identifier);
      default:
        return '';
    }
  }

  private link(url: string, title: string | null | undefined, content: string): string {
    if (isUnsafeUrl(url)) {
      return content;
    }
    const titleAttr = title !== null && title !== undefined && title.length > 0 ? ` title="${escapeHtml(title)}"` : '';
    return `<a href="${escapeHtml(url)}"${titleAttr}>${content}</a>`;
  }

  private image(url: string, title: string | null | undefined, alt: string): string {
    if (isUnsafeUrl(url)) {
      return escapeHtml(alt);
    }
    const titleAttr = title !== null && title !== undefined && title.length > 0 ? ` title="${escapeHtml(title)}"` : '';
    return `<img src="${escapeHtml(url)}" alt="${escapeHtml(alt)}" class="markedit-preview-image"${titleAttr}>`;
  }

  private footnoteReference(identifier: string, label: string): string {
    if (!this.footnoteDefinitions.has(identifier)) {
      return escapeHtml(`[^${label}]`);
    }
    let index = this.footnoteOrder.indexOf(identifier);
    if (index === -1) {
      this.footnoteOrder.push(identifier);
      index = this.footnoteOrder.length - 1;
    }
    const id = escapeHtml(identifier);
    return `<sup class="markedit-preview-footnote-ref"><a href="#fn-${id}" id="fnref-${id}">${index + 1}</a></sup>`;
  }

  private footnotes(): string {
    if (this.footnoteOrder.length === 0) {
      return '';
    }
    let items = '';
    // Footnotes may reference further footnotes, so the order can grow while rendering.
    for (let index = 0; index < this.footnoteOrder.length; index += 1) {
      const identifier = this.footnoteOrder[index];
      const definition = this.footnoteDefinitions.get(identifier);
      if (definition === undefined) {
        continue;
      }
      const id = escapeHtml(identifier);
      items += `<li id="fn-${id}" ${blockAttributes(this.line(definition))}>${this.nested(definition, () => this.blocks(definition.children))}<a href="#fnref-${id}" class="markedit-preview-footnote-back" aria-label="Back to reference">↩</a></li>`;
    }
    return `<section class="markedit-preview-footnotes"><hr><ol>${items}</ol></section>`;
  }
}

export function renderMdast(root: Root, hooks: MdastRenderHooks): string {
  return new MdastRenderer(hooks).render(root);
}

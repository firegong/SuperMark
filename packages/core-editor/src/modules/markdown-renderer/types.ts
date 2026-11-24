export type MarkdownSyntaxStandard = 'commonmark' | 'gfm' | 'extended' | string;

export interface MarkdownRenderOptions {
  standard?: MarkdownSyntaxStandard;
  enableFrontmatter?: boolean;
  enableTables?: boolean;
  enableTaskLists?: boolean;
  enableStrikethrough?: boolean;
  enableAutolinks?: boolean;
  enableFootnotes?: boolean;
  enableMath?: boolean;
  enableMermaid?: boolean;
  enableCallouts?: boolean;
  enableCodeHighlight?: boolean;
  blockPlugins?: MarkdownBlockPlugin[];
  inlinePlugins?: MarkdownInlinePlugin[];
}

export interface Line {
  raw: string;
  text: string;
  indent: number;
  lineNumber: number;
}

export interface RenderContext {
  options: Required<MarkdownRenderOptions>;
  parseInline(text: string): string;
  renderBlocks(lines: Line[]): string;
  renderMath(latex: string, displayMode: boolean): string;
  renderMermaid(code: string): string;
  highlightCode(code: string, lang: string): string;
}

export interface MarkdownBlockPlugin {
  readonly name: string;
  tryRender(lines: Line[], context: RenderContext): { html: string; consumed: number } | null;
}

export interface MarkdownInlinePlugin {
  readonly name: string;
  tryRender(text: string, context: RenderContext): string | null;
}

export interface MarkdownRendererEngine {
  readonly id: string;
  readonly name: string;
  readonly standard: MarkdownSyntaxStandard;
  render(markdown: string, options?: MarkdownRenderOptions): string;
  /** Asynchronous HTML fragment rendering (e.g. renderers provided by extensions). */
  renderAsync?(markdown: string): Promise<string>;
  /**
   * A complete, self-styled HTML document. When present, the preview shows it in an isolated
   * frame instead of inserting fragments into the app's document.
   */
  renderDocument?(markdown: string): Promise<string>;
  renderInline?(markdown: string, options?: MarkdownRenderOptions): string;
  renderMath?(latex: string, displayMode: boolean): string;
  renderMermaid?(code: string): string;
}

/**
 * What a preview needs from the preview pane (chrome/markdownPreview.ts), which owns what all
 * previews share: layout, scroll sync, task checkboxes, code copy buttons and link clicks.
 */
export interface PreviewHost {
  /** Renders again (e.g. when files included by the document have arrived). */
  rerender(): void;
  /** HTML was put into the body: attach the shared interactions, realign scrolling, hydrate diagrams. */
  didRenderHtml(body: HTMLElement): void;
  /** A preview frame loaded a new document. */
  didLoadFrame(frameDocument: Document): void;
  /** The preview's content changed size or position without a new render (e.g. a tab switched). */
  didChangeLayout(): void;
}

/** Shows a parser's output in the preview body. */
export interface PreviewRenderer {
  readonly id: string;
  render(body: HTMLElement, text: string, engine: MarkdownRendererEngine, host: PreviewHost): void;
}

/**
 * A Markdown format module (formats/<name>/index.ts): the parser, which turns Markdown into HTML
 * following the markup contract (previewMarkup.ts), and the preview that shows it. Each format
 * is one folder, so a format can be added, updated or replaced without touching the others.
 */
export interface MarkdownFormat {
  /** The parser; `engine.id` is the format's id, which the settings save. */
  readonly engine: MarkdownRendererEngine;
  /** Usually one of the shared previews (preview/): htmlPreview or framePreview. */
  readonly preview: PreviewRenderer;
}

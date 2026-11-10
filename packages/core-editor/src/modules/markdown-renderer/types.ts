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
  renderInline?(markdown: string, options?: MarkdownRenderOptions): string;
  renderMath?(latex: string, displayMode: boolean): string;
  renderMermaid?(code: string): string;
}

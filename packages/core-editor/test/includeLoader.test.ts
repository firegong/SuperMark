import { describe, expect, test, beforeEach } from '@jest/globals';
import { clearIncludeCache, includeOptions, resolveIncludePath } from '../src/chrome/includeLoader';
import { SuperMarkdownEngine } from '../src/modules/markdown-renderer/super/engine';

const files: Record<string, string> = {
  '/docs/chapters/intro.md': '## 소개\n\n@include ../shared/note.md',
  '/docs/shared/note.md': '공통 메모',
};

describe('@include in the preview', () => {
  beforeEach(() => {
    clearIncludeCache(true);
    (window as unknown as { nativeModules: unknown }).nativeModules = {
      api: {
        getFileInfo: async () => JSON.stringify({ filePath: '/docs/main.md' }),
        getFileContent: async ({ path }: { path?: string }) => files[path ?? ''] ?? null,
      },
    };
  });

  test('resolves paths relative to the including file', () => {
    expect(resolveIncludePath('/docs/main.md', 'chapters/intro.md')).toBe('/docs/chapters/intro.md');
    expect(resolveIncludePath('C:\\docs\\main.md', 'chapters/intro.md')).toBe('C:\\docs\\chapters\\intro.md');
    expect(resolveIncludePath('/docs/chapters/intro.md', '../shared/note.md')).toBe('/docs/shared/note.md');
    expect(resolveIncludePath(null, 'x.md')).toBeNull();
    expect(resolveIncludePath(null, '/abs/x.md')).toBe('/abs/x.md');
  });

  test('loads included files (also nested) and re-renders when they arrive', async () => {
    const engine = new SuperMarkdownEngine();
    const markdown = '# 문서\n\n@include chapters/intro.md';
    let renders = 0;
    const render = () => engine.render(markdown, includeOptions(markdown, () => { renders += 1; }));

    expect(render()).toContain('Loading chapters/intro.md');
    // Let the document path and the files load; each completed load asks for a re-render.
    for (let i = 0; i < 4; i += 1) {
      await new Promise(resolve => { setTimeout(resolve, 0); });
      render();
    }

    const html = render();
    expect(html).toContain('소개');
    expect(html).toContain('공통 메모');
    expect(html).not.toContain('Loading');
    expect(renders).toBeGreaterThan(0);
  });

  test('documents without @include are untouched', () => {
    expect(includeOptions('# no includes', () => {})).toBeUndefined();
  });
});

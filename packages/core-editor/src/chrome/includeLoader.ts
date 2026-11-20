import type { SuperMarkdownOptions } from '../modules/markdown-renderer/parsers/markdownSuperSet';

/**
 * Files for SuperMarkdown `@include path` (§27) in the preview.
 *
 * Rendering is synchronous, so included files are read ahead of time: the resolver answers
 * from a cache, and a file it has not seen yet is fetched from the desktop host (relative to
 * the current document) while a short "loading" line is shown; the preview re-renders when
 * the file arrives. The cache is cleared when the document changes or the window regains
 * focus, so edits to included files show up.
 */

type IncludeOptions = SuperMarkdownOptions & {
  documentPath: string | null;
  includeResolver: (path: string, fromPath: string | null) => string | null;
};

const contents = new Map<string, string | null>();
const loading = new Set<string>();
let documentPath: string | null | undefined;
let documentPathLoading = false;

function isAbsolute(path: string): boolean {
  return /^([A-Za-z]:[\\/]|[\\/])/.test(path);
}

/** Joins `path` to the directory of `fromPath`, keeping the platform's separator. */
export function resolveIncludePath(fromPath: string | null, path: string): string | null {
  const target = path.trim().replace(/^["']|["']$/g, '');
  if (isAbsolute(target)) {
    return target;
  }
  if (fromPath === null) {
    return null;
  }

  const separator = fromPath.includes('\\') ? '\\' : '/';
  const parts = fromPath.split(/[\\/]/).slice(0, -1);
  for (const part of target.split(/[\\/]/)) {
    if (part === '..') {
      parts.pop();
    } else if (part !== '.' && part.length > 0) {
      parts.push(part);
    }
  }
  return parts.join(separator);
}

function hostApi() {
  return (window as unknown as {
    nativeModules?: { api?: {
      getFileContent?: (args: { path?: string }) => Promise<string | undefined | null>;
      getFileInfo?: (args: { path?: string }) => Promise<string | undefined | null>;
    }; };
  }).nativeModules?.api;
}

async function loadDocumentPath(onLoaded: () => void): Promise<void> {
  if (documentPathLoading) {
    return;
  }
  documentPathLoading = true;
  try {
    const info = await hostApi()?.getFileInfo?.({});
    const parsed: unknown = typeof info === 'string' ? JSON.parse(info) : undefined;
    const path = typeof parsed === 'object' && parsed !== null ? (parsed as { filePath?: unknown }).filePath : undefined;
    documentPath = typeof path === 'string' ? path : null;
  } catch {
    documentPath = null;
  } finally {
    documentPathLoading = false;
  }
  onLoaded();
}

async function loadFile(path: string, onLoaded: () => void): Promise<void> {
  loading.add(path);
  try {
    const text = await hostApi()?.getFileContent?.({ path });
    contents.set(path, typeof text === 'string' ? text : null);
  } catch {
    contents.set(path, null);
  } finally {
    loading.delete(path);
  }
  onLoaded();
}

/** Options for SuperMarkdown rendering in the preview; `onLoaded` re-renders the preview. */
export function includeOptions(markdown: string, onLoaded: () => void): IncludeOptions | undefined {
  if (!/^@include[ \t]/m.test(markdown) || hostApi()?.getFileContent === undefined) {
    return undefined;
  }

  if (documentPath === undefined) {
    void loadDocumentPath(onLoaded);
  }

  return {
    documentPath: documentPath ?? null,
    includeResolver(path, fromPath) {
      const full = resolveIncludePath(fromPath ?? documentPath ?? null, path);
      if (full === null) {
        // The document has not been saved yet (or its path is still being looked up).
        return documentPath === undefined ? `*Loading ${path}…*` : null;
      }
      if (contents.has(full)) {
        return contents.get(full) ?? null;
      }
      if (!loading.has(full)) {
        void loadFile(full, onLoaded);
      }
      return `*Loading ${path}…*`;
    },
  };
}

/** Forget cached files (document changed, or included files may have been edited). */
export function clearIncludeCache(resetDocumentPath = false): void {
  contents.clear();
  if (resetDocumentPath) {
    documentPath = undefined;
  }
}

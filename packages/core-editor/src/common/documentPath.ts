/**
 * Tracks the file path of the document currently loaded in this window, and resolves
 * relative image references in the preview against that document's folder.
 *
 * The desktop host (Tauri) passes the path through `notifyWindowDidLoad` /
 * `document_content` replies and through `__markeditSetDocumentPath__`.
 */

export function getDocumentPath(): string | null {
  const value = (window as unknown as { __markeditDocumentPath?: unknown }).__markeditDocumentPath;
  return typeof value === 'string' && value.length > 0 ? value : null;
}

export function setDocumentPath(path: string | null): void {
  (window as unknown as { __markeditDocumentPath?: string | null }).__markeditDocumentPath = path;
  const invoke = (window as unknown as { __TAURI_INTERNALS__?: { invoke?: (cmd: string, args?: Record<string, unknown>) => Promise<unknown> } }).__TAURI_INTERNALS__?.invoke;
  if (typeof invoke === 'function' && typeof path === 'string' && path.length > 0) {
    void (async () => {
      try {
        await invoke('watch_document', { path });
      } catch {
        // ignore
      }
    })();
  }
  // Re-resolve images now that the document path is known (covers late renders).
  try {
    resolvePreviewImages(document);
  } catch {
    // ignore
  }
}

/** Parent directory of a file path (handles both / and \). */
function parentDir(filePath: string): string {
  const idx = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'));
  return idx >= 0 ? filePath.slice(0, idx + 1) : '';
}

/** Resolves a possibly-relative image src against the current document's folder and converts it
 *  to a loadable asset URL. Returns null when no conversion is needed or possible. */
export function resolveImageUrl(src: string): string | null {
  const path = getDocumentPath();
  if (path === null) {
    return null;
  }
  const trimmed = src.trim();
  if (trimmed === '') {
    return null;
  }
  // Already absolute / special schemes: leave them alone.
  if (/^(https?:|data:|asset:|file:|blob:|tauri:|#)/i.test(trimmed)) {
    return null;
  }
  let decoded = trimmed;
  try {
    decoded = decodeURIComponent(trimmed);
  } catch {
    decoded = trimmed;
  }
  const base = parentDir(path);
  const absolute = decoded.startsWith('/') || decoded.startsWith('\\')
    ? decoded
    : base + decoded;
  // Normalize separators to forward slashes for Tauri's asset protocol (Windows).
  const normalized = absolute.replace(/\\/g, '/');
  const conv = (window as unknown as { __TAURI_INTERNALS__?: { convertFileSrc?: (p: string, protocol?: string) => string } }).__TAURI_INTERNALS__?.convertFileSrc;
  if (typeof conv !== 'function') {
    return null;
  }
  try {
    return conv(normalized, 'asset');
  } catch {
    return null;
  }
}

/** Walks `container` and rewrites relative `<img src>` to asset URLs. */
export function resolvePreviewImages(container: ParentNode): void {
  const images = container.querySelectorAll('img');
  images.forEach(img => {
    const src = img.getAttribute('src');
    if (src === null) {
      return;
    }
    const resolved = resolveImageUrl(src);
    if (resolved !== null) {
      img.setAttribute('src', resolved);
    }
  });
}

// Register the global setter used by the desktop host.
if (typeof window !== 'undefined') {
  (window as unknown as { __markeditSetDocumentPath?: (p: string | null) => void }).__markeditSetDocumentPath = (p: string | null) => {
    setDocumentPath(p);
  };
}

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { defineConfig, type Plugin } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

/**
 * Upstream MarkEdit's native host substitutes `{{EDITOR_CONFIG}}` and
 * `{{USER_SETTINGS}}` when serving index.html. Tauri serves the dist folder
 * statically, so replace the quoted placeholders with empty JSON objects at
 * build time; the editor then merges its defaults (see index.ts) and the
 * Tauri bootstrap script overrides `window.config` after page load.
 */
function replaceHostPlaceholders(): Plugin {
  return {
    name: 'markedit-replace-host-placeholders',
    transformIndexHtml(html) {
      return html
        .replaceAll('"{{EDITOR_CONFIG}}"', '{}')
        .replaceAll('"{{USER_SETTINGS}}"', '{}');
    },
  };
}

/**
 * Ships mermaid.js next to index.html (vendor/mermaid.min.js) instead of inlining it: the editor
 * is a single-file bundle, and Mermaid (~5 MB) is only needed when a preview has a Mermaid block,
 * so it is loaded on demand by the Mermaid diagram plugin. Works offline (Tauri serves dist/).
 */
function vendorMermaid(): Plugin {
  const fileName = 'vendor/mermaid.min.js';
  const source = () => readFileSync(fileURLToPath(new URL('./node_modules/mermaid/dist/mermaid.min.js', import.meta.url)));
  return {
    name: 'markedit-vendor-mermaid',
    configureServer(server) {
      server.middlewares.use(`/${fileName}`, (_req, res) => {
        res.setHeader('Content-Type', 'text/javascript');
        res.end(source());
      });
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName, source: source() });
    },
  };
}

/**
 * Ships the bundled font (Pretendard, OFL-1.1) next to index.html as dist/fonts/, like Mermaid:
 * inlining 2 MB into the single-file bundle would slow every window, and the browser only loads
 * the font when text needs it (Hangul on Windows, see src/styling/fonts.ts).
 */
function vendorFonts(): Plugin {
  const files: Record<string, string> = {
    'fonts/PretendardVariable.woff2': './node_modules/pretendard/dist/web/variable/woff2/PretendardVariable.woff2',
    'fonts/Pretendard-LICENSE.txt': './node_modules/pretendard/dist/LICENSE.txt',
  };
  const source = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)));
  return {
    name: 'markedit-vendor-fonts',
    configureServer(server) {
      for (const [fileName, path] of Object.entries(files)) {
        server.middlewares.use(`/${fileName}`, (_req, res) => {
          res.setHeader('Content-Type', fileName.endsWith('.woff2') ? 'font/woff2' : 'text/plain; charset=utf-8');
          res.end(source(path));
        });
      }
    },
    generateBundle() {
      for (const [fileName, path] of Object.entries(files)) {
        this.emitFile({ type: 'asset', fileName, source: source(path) });
      }
    },
  };
}

export default defineConfig({
  resolve: {
    alias: {
      '@codemirror/lang-html': fileURLToPath(new URL('./src/@vendor/lang-html', import.meta.url)),
      '@codemirror/lang-markdown': fileURLToPath(new URL('./src/@vendor/lang-markdown', import.meta.url)),
    },
  },
  plugins: [replaceHostPlaceholders(), vendorMermaid(), vendorFonts(), viteSingleFile()],
});

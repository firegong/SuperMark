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
 * Ships large diagram renderers next to index.html (dist/vendor/) instead of inlining them: the
 * editor is a single-file bundle, and these are only needed when a preview has such a diagram,
 * so the diagram plugins load them on demand. Works offline (Tauri serves dist/).
 * - mermaid.js (~5 MB)
 * - viz.js (~1.3 MB): Graphviz compiled to WebAssembly, for `dot` diagrams without Graphviz installed
 */
function vendorScripts(): Plugin {
  const files: Record<string, string> = {
    'vendor/mermaid.min.js': './node_modules/mermaid/dist/mermaid.min.js',
    'vendor/viz-global.js': './node_modules/@viz-js/viz/dist/viz-global.js',
  };
  const source = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)));
  return {
    name: 'markedit-vendor-scripts',
    configureServer(server) {
      for (const [fileName, path] of Object.entries(files)) {
        server.middlewares.use(`/${fileName}`, (_req, res) => {
          res.setHeader('Content-Type', 'text/javascript');
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

/**
 * Ships the bundled fonts (Pretendard and D2Coding, OFL-1.1) next to index.html as dist/fonts/, like Mermaid:
 * inlining 2 MB into the single-file bundle would slow every window, and the browser only loads
 * the font when text needs it (Hangul on Windows, see src/styling/fonts.ts).
 */
function vendorFonts(): Plugin {
  const files: Record<string, string> = {
    'fonts/PretendardVariable.woff2': './node_modules/pretendard/dist/web/variable/woff2/PretendardVariable.woff2',
    'fonts/Pretendard-LICENSE.txt': './node_modules/pretendard/dist/LICENSE.txt',
    // The default editor font: monospace with Hangul exactly two columns wide.
    'fonts/D2Coding-Regular.woff2': './node_modules/d2coding/fonts/d2coding-full.woff2',
    'fonts/D2Coding-Bold.woff2': './node_modules/d2coding/fonts/d2coding-bold-full.woff2',
    'fonts/D2Coding-LICENSE.txt': './src/@vendor/fonts/D2Coding-LICENSE.txt',
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
  plugins: [replaceHostPlaceholders(), vendorScripts(), vendorFonts(), viteSingleFile()],
});

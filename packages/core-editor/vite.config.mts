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

export default defineConfig({
  resolve: {
    alias: {
      '@codemirror/lang-html': fileURLToPath(new URL('./src/@vendor/lang-html', import.meta.url)),
      '@codemirror/lang-markdown': fileURLToPath(new URL('./src/@vendor/lang-markdown', import.meta.url)),
    },
  },
  plugins: [replaceHostPlaceholders(), viteSingleFile()],
});

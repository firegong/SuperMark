import { describe, expect, test } from '@jest/globals';
import fs from 'fs';
import path from 'path';

const readHtml = () => {
  const filePath = path.join(__dirname, '../dist/index.html');
  return fs.readFileSync(filePath, 'utf-8');
};

describe('Build system', () => {
  test('host placeholders are resolved at build time, with config before settings', () => {
    const html = readHtml();
    // The Tauri host serves dist statically, so the vite build replaces the
    // quoted upstream placeholders with empty JSON objects. The inline script must
    // merge them under what the desktop host already injected (initialization script),
    // not overwrite window.config / MarkEdit.userSettings.
    expect(html).not.toContain('"{{EDITOR_CONFIG}}"');
    expect(html).not.toContain('"{{USER_SETTINGS}}"');
    expect(html).toContain('var hostConfig = {};');
    expect(html).toContain('var hostSettings = {};');
    expect(html.indexOf('var hostConfig = {};')).toBeLessThan(html.indexOf('var hostSettings = {};'));
    expect(html).not.toContain('window.config = {};');
    expect(html).toContain('userSettings: existing.userSettings ||');
  });

  test('test everything is inlined in a single file', () => {
    const html = readHtml();
    const document = new DOMParser().parseFromString(html, 'text/html');
    expect(document.querySelector('script[src]')).toBeNull();
    expect(document.querySelector('link[rel="stylesheet"]')).toBeNull();
    expect(html).not.toContain('chunk-loader');
  });
});

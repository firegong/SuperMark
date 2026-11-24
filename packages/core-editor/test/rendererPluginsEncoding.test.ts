import * as zlib from 'zlib';
import { CompressionStream as NodeCompressionStream, DecompressionStream as NodeDecompressionStream } from 'node:stream/web';
import { TextDecoder as NodeTextDecoder, TextEncoder as NodeTextEncoder } from 'node:util';
import { describe, expect, test } from '@jest/globals';
import { encodeKrokiSource, krokiImageUrl } from '../src/modules/markdown-renderer/plugins/kroki';
import { inflateDrawioPayload } from '../src/modules/markdown-renderer/plugins/drawio';

// jsdom does not expose the compression streams; WebView2 (Chromium) does.
Object.assign(globalThis, {
  CompressionStream: NodeCompressionStream,
  DecompressionStream: NodeDecompressionStream,
  TextEncoder: NodeTextEncoder,
  TextDecoder: NodeTextDecoder,
});

describe('diagram plugin encodings', () => {
  test('Kroki URLs use zlib deflate + base64url', async () => {
    const source = '@startuml\n사용자 -> 편집기: 열기\n@enduml';
    const encoded = await encodeKrokiSource(source);
    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);

    const bytes = Buffer.from(encoded.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
    expect(zlib.inflateSync(bytes).toString('utf8')).toBe(source);

    const url = await krokiImageUrl('https://kroki.io', 'plantuml', source);
    expect(url).toBe(`https://kroki.io/plantuml/svg/${encoded}`);
  });

  test('compressed draw.io payloads inflate to the diagram XML', async () => {
    const xml = '<mxGraphModel><root><mxCell id="0"/><mxCell id="a" value="한글 &amp; text"/></root></mxGraphModel>';
    const payload = zlib.deflateRawSync(Buffer.from(encodeURIComponent(xml))).toString('base64');
    expect(await inflateDrawioPayload(payload)).toBe(xml);
  });
});

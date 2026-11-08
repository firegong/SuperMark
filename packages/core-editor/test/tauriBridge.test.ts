import { afterEach, describe, expect, jest, test } from '@jest/globals';
import path from 'path';
import { renderCode } from 'ts-gyb/dist/renderer/renderer';
import { createNativeModule, NativeModule } from '../src/bridge/nativeModule';
import { createContextRequest } from '../src/bridge/contextRequest';

interface TestModule extends NativeModule {
  name: 'test';
  ping(args: { text: string }): Promise<string>;
}

describe('Tauri WebView2 bridge transport', () => {
  const originalWebkit = window.webkit;
  const originalTauri = window.__TAURI_INTERNALS__;

  afterEach(() => {
    window.webkit = originalWebkit;
    window.__TAURI_INTERNALS__ = originalTauri;
  });

  test('routes createNativeModule calls to window.__TAURI_INTERNALS__.invoke when webkit bridge is absent', async () => {
    window.webkit = { messageHandlers: {} };
    const invoke = jest.fn<(cmd: string, args?: Record<string, unknown>) => Promise<string>>(async () => 'pong');
    window.__TAURI_INTERNALS__ = { invoke };

    const module = createNativeModule<TestModule>('test');
    const response = await module.ping({ text: 'hello' });

    expect(response).toBe('pong');
    expect(invoke).toHaveBeenCalledWith('handle_bridge_message', {
      message: {
        moduleName: 'test',
        methodName: 'ping',
        parameters: JSON.stringify({ text: 'hello' }),
      },
    });
  });

  test('routes createContextRequest calls to window.__TAURI_INTERNALS__.invoke when webkit bridge is absent', async () => {
    window.webkit = undefined;
    const invoke = jest.fn<(cmd: string, args?: Record<string, unknown>) => Promise<string>>(
      async () => JSON.stringify({ value: 'secret-token' }),
    );
    window.__TAURI_INTERNALS__ = { invoke };

    const request = createContextRequest('secretStorage', 'cap-123');
    const result = await request('get', () => ({ key: 'apiKey' }));

    expect(result).toBe('secret-token');
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  test('renders Rust native bridge trait and dispatcher via ts-gyb template', () => {
    const rendered = renderCode(
      path.join(__dirname, '../src/@codegen/rust-native-module.mustache'),
      {
        moduleName: 'NativeModuleTokenizer',
        customTags: { bridgeName: 'NativeBridgeTokenizer', invokePath: 'tokenizer' },
        methods: [
          {
            methodName: 'moveWordBackward',
            returnType: 'i64',
            parameters: [
              { name: 'line', type: 'String' },
              { name: 'pos', type: 'i64', last: true },
            ],
          },
        ],
      },
    );

    expect(rendered).toContain('pub trait NativeModuleTokenizer: Send + Sync');
    expect(rendered).toContain('pub const NAME: &\'static str = "tokenizer";');
    expect(rendered).toContain('let result = self.module.moveWordBackward(parameter_line, parameter_pos);');
  });
});

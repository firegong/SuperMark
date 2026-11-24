import { describe, expect, test } from '@jest/globals';
import { normalizeUserSettings } from '../src/chrome/settingsModal';

describe('startup behavior setting', () => {
  test('defaults to opening a new document', () => {
    expect(normalizeUserSettings({}).startupBehavior).toBe('newDocument');
  });

  test('reads flat and dotted keys and rejects unknown values', () => {
    expect(normalizeUserSettings({ startupBehavior: 'lastSession' }).startupBehavior).toBe('lastSession');
    expect(normalizeUserSettings({ 'general.startupBehavior': 'lastSession' }).startupBehavior).toBe('lastSession');
    expect(normalizeUserSettings({ startupBehavior: 'bogus' }).startupBehavior).toBe('newDocument');
  });
});

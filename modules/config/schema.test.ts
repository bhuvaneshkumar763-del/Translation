import { describe, expect, it } from 'vitest';
import { configSchema, defaultConfig, legacyStorageKeyByConfigKey } from './schema';

describe('configSchema', () => {
  it('accepts defaultConfig as-is', () => {
    expect(() => configSchema.parse(defaultConfig)).not.toThrow();
  });

  it('rejects an unknown pageTranslatorService', () => {
    const invalid = { ...defaultConfig, pageTranslatorService: 'not-a-real-service' };
    expect(() => configSchema.parse(invalid)).toThrow();
  });

  it('accepts both customServiceSchema variants', () => {
    const withCustomServices = {
      ...defaultConfig,
      customServices: [
        { name: 'libre', url: 'https://libretranslate.example', apiKey: 'key' },
        { name: 'deepl_freeapi', apiKey: 'key' },
      ],
    };
    expect(() => configSchema.parse(withCustomServices)).not.toThrow();
  });

  it('rejects a customServices entry with an unrecognized name', () => {
    const invalid = {
      ...defaultConfig,
      customServices: [{ name: 'not-a-real-provider', apiKey: 'key' }],
    };
    expect(() => configSchema.parse(invalid)).toThrow();
  });
});

describe('legacyStorageKeyByConfigKey', () => {
  it('only maps keys that actually exist on the config schema', () => {
    for (const configKey of Object.keys(legacyStorageKeyByConfigKey)) {
      expect(defaultConfig).toHaveProperty(configKey);
    }
  });
});

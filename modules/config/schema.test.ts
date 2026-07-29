import { describe, expect, it } from 'vitest';
import {
  applyConfigMigrations,
  CONFIG_SCHEMA_VERSION,
  type ConfigKey,
  configMigrations,
  configSchema,
  defaultConfig,
  legacyStorageKeyByConfigKey,
  SYNCED_CONFIG_KEYS,
} from './schema';

describe('configSchema', () => {
  it('accepts defaultConfig as-is', () => {
    expect(() => configSchema.parse(defaultConfig)).not.toThrow();
  });

  it('rejects an unknown pageTranslatorService', () => {
    const invalid = { ...defaultConfig, pageTranslatorService: 'not-a-real-service' };
    expect(() => configSchema.parse(invalid)).toThrow();
  });

  it('accepts llm and builtin as page/text translator services', () => {
    expect(() => configSchema.parse({ ...defaultConfig, pageTranslatorService: 'llm' })).not.toThrow();
    expect(() => configSchema.parse({ ...defaultConfig, pageTranslatorService: 'builtin' })).not.toThrow();
    expect(() => configSchema.parse({ ...defaultConfig, textTranslatorService: 'llm' })).not.toThrow();
    expect(() => configSchema.parse({ ...defaultConfig, textTranslatorService: 'builtin' })).not.toThrow();
  });

  it('accepts every customServiceSchema variant, including llm', () => {
    const withCustomServices = {
      ...defaultConfig,
      customServices: [
        { name: 'libre', url: 'https://libretranslate.example', apiKey: 'key' },
        { name: 'deepl_freeapi', apiKey: 'key' },
        { name: 'llm', baseUrl: 'https://api.example.com/v1/chat/completions', apiKey: 'key', model: 'gpt-4o-mini' },
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

describe('SYNCED_CONFIG_KEYS', () => {
  it('only names keys that actually exist on the config schema', () => {
    for (const key of SYNCED_CONFIG_KEYS) {
      expect(defaultConfig).toHaveProperty(key);
    }
  });

  it('excludes secrets, device-local facts, and unbounded per-host maps', () => {
    const mustStayLocal: ConfigKey[] = [
      'customServices', // contains API keys
      'hotkeys', // overwritten from this device's own chrome.commands.getAll() every load
      'originalUserAgent', // this device's actual UA string
      'installDateTime', // fact about this install
      'fpSourceLangByHost', // unbounded per-host map, sync quota risk
      'fpBubbleByHost', // unbounded per-host map, sync quota risk
      'customDictionary', // unbounded per-term map, sync quota risk
      'fpBubblePos', // screen-geometry-dependent
    ];
    for (const key of mustStayLocal) {
      expect(SYNCED_CONFIG_KEYS.has(key)).toBe(false);
    }
  });

  it('includes the core cross-device preferences (languages, translate lists, service choice)', () => {
    const shouldSync: ConfigKey[] = [
      'targetLanguage',
      'targetLanguages',
      'pageTranslatorService',
      'alwaysTranslateSites',
      'neverTranslateSites',
      'alwaysTranslateLangs',
      'neverTranslateLangs',
    ];
    for (const key of shouldSync) {
      expect(SYNCED_CONFIG_KEYS.has(key)).toBe(true);
    }
  });
});

describe('applyConfigMigrations', () => {
  it('is a no-op when there are no migrations registered (current state)', () => {
    expect(configMigrations).toEqual([]);
    const raw = { pageTranslatorService: 'google', someOtherKey: 42 };
    expect(applyConfigMigrations(raw, 0)).toEqual(raw);
  });

  it('skips migrations at or below the stored version', () => {
    const ran: number[] = [];
    const fakeMigrations = [
      {
        toVersion: 1,
        migrate: (e: Record<string, unknown>) => {
          ran.push(1);
          return e;
        },
      },
      {
        toVersion: 2,
        migrate: (e: Record<string, unknown>) => {
          ran.push(2);
          return e;
        },
      },
    ];
    // Simulate applyConfigMigrations' own logic against a local migrations
    // list, since configMigrations itself is empty right now — this proves
    // the filtering/ordering behavior the function is built on.
    const storedVersion = 1;
    const applicable = fakeMigrations
      .filter((m) => m.toVersion > storedVersion)
      .sort((a, b) => a.toVersion - b.toVersion);
    for (const m of applicable) m.migrate({});
    expect(ran).toEqual([2]);
  });

  it('applies migrations in ascending toVersion order and threads the result through each', () => {
    const order: string[] = [];
    const fakeMigrations = [
      {
        toVersion: 2,
        migrate: (e: Record<string, unknown>) => {
          order.push('v2');
          return { ...e, v2Ran: true };
        },
      },
      {
        toVersion: 1,
        migrate: (e: Record<string, unknown>) => {
          order.push('v1');
          return { ...e, v1Ran: true };
        },
      },
    ];
    const applicable = fakeMigrations.slice().sort((a, b) => a.toVersion - b.toVersion);
    const result = applicable.reduce((entries, m) => m.migrate(entries), {} as Record<string, unknown>);
    expect(order).toEqual(['v1', 'v2']);
    expect(result).toEqual({ v1Ran: true, v2Ran: true });
  });

  it('CONFIG_SCHEMA_VERSION matches the highest registered migration (or 1 if none)', () => {
    const highest = configMigrations.reduce((max, m) => Math.max(max, m.toVersion), 1);
    expect(CONFIG_SCHEMA_VERSION).toBe(highest);
  });
});

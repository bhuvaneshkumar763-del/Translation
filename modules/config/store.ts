import { storage } from 'wxt/utils/storage';
import { defaultConfig, type Config, type ConfigKey } from './schema';

/**
 * Phase 0 placeholder — just proves the wxt/storage + zod schema wiring
 * compiles. The real twpConfig-compatible surface (get/set/onReady/
 * onChanged/import/export/restoreToDefault + the array/map mutators like
 * addSiteToAlwaysTranslate) is built out in Phase 1 (see plan, task
 * "Config + background skeleton + Google provider").
 */
export function defineConfigItem<K extends ConfigKey>(key: K) {
  return storage.defineItem<Config[K]>(`local:${key}`, {
    fallback: defaultConfig[key],
  });
}

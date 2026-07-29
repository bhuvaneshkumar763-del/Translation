/**
 * Single source of truth for "what providers exist and what can they do."
 *
 * Before this file, adding a provider meant editing `registry.ts`'s
 * hardcoded `serviceList` Map *and* three separate `z.enum([...])` lists in
 * `modules/config/schema.ts` *and* hand-writing per-provider branches in
 * `entrypoints/options/App.tsx` — surgery across three files for one new
 * service. `registry.ts` and the new-provider options fields now derive
 * their behavior from this list instead.
 *
 * `schema.ts`'s enums are still hand-maintained literal tuples (not derived
 * from this array) — deriving a zod `z.enum([...])`'s literal type from a
 * runtime-filtered array loses TypeScript's literal-type inference (it
 * widens to `string`), and fighting that isn't worth it for a 2-line list.
 * Keep both in sync by hand; it's a small, well-commented surface, not the
 * expensive part of adding a provider anymore.
 *
 * Zero browser-API imports here on purpose — this file is safe to import
 * from both the background service worker (`registry.ts`) and content
 * scripts (`page-translator/translateLoop.ts`, which needs the batching
 * hint synchronously, without a message round-trip to the background).
 */

export type ProviderRole = 'page' | 'text' | 'tts';

/** How translateLoop.ts should batch DOM text nodes for this provider, if it wants something other than the default one-node-per-piece/100-piece-tick behavior tuned for cheap MT endpoints. */
export interface BatchingHint {
  /** Group sibling text nodes under the same block-level ancestor into one multi-string piece, instead of one piece per node — gives the provider real paragraph/sentence context. */
  groupByBlock: boolean;
  /** Soft character budget per group, mirroring `Service`'s own 1100-char per-request batching in `types.ts`. */
  maxGroupChars: number;
}

export interface ProviderDescriptor {
  id: string;
  displayName: string;
  roles: ProviderRole[];
  /** True if the provider needs a user-supplied API key/URL before it can be used (shown in options as a field group). False for providers that either need nothing (Google/Bing/Yandex, the on-device provider) or gate on `isAvailable` instead. */
  requiresKey: boolean;
  /** Runtime feature-detection for providers that may not exist in this browser/version (the on-device provider). Omit for providers that are always usable once configured. */
  isAvailable?(): boolean;
  batchingHint?: BatchingHint;
}

function hasBuiltinTranslatorApi(): boolean {
  return typeof (globalThis as { Translator?: unknown }).Translator !== 'undefined';
}

export const providerDescriptors: ProviderDescriptor[] = [
  { id: 'google', displayName: 'Google', roles: ['page', 'text', 'tts'], requiresKey: false },
  { id: 'bing', displayName: 'Bing', roles: ['page', 'text', 'tts'], requiresKey: false },
  { id: 'yandex', displayName: 'Yandex', roles: ['page', 'text'], requiresKey: false },
  { id: 'deepl', displayName: 'DeepL', roles: ['text'], requiresKey: false },
  { id: 'libre', displayName: 'LibreTranslate (self-hosted)', roles: ['text'], requiresKey: true },
  {
    id: 'llm',
    displayName: 'AI (OpenAI-compatible)',
    roles: ['page', 'text'],
    requiresKey: true,
    batchingHint: { groupByBlock: true, maxGroupChars: 2000 },
  },
  {
    id: 'builtin',
    displayName: 'Built-in AI (on-device, this browser only)',
    roles: ['page', 'text'],
    requiresKey: false,
    isAvailable: hasBuiltinTranslatorApi,
    // Deliberately no batchingHint: on-device calls have no network
    // round-trip to amortize, so the default per-node granularity is
    // already fine (arguably better — smaller, faster individual calls).
  },
];

export function getProviderDescriptor(id: string): ProviderDescriptor | undefined {
  return providerDescriptors.find((d) => d.id === id);
}

export function getBatchingHint(id: string): BatchingHint | undefined {
  return getProviderDescriptor(id)?.batchingHint;
}

export function isProviderAvailable(id: string): boolean {
  const descriptor = getProviderDescriptor(id);
  if (!descriptor) return false;
  return descriptor.isAvailable ? descriptor.isAvailable() : true;
}

import { defineConfig } from 'wxt';

// See https://wxt.dev/api/config.html
export default defineConfig({
  modules: ['@wxt-dev/module-solid', '@wxt-dev/i18n/module'],
  manifest: (env) => ({
    default_locale: 'en',
    name: 'Prism — AI Page Translator',
    description: 'Translate any webpage in place, with an AI engine that understands context instead of just words.',
    homepage_url: 'https://github.com/bhuvaneshkumar763-del/Translation',
    minimum_chrome_version: '116',
    icons: {
      32: '/icons/icon-32.png',
      64: '/icons/icon-64.png',
      128: '/icons/icon-128.png',
    },
    // Gen 2 Session 4: scoped down from an unconditional host_permissions:
    // ['<all_urls>'] (granted to every install without asking) to a
    // minimal-by-default model. `https://www.deepl.com/*` is kept as an
    // always-on grant because the DeepL live-tab bridge
    // (content-deepl-bridge.content.ts) genuinely can't function without
    // it — a small, fixed, known origin, not user browsing data at large.
    // Everything else is optional: activeTab covers the core "translate
    // this page" gesture (toolbar/hotkey/context-menu) with zero prompt,
    // and the broad <all_urls> grant in optional_host_permissions is only
    // requested when the user explicitly opts into automatic/always-on
    // behavior (see entrypoints/options/App.tsx's "Enable automatic
    // translation on all sites" toggle). See background.ts's
    // `sendToTabWithInjectionFallback` for how the core gesture path
    // works without any host permission at all, and CLAUDE.md for the
    // known gap this leaves (per-site optional grants aren't implemented
    // yet — it's all-or-nothing for the "automatic" tier).
    host_permissions: ['https://www.deepl.com/*'],
    // `optional_host_permissions` is an MV3-only manifest key — WXT strips
    // it entirely (no fallback) when building the Firefox MV2 target, with
    // no warning. Declaring `<all_urls>` here alone would make the
    // "automatic translation on all sites" opt-in silently impossible to
    // grant on Firefox (registerContentScripts would never have a
    // permission to key off, and the options-page toggle's
    // browser.permissions.request call would have nothing to request
    // against). MV2 doesn't distinguish host permissions from API
    // permissions — both requestable and requested permissions live in one
    // unified array — so the Firefox equivalent is putting `<all_urls>`
    // into `optional_permissions` instead. Caught by checking the actual
    // built Firefox manifest.json after the Chrome-side scope-down, not
    // assumed.
    optional_host_permissions: ['<all_urls>'],
    // `webRequest` was declared but never actually used anywhere in the
    // codebase (confirmed by search) — dropped as dead permission surface
    // while auditing this block, not silently carried forward.
    permissions: ['activeTab', 'scripting', 'storage', 'contextMenus', 'offscreen', 'alarms'],
    optional_permissions: env.browser === 'firefox' ? ['webNavigation', '<all_urls>'] : ['webNavigation'],
    options_ui: {
      open_in_tab: true,
    },
    action: {
      default_icon: '/icons/icon-32.png',
      default_title: '__MSG_pageActionTitle__',
    },
    commands: {
      'hotkey-toggle-translation': {
        suggested_key: { default: 'Alt+T' },
        description: '__MSG_lblSwitchTranslatedAndOriginal__',
      },
      'hotkey-translate-selected-text': {
        suggested_key: { default: 'Alt+S' },
        description: '__MSG_msgTranslateSelectedText__',
      },
      'hotkey-swap-page-translation-service': {
        suggested_key: { default: 'Alt+Q' },
        description: '__MSG_swapTranslationService__',
      },
      'hotkey-show-original': {
        description: '__MSG_lblRestorePageToOriginal__',
      },
      'hotkey-translate-page-1': {
        description: '__MSG_lblTranslatePageToTargetLanguage__ 1',
      },
      'hotkey-translate-page-2': {
        description: '__MSG_lblTranslatePageToTargetLanguage__ 2',
      },
      'hotkey-translate-page-3': {
        description: '__MSG_lblTranslatePageToTargetLanguage__ 3',
      },
      'hotkey-hot-translate-selected-text': {
        description: '__MSG_lblHotTranslatedSelectedText__',
      },
    },
  }),
});

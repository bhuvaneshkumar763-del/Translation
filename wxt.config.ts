import { defineConfig } from 'wxt';

// See https://wxt.dev/api/config.html
//
// This mirrors the permissions/commands/action/options_ui block of the
// vanilla-JS extension's manifest.json (repo root, being phased out module by
// module — see /root/.claude/plans/now-like-i-want-cozy-zebra.md). Values
// that depend on where assets end up post-bundling (web_accessible_resources,
// icon paths) are placeholders until Phase 1+ moves those assets under
// public/ and entrypoints/.
export default defineConfig({
  modules: ['@wxt-dev/module-solid', '@wxt-dev/i18n/module'],
  manifest: {
    default_locale: 'en',
    name: 'TWP - FullPage (modified)',
    description: 'THIS EXTENSION IS FOR BETA TESTING',
    homepage_url: 'https://github.com/FilipePS/Traduzir-paginas-web',
    minimum_chrome_version: '116',
    icons: {
      32: '/icons/icon-32.png',
      64: '/icons/icon-64.png',
      128: '/icons/icon-128.png',
    },
    host_permissions: ['<all_urls>'],
    permissions: ['activeTab', 'storage', 'contextMenus', 'webRequest', 'offscreen'],
    optional_permissions: ['webNavigation'],
    // options_ui re-added once entrypoints/options/ exists (Phase 6) — WXT
    // auto-fills `page` from that entrypoint, and declaring options_ui without
    // it produces an invalid manifest Chrome will reject at load time.
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
  },
});

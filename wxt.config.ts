import { defineConfig } from 'wxt';

// See https://wxt.dev/api/config.html
export default defineConfig({
  modules: ['@wxt-dev/module-solid', '@wxt-dev/i18n/module'],
  manifest: {
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
    host_permissions: ['<all_urls>'],
    permissions: ['activeTab', 'storage', 'contextMenus', 'webRequest', 'offscreen', 'alarms'],
    optional_permissions: ['webNavigation'],
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
  },
});

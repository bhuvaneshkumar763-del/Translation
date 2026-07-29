import { twpConfig } from '../config/store';

/**
 * TypeScript port of lib/platformInfo.js. `originalUserAgent` is snapshotted
 * by the background script (see background.ts) so this stays correct even on
 * platforms that spoof/override the content-script-visible user agent.
 *
 * `isFirefox` can no longer be `typeof browser !== "undefined"` like the old
 * code: WXT always provides a `browser` global (a cross-browser polyfill),
 * even on Chrome, so that check would be true everywhere. WXT's build-time
 * `import.meta.env.BROWSER` (set via the `-b firefox` flag) is the reliable
 * per-target equivalent.
 */
export interface PlatformInfo {
  isMobile: {
    android: boolean;
    blackBerry: boolean;
    iOS: boolean;
    opera: boolean;
    windows: boolean;
    any: boolean;
  };
  isDesktop: boolean;
  isFirefox: boolean;
  isOpera: boolean;
}

export function getPlatformInfo(): PlatformInfo {
  const userAgent = twpConfig.get('originalUserAgent') || navigator.userAgent;

  const isMobile = {
    android: /Android/i.test(userAgent),
    blackBerry: /BlackBerry/i.test(userAgent),
    iOS: /iPhone|iPad|iPod/i.test(userAgent),
    opera: /Opera Mini/i.test(userAgent),
    windows: /IEMobile/i.test(userAgent) || /WPDesktop/i.test(userAgent),
  };
  const any = isMobile.android || isMobile.blackBerry || isMobile.iOS || isMobile.opera || isMobile.windows;

  return {
    isMobile: { ...isMobile, any },
    isDesktop: !any,
    isFirefox: import.meta.env.BROWSER === 'firefox',
    isOpera: /OPR/i.test(userAgent),
  };
}

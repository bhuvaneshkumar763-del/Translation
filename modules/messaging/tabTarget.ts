import { twpConfig } from '../config/store';

/**
 * Shared send-message targeting helpers for popup/standalone-window code
 * that talks to a tab's content script directly (rather than relaying
 * through background.ts, which already has its own copy of this logic for
 * the toolbar-icon/context-menu/command paths).
 */

/** For whole-page state/language queries — always the main frame, regardless of enableIframePageTranslation (a query needs one deterministic answer, not "whichever frame responds first"). */
export function mainFrameTarget(tabId: number): { tabId: number; frameId: number } {
  return { tabId, frameId: 0 };
}

/** For translate/restore actions — every frame if enableIframePageTranslation is on, otherwise just the main frame. Matches background.ts's toggleTranslationForTab. */
export function pageActionTarget(tabId: number): number | { tabId: number; frameId: number } {
  return twpConfig.get('enableIframePageTranslation') === 'yes' ? tabId : { tabId, frameId: 0 };
}

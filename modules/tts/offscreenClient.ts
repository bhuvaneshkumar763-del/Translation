import type { PublicPath } from 'wxt/browser';
import { twpConfig } from '../config/store';
import { onMessage, sendMessage } from '../messaging/protocol';

/**
 * TypeScript port of background/textToSpeech.js — the background-side half
 * of TTS. Actual audio playback needs `Audio`/`AudioContext`, which a
 * service worker doesn't have; this lazily creates a hidden offscreen
 * document (entrypoints/offscreen/) and relays messages to it. The
 * `creating` promise guard against concurrent `chrome.offscreen.createDocument()`
 * calls is ported verbatim — it's easy to lose in a rewrite and causes a
 * genuine "document already exists" exception under rapid TTS triggering.
 */

let creating: Promise<void> | null = null;

async function setupOffscreenDocument(path: PublicPath): Promise<void> {
  if (!('offscreen' in browser)) return;

  const offscreenUrl = browser.runtime.getURL(path);
  const existingContexts = await browser.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
    documentUrls: [offscreenUrl],
  });

  if (existingContexts.length > 0) return;

  if (creating) {
    await creating;
  } else {
    creating = browser.offscreen.createDocument({
      url: path,
      reasons: ['AUDIO_PLAYBACK'],
      justification: 'Enable text-to-speech functionality on any website.',
    });
    await creating;
    creating = null;
  }
}

/**
 * @webext-core/messaging's sendMessage rejects when nothing is listening yet
 * (unlike bare chrome.runtime.sendMessage, which just silently no-ops without
 * a callback — the old code's behavior here). The offscreen doc genuinely
 * might not be listening yet (not created, or still initializing), so these
 * broadcast sends are best-effort by design; swallow, don't propagate.
 */
function fireAndForget<T>(promise: Promise<T>): void {
  promise.catch(() => {});
}

export function initTextToSpeech(): void {
  onMessage('textToSpeech', async (message) => {
    await setupOffscreenDocument('/offscreen.html');
    if (twpConfig.get('textToSpeechService') === 'bing') {
      fireAndForget(sendMessage('offscreen_bing_textToSpeech', message.data));
    } else {
      fireAndForget(sendMessage('offscreen_google_textToSpeech', message.data));
    }
  });

  onMessage('stopAudio', async () => {
    await setupOffscreenDocument('/offscreen.html');
    fireAndForget(sendMessage('offscreen_google_stopAll', undefined));
    fireAndForget(sendMessage('offscreen_bing_stopAll', undefined));
  });

  // Listen for changes to the audio speed/volume settings and apply them immediately.
  twpConfig.onReady(() => {
    twpConfig.onChanged((name, newValue) => {
      if (name === 'ttsSpeed') {
        fireAndForget(sendMessage('offscreen_google_ttsSpeed', { speed: newValue as number }));
        fireAndForget(sendMessage('offscreen_bing_ttsSpeed', { speed: newValue as number }));
      } else if (name === 'ttsVolume') {
        fireAndForget(sendMessage('offscreen_google_ttsVolume', { volume: newValue as number }));
        fireAndForget(sendMessage('offscreen_bing_ttsVolume', { volume: newValue as number }));
      }
    });

    fireAndForget(sendMessage('offscreen_google_ttsSpeed', { speed: twpConfig.get('ttsSpeed') }));
    fireAndForget(sendMessage('offscreen_bing_ttsSpeed', { speed: twpConfig.get('ttsSpeed') }));
    fireAndForget(sendMessage('offscreen_google_ttsVolume', { volume: twpConfig.get('ttsVolume') }));
    fireAndForget(sendMessage('offscreen_bing_ttsVolume', { volume: twpConfig.get('ttsVolume') }));
  });
}

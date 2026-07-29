import { twpConfig } from '@/modules/config/store';
import { onMessage, sendMessage } from '@/modules/messaging/protocol';

/**
 * TypeScript port of contentScript/deepl.js — runs only on deepl.com's own
 * translator page. Drives DeepL's own UI directly (types into its source
 * textarea, picks the target language from its own dropdown, polls its
 * output textarea for a result) rather than calling a backend API — this is
 * intentional browser automation of deepl.com's frontend, not a client for
 * an undocumented endpoint like the other providers.
 */

async function translate(text: string, targetLanguage: string): Promise<string> {
  const sourceTextarea = document.querySelector<HTMLElement>('d-textarea[data-testid=translator-source-input] > div');
  if (!sourceTextarea) throw new Error('source_textarea not found.');

  const targetTextarea = document.querySelector<HTMLElement>('d-textarea[data-testid=translator-target-input]');
  if (!targetTextarea) throw new Error('target_textarea not found.');

  const selectLanguageEl = document.querySelector<HTMLButtonElement>('button[data-testid=translator-target-lang-btn]');
  if (!selectLanguageEl) throw new Error('select_language_el not found.');

  return await new Promise<string>((resolve) => {
    selectLanguageEl.click();
    setTimeout(() => {
      const btn = document.querySelector<HTMLButtonElement>(
        `[data-testid=translator-target-lang-list] button[data-testid^=translator-lang-option-${targetLanguage}]`,
      );
      btn?.click();
    }, 200);

    setTimeout(() => {
      sourceTextarea.focus();
      sourceTextarea.textContent = text;
      sourceTextarea.dispatchEvent(new Event('input', { bubbles: true }));
    }, 400);

    const startTime = performance.now();
    function checkResult(oldValue: string | null) {
      if (performance.now() - startTime > 2400 || (targetTextarea!.textContent && targetTextarea!.textContent !== oldValue)) {
        resolve(targetTextarea!.textContent ?? '');
        return;
      }
      setTimeout(() => checkResult(oldValue), 100);
    }
    checkResult(targetTextarea.textContent);
  });
}

function injectInformation() {
  if (document.getElementById('twp-info')) return;

  const style = document.createElement('style');
  style.textContent = `
    #twp-info button {
      color: black; background-color: white; border: 1px solid black;
      box-shadow: 0 0 10px rgba(0, 0, 0, 0.5); cursor: pointer;
      padding: 5px 10px; border-radius: 10px; transition: transform 0.1s;
    }
    #twp-info button:hover { transform: scale(1.1); }
    #twp-info p { color: white; }
  `;
  document.head.appendChild(style);

  const info = document.createElement('div');
  info.id = 'twp-info';
  info.style.cssText = `
    width: 100%; padding: 10px; text-align: center;
    background: rgb(37, 108, 219); box-shadow: inset 0 0 10px rgba(0, 0, 0, 0.5);
    padding: 7px;
  `;
  info.innerHTML = `
    <p style="font-size: 20px; font-weight: bold;">TWP - FullPage</p>
    <p>This tab opened because you clicked to translate selected text using DeepL.</p>
    <button>Don't show again</button>
  `;
  document.body.insertBefore(info, document.body.firstChild);

  info.querySelector('button')?.addEventListener('click', () => {
    twpConfig.set('textTranslatorService', 'google');
    setTimeout(() => window.close(), 500);
  });
}

export default defineContentScript({
  matches: ['https://www.deepl.com/*/translator*'],
  runAt: 'document_end',
  async main() {
    await twpConfig.onReady();

    // The URL hash encodes the source text + target language when this tab
    // was opened by modules/providers/deepl.ts's live-tab bridge.
    if (location.hash.startsWith('#!')) {
      injectInformation();

      const [rawTargetLanguage, rawText] = location.hash.split('!#');
      location.hash = '';

      const targetLanguage = decodeURIComponent(rawTargetLanguage.substring(2)) || 'en';
      const text = decodeURIComponent(rawText ?? '');

      setTimeout(() => {
        translate(text, targetLanguage)
          .then((result) => sendMessage('DeepL_firstTranslationResult', { result }))
          .catch((e) => {
            console.error(e);
            return sendMessage('DeepL_firstTranslationResult', { result: '' });
          });
      }, 100);
    }

    onMessage('translateTextWithDeepL', async (message) => {
      try {
        return await translate(message.data.text, message.data.targetLanguage);
      } catch (e) {
        console.error(e);
        return '';
      }
    });
  },
});

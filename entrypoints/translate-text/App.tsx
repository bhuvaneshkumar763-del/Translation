import { createSignal, For, onMount, Show } from 'solid-js';
import type { Config } from '@/modules/config/schema';
import { twpConfig } from '@/modules/config/store';
import { codeToLanguage, fixTLanguageCode, isRtlLanguage } from '@/modules/languages';
import { sendMessage } from '@/modules/messaging/protocol';
import './App.css';

/**
 * Standalone "translate a piece of text" window, ported from
 * popup/popup-translate-text.js + popup-translate-text.html. In the old
 * code this was the pageAction fallback for the "translate selected text"
 * context-menu item — a fallback that's actually unreachable in MV3 Chrome
 * (chrome.pageAction doesn't exist there at all), so it's wired up here
 * instead as a directly-openable utility from the toolbar popup's menu, with
 * an optional #text= hash param to pre-fill (kept for compatibility with
 * that old invocation style, in case anything still opens it that way).
 */

const SERVICES: Array<Config['textTranslatorService']> = ['google', 'bing', 'yandex', 'deepl', 'libre'];
const SERVICE_LABELS: Record<Config['textTranslatorService'], string> = {
  google: 'Google',
  bing: 'Bing',
  yandex: 'Yandex',
  deepl: 'DeepL',
  libre: 'LibreTranslate',
  // Not in SERVICES above (yet) — surfacing these in this window is a
  // Session 3/4 UI call, this Record just needs to type-check.
  llm: 'AI (OpenAI-compatible)',
  builtin: 'Built-in AI',
};

function effectiveUiLanguage(): string {
  const configured = twpConfig.get('uiLanguage');
  return configured !== 'default' ? configured : browser.i18n.getUILanguage();
}

function App() {
  let origTextRef!: HTMLDivElement;
  const [ready, setReady] = createSignal(false);
  const [translatedText, setTranslatedText] = createSignal('');
  const [service, setServiceSignal] = createSignal(twpConfig.get('textTranslatorService'));
  const [targetLanguage, setTargetLanguageSignal] = createSignal(
    twpConfig.get('targetLanguageTextTranslation') ?? 'en',
  );
  const [listening, setListening] = createSignal<'original' | 'translated' | null>(null);
  const [copied, setCopied] = createSignal(false);
  // twpConfig.get() read directly in JSX is NOT reactive (a plain mutable
  // object property, not a signal) — same fix as MobilePopup.tsx and the
  // other components that hit this bug class.
  const [targetLangs, setTargetLangs] = createSignal(twpConfig.get('targetLanguages'));
  const [enabledServices, setEnabledServices] = createSignal(twpConfig.get('enabledServices'));
  const [customServices, setCustomServices] = createSignal(twpConfig.get('customServices'));

  let isPlayingAudio = false;
  let generation = 0;

  function stopAudio(): void {
    if (!isPlayingAudio) return;
    isPlayingAudio = false;
    void sendMessage('stopAudio', undefined).catch(() => {});
  }
  function playAudio(text: string, lang: string, onEnded: () => void): void {
    isPlayingAudio = true;
    void sendMessage('textToSpeech', { text, targetLanguage: lang })
      .catch(() => {})
      .then(() => {
        isPlayingAudio = false;
        onEnded();
      });
  }

  async function translate(): Promise<void> {
    const myGeneration = ++generation;
    const text = origTextRef?.textContent ?? '';
    const result = await sendMessage('translateSingleText', {
      serviceName: service(),
      sourceLanguage: 'auto',
      targetLanguage: targetLanguage(),
      text,
    }).catch(() => undefined);
    if (myGeneration !== generation) return;
    setTranslatedText(result ?? '');
  }

  let inputDebounce: ReturnType<typeof setTimeout> | null = null;
  function onOrigTextInput(): void {
    if (inputDebounce) clearTimeout(inputDebounce);
    inputDebounce = setTimeout(() => void translate(), 600);
  }

  function onServiceClick(s: Config['textTranslatorService']): void {
    setServiceSignal(s);
    void twpConfig.set('textTranslatorService', s);
    void translate();
  }
  function onTargetLanguageClick(code: string): void {
    const fixed = fixTLanguageCode(code);
    if (!fixed) return;
    setTargetLanguageSignal(fixed);
    void twpConfig.setTargetLanguageTextTranslation(fixed);
    void translate();
  }
  function onListenClick(which: 'original' | 'translated', text: string, lang: string): void {
    if (listening() === which) {
      stopAudio();
      setListening(null);
      return;
    }
    if (listening()) stopAudio();
    setListening(which);
    playAudio(text, lang, () => setListening((cur) => (cur === which ? null : cur)));
  }
  function onCopy(): void {
    void navigator.clipboard
      .writeText(translatedText())
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 500);
      })
      .catch(() => {});
  }

  const serviceOptions = () => {
    const enabled = enabledServices();
    const hasLibre = customServices().some((cs) => cs.name === 'libre');
    return SERVICES.filter((s) => (s === 'libre' ? hasLibre : enabled.includes(s)));
  };

  onMount(async () => {
    await twpConfig.onReady();
    setReady(true);
    setTargetLangs(twpConfig.get('targetLanguages'));
    setEnabledServices(twpConfig.get('enabledServices'));
    setCustomServices(twpConfig.get('customServices'));
    twpConfig.onChanged((name, value) => {
      if (name === 'targetLanguages') setTargetLangs(value as string[]);
      else if (name === 'enabledServices') setEnabledServices(value as string[]);
      else if (name === 'customServices') setCustomServices(value as Config['customServices']);
    });

    const params = new URLSearchParams(location.hash.slice(1));
    const text = params.get('text');
    if (text && origTextRef) {
      origTextRef.textContent = text;
      void translate();
    }
  });

  return (
    <Show when={ready()} fallback={<div class="loading">Loading…</div>}>
      <div class="page">
        <div class="listenRow">
          <button
            class="iconBtn"
            classList={{ on: listening() === 'original' }}
            on:click={() => onListenClick('original', origTextRef?.textContent ?? '', 'auto')}
            title="Listen"
          >
            🔊
          </button>
        </div>
        <div
          class="textbox"
          id="origText"
          ref={origTextRef}
          contentEditable
          spellcheck={false}
          dir="auto"
          on:input={onOrigTextInput}
        />
        <div class="textbox translated" dir={isRtlLanguage(targetLanguage()) ? 'rtl' : 'ltr'}>
          {translatedText()}
        </div>

        <div class="row">
          <div class="langs">
            <For each={targetLangs().slice(0, 3)}>
              {(code) => (
                <button
                  class="chip"
                  classList={{ on: code === targetLanguage() }}
                  on:click={() => onTargetLanguageClick(code)}
                >
                  {codeToLanguage(code, effectiveUiLanguage())}
                </button>
              )}
            </For>
          </div>
          <div class="services">
            <For each={serviceOptions()}>
              {(s) => (
                <button
                  class="chip"
                  classList={{ on: s === service() }}
                  title={SERVICE_LABELS[s]}
                  on:click={() => onServiceClick(s)}
                >
                  {s.charAt(0).toUpperCase()}
                </button>
              )}
            </For>
          </div>
          <div class="actions">
            <button class="iconBtn" classList={{ on: copied() }} on:click={onCopy} title="Copy">
              📋
            </button>
            <button
              class="iconBtn"
              classList={{ on: listening() === 'translated' }}
              on:click={() => onListenClick('translated', translatedText(), targetLanguage())}
              title="Listen"
            >
              🔊
            </button>
          </div>
        </div>
      </div>
    </Show>
  );
}

export default App;

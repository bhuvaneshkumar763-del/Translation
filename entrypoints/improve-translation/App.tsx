import { createSignal, For, onMount, Show } from 'solid-js';
import { twpConfig } from '@/modules/config/store';
import { sendMessage } from '@/modules/messaging/protocol';
import { codeToLanguage, fixTLanguageCode, getLanguageList } from '@/modules/languages';
import { mainFrameTarget, pageActionTarget } from '@/modules/messaging/tabTarget';
import type { Config } from '@/modules/config/schema';
import './App.css';

/**
 * The "Improve translation" standalone window, ported from
 * popup/improve-translation.js + improve-translation.html. Lets the user
 * override, for the current site, the source language (persisted to
 * fpSourceLangByHost — the same key the floating bubble's "From" picker
 * writes), the page translation service, and dontSortResults, then
 * re-translates the active tab if it's currently translated. Opened by
 * navigating the popup's own window to this page (matching the old code's
 * `window.location = "improve-translation.html"`), not a new window, so
 * closing it (via Apply or the browser chrome) just closes the popup.
 */

function effectiveUiLanguage(): string {
  const configured = twpConfig.get('uiLanguage');
  return configured !== 'default' ? configured : browser.i18n.getUILanguage();
}

function App() {
  const [ready, setReady] = createSignal(false);
  const [tabId, setTabId] = createSignal<number | undefined>();
  const [hostname, setHostname] = createSignal('');
  const [detectedTabLanguage, setDetectedTabLanguage] = createSignal('und');
  const [sourceLanguage, setSourceLanguage] = createSignal('auto');
  const [service, setService] = createSignal(twpConfig.get('pageTranslatorService'));
  const [targetLanguage, setTargetLanguageSignal] = createSignal(twpConfig.get('targetLanguage') ?? 'en');
  const [dontSortResults, setDontSortResults] = createSignal(twpConfig.get('dontSortResults'));

  onMount(async () => {
    await twpConfig.onReady();
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) {
      setReady(true);
      return;
    }
    setTabId(tab.id);
    try {
      setHostname(tab.url ? new URL(tab.url).hostname : '');
    } catch {
      setHostname('');
    }

    const savedSourceLang = twpConfig.get('fpSourceLangByHost')[hostname()];
    if (savedSourceLang) setSourceLanguage(savedSourceLang);

    const originalLang = await sendMessage('getOriginalTabLanguage', undefined, mainFrameTarget(tab.id)).catch(
      () => 'und' as const,
    );
    const fixed = fixTLanguageCode(originalLang);
    if (fixed) setDetectedTabLanguage(fixed);

    setReady(true);
  });

  function close(): void {
    window.close();
  }

  async function apply(): Promise<void> {
    const id = tabId();
    const target = targetLanguage();
    const source = sourceLanguage();

    await twpConfig.setTargetLanguage(target, true);
    await twpConfig.set('pageTranslatorService', service());
    await twpConfig.set('dontSortResults', dontSortResults());

    const host = hostname();
    if (host) {
      const map = { ...(twpConfig.get('fpSourceLangByHost') ?? {}) };
      if (source && source !== 'auto') map[host] = source;
      else delete map[host];
      await twpConfig.set('fpSourceLangByHost', map);
    }

    if (id != null) {
      const state = await sendMessage('getCurrentPageLanguageState', undefined, mainFrameTarget(id)).catch(() => 'original' as const);
      if (state === 'translated') {
        await sendMessage('translatePage', { targetLanguage: target }, pageActionTarget(id)).catch(() => {});
      }
    }
    close();
  }

  const allLangs = () => Object.entries(getLanguageList(effectiveUiLanguage())).sort((a, b) => a[1].localeCompare(b[1]));

  return (
    <Show when={ready()} fallback={<div class="loading">Loading…</div>}>
      <div class="page">
        <button class="closeBtn" on:click={close} title="Close">
          ✕
        </button>

        <div class="field">
          <label for="selectOriginalLanguage">Select the original website language</label>
          <select id="selectOriginalLanguage" value={sourceLanguage()} on:change={(e) => setSourceLanguage((e.currentTarget as HTMLSelectElement).value)}>
            <optgroup label="Recents">
              <option value="auto">Auto-detect</option>
              <Show when={detectedTabLanguage() !== 'und'}>
                <option value={detectedTabLanguage()}>{codeToLanguage(detectedTabLanguage(), effectiveUiLanguage())}</option>
              </Show>
            </optgroup>
            <optgroup label="All">
              <For each={allLangs()}>{([code, name]) => <option value={code}>{name}</option>}</For>
            </optgroup>
          </select>
        </div>

        <div class="field">
          <label for="selectTargetLanguage">Select target language</label>
          <select
            id="selectTargetLanguage"
            value={targetLanguage()}
            on:change={(e) => setTargetLanguageSignal((e.currentTarget as HTMLSelectElement).value)}
          >
            <optgroup label="Recents">
              <For each={twpConfig.get('targetLanguages')}>
                {(code) => <option value={code}>{codeToLanguage(code, effectiveUiLanguage())}</option>}
              </For>
            </optgroup>
            <optgroup label="All">
              <For each={allLangs()}>{([code, name]) => <option value={code}>{name}</option>}</For>
            </optgroup>
          </select>
        </div>

        <div class="field">
          <label for="pageTranslatorService">Page translation service</label>
          <select
            id="pageTranslatorService"
            value={service()}
            on:change={(e) => setService((e.currentTarget as HTMLSelectElement).value as Config['pageTranslatorService'])}
          >
            <option value="google">Google</option>
            <option value="bing">Bing</option>
            <option value="yandex">Yandex</option>
          </select>
        </div>

        <hr />

        <div class="field">
          <label for="dontSortResults">Do not sort translation results</label>
          <select
            id="dontSortResults"
            value={dontSortResults()}
            on:change={(e) => setDontSortResults((e.currentTarget as HTMLSelectElement).value as Config['dontSortResults'])}
          >
            <option value="no">No</option>
            <option value="yes">Yes</option>
          </select>
        </div>

        <button class="applyBtn" on:click={apply}>
          Apply
        </button>
      </div>
    </Show>
  );
}

export default App;

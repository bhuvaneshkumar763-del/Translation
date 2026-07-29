import { createSignal, createResource, For, Show, onMount } from 'solid-js';
import type { Browser } from 'wxt/browser';
import { twpConfig } from '@/modules/config/store';
import { sendMessage } from '@/modules/messaging/protocol';
import { codeToLanguage, fixTLanguageCode } from '@/modules/languages';
import type { Config } from '@/modules/config/schema';
import './App.css';

/**
 * The toolbar popup, ported from popup/popup.js + popup.html. Simplified
 * relative to the old version: no w3.css (hand-rolled CSS instead, same call
 * as elsewhere in this rewrite), no "switch to old-popup"/simple-vs-complex
 * toggle (the old-popup alternate UI itself isn't ported in this phase — see
 * the Phase 6 commit notes), and the "more/less" expand only covers the
 * hover-related checkboxes rather than the old code's more granular
 * per-section reveal state (`popupPanelSection`).
 */

const SERVICE_LABELS: Record<Config['pageTranslatorService'], string> = {
  google: 'Google',
  bing: 'Bing',
  yandex: 'Yandex',
};

async function getActiveTab(): Promise<Browser.tabs.Tab | undefined> {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  return tab;
}

function effectiveUiLanguage(): string {
  const configured = twpConfig.get('uiLanguage');
  return configured !== 'default' ? configured : browser.i18n.getUILanguage();
}

function App() {
  const [ready, setReady] = createSignal(false);
  const [tabId, setTabId] = createSignal<number | undefined>();
  const [hostname, setHostname] = createSignal('');
  const [pageState, setPageState] = createSignal<'original' | 'translated'>('original');
  const [originalLanguage, setOriginalLanguage] = createSignal('und');
  const [service, setServiceSignal] = createSignal(twpConfig.get('pageTranslatorService'));
  const [targetLanguage, setTargetLanguageSignal] = createSignal(twpConfig.get('targetLanguage') ?? 'en');
  const [showMore, setShowMore] = createSignal(false);
  const [busy, setBusy] = createSignal(false);

  onMount(async () => {
    await twpConfig.onReady();
    const tab = await getActiveTab();
    if (!tab?.id) return;
    setTabId(tab.id);
    try {
      setHostname(tab.url ? new URL(tab.url).hostname : '');
    } catch {
      setHostname('');
    }

    const [state, originalLang] = await Promise.all([
      sendMessage('getCurrentPageLanguageState', undefined, tab.id).catch(() => 'original' as const),
      sendMessage('getOriginalTabLanguage', undefined, tab.id).catch(() => 'und'),
    ]);
    setPageState(state);
    setOriginalLanguage(originalLang);
    setReady(true);

    twpConfig.onChanged((name, value) => {
      if (name === 'pageTranslatorService') setServiceSignal(value as Config['pageTranslatorService']);
      else if (name === 'targetLanguage') setTargetLanguageSignal((value as string | null) ?? 'en');
    });
  });

  async function toggleTranslate(): Promise<void> {
    const id = tabId();
    if (!id) return;
    setBusy(true);
    if (pageState() === 'translated') {
      await sendMessage('restorePage', undefined, id);
      setPageState('original');
    } else {
      await sendMessage('translatePage', { targetLanguage: targetLanguage() }, id);
      setPageState('translated');
    }
    setBusy(false);
  }

  async function translateToLanguage(code: string): Promise<void> {
    const id = tabId();
    if (!id) return;
    const fixed = fixTLanguageCode(code) ?? code;
    setBusy(true);
    setTargetLanguageSignal(fixed);
    await twpConfig.setTargetLanguage(fixed);
    await sendMessage('translatePage', { targetLanguage: fixed }, id);
    setPageState('translated');
    setBusy(false);
  }

  async function onSwapService(): Promise<void> {
    const id = tabId();
    if (!id) return;
    const next = await sendMessage('swapTranslationService', undefined, id).catch(() => service());
    setServiceSignal(next as Config['pageTranslatorService']);
  }

  function toggleAlwaysTranslateLang(): void {
    const lang = originalLanguage();
    if (lang === 'und') return;
    if (!twpConfig.get('alwaysTranslateLangs').includes(lang)) void twpConfig.addLangToAlwaysTranslate(lang, hostname());
    else void twpConfig.removeLangFromAlwaysTranslate(lang);
  }
  function toggleAlwaysTranslateSite(): void {
    const host = hostname();
    if (!host) return;
    if (!twpConfig.get('alwaysTranslateSites').includes(host)) void twpConfig.addSiteToAlwaysTranslate(host);
    else void twpConfig.removeSiteFromAlwaysTranslate(host);
  }
  function toggleNeverTranslateSite(): void {
    const host = hostname();
    if (!host) return;
    if (!twpConfig.get('neverTranslateSites').includes(host)) {
      void twpConfig.addSiteToNeverTranslate(host);
      const id = tabId();
      if (id) void sendMessage('restorePage', undefined, id);
      setPageState('original');
    } else {
      void twpConfig.removeSiteFromNeverTranslate(host);
    }
  }
  function toggleFloatingBubble(): void {
    const host = hostname();
    const map = { ...(twpConfig.get('fpBubbleByHost') ?? {}) };
    const currentlyVisible = Object.prototype.hasOwnProperty.call(map, host)
      ? map[host] !== 'no'
      : twpConfig.get('fpShowFloatingBubble') !== 'no';
    map[host] = currentlyVisible ? 'no' : 'yes';
    void twpConfig.set('fpBubbleByHost', map);
  }
  function toggleShowTranslateSelectedButton(): void {
    void twpConfig.set('showTranslateSelectedButton', twpConfig.get('showTranslateSelectedButton') === 'yes' ? 'no' : 'yes');
  }
  function toggleShowOriginalOnHover(): void {
    void twpConfig.set('showOriginalTextWhenHovering', twpConfig.get('showOriginalTextWhenHovering') === 'yes' ? 'no' : 'yes');
  }
  function toggleShowTranslatedOnHoverSite(): void {
    const host = hostname();
    if (!host) return;
    if (!twpConfig.get('sitesToTranslateWhenHovering').includes(host)) void twpConfig.addSiteToTranslateWhenHovering(host);
    else void twpConfig.removeSiteFromTranslateWhenHovering(host);
  }
  function toggleShowTranslatedOnHoverLang(): void {
    const lang = originalLanguage();
    if (lang === 'und') return;
    if (!twpConfig.get('langsToTranslateWhenHovering').includes(lang)) void twpConfig.addLangToTranslateWhenHovering(lang);
    else void twpConfig.removeLangFromTranslateWhenHovering(lang);
  }
  function openInGoogleTranslate(): void {
    const id = tabId();
    if (!id) return;
    void browser.tabs.get(id).then((tab) => {
      if (!tab.url) return;
      const url = `https://translate.google.com/translate?sl=auto&tl=${targetLanguage().split('-')[0]}&u=${encodeURIComponent(tab.url)}`;
      void browser.tabs.create({ url });
    });
  }
  function openOptions(): void {
    void browser.runtime.openOptionsPage().catch(() => {});
  }

  const [langResource] = createResource(originalLanguage, (lang) => codeToLanguage(lang === 'und' ? 'en' : lang, effectiveUiLanguage()));

  return (
    <Show when={ready()} fallback={<div class="loading">Loading…</div>}>
      <div class="popup">
        <div class="topRow">
          <button class="langBtn" classList={{ active: pageState() === 'original' }} on:click={toggleTranslate} disabled={busy()}>
            {pageState() === 'original' ? `Original (${langResource() ?? '…'})` : 'Show original'}
          </button>
          <For each={twpConfig.get('targetLanguages').slice(0, 3)}>
            {(code) => (
              <button
                class="langBtn"
                classList={{ active: pageState() === 'translated' && code === targetLanguage() }}
                on:click={() => translateToLanguage(code)}
                disabled={busy()}
              >
                {codeToLanguage(code, effectiveUiLanguage())}
              </button>
            )}
          </For>
        </div>

        <div class="serviceRow">
          <button class="serviceBtn" on:click={onSwapService} title="Switch translation service">
            {SERVICE_LABELS[service()]}
          </button>
        </div>

        <div class="checks">
          <Show when={originalLanguage() !== 'und' && originalLanguage() !== targetLanguage()}>
            <label class="check">
              <input type="checkbox" checked={twpConfig.get('alwaysTranslateLangs').includes(originalLanguage())} on:change={toggleAlwaysTranslateLang} />
              Always translate from {langResource()}
            </label>
          </Show>
          <label class="check">
            <input type="checkbox" checked={twpConfig.get('alwaysTranslateSites').includes(hostname())} on:change={toggleAlwaysTranslateSite} />
            Always translate this site
          </label>
          <label class="check bubbleToggle">
            <input
              type="checkbox"
              checked={
                Object.prototype.hasOwnProperty.call(twpConfig.get('fpBubbleByHost') ?? {}, hostname())
                  ? twpConfig.get('fpBubbleByHost')[hostname()] !== 'no'
                  : twpConfig.get('fpShowFloatingBubble') !== 'no'
              }
              on:change={toggleFloatingBubble}
            />
            Show the floating translate bubble
          </label>
        </div>

        <div class="expandBtn" on:click={() => setShowMore(!showMore())}>
          {showMore() ? 'Less ▲' : 'More ▼'}
        </div>

        <Show when={showMore()}>
          <div class="checks">
            <label class="check">
              <input
                type="checkbox"
                checked={twpConfig.get('showTranslateSelectedButton') === 'yes'}
                on:change={toggleShowTranslateSelectedButton}
              />
              Show the button to translate selected text
            </label>
            <label class="check">
              <input
                type="checkbox"
                checked={twpConfig.get('showOriginalTextWhenHovering') === 'yes'}
                on:change={toggleShowOriginalOnHover}
              />
              Show original text when hovering
            </label>
            <label class="check">
              <input
                type="checkbox"
                checked={twpConfig.get('sitesToTranslateWhenHovering').includes(hostname())}
                on:change={toggleShowTranslatedOnHoverSite}
              />
              Show translation when hovering over this site
            </label>
            <Show when={originalLanguage() !== 'und'}>
              <label class="check">
                <input
                  type="checkbox"
                  checked={twpConfig.get('langsToTranslateWhenHovering').includes(originalLanguage())}
                  on:change={toggleShowTranslatedOnHoverLang}
                />
                Show translation when hovering over websites in {langResource()}
              </label>
            </Show>
          </div>
        </Show>

        <div class="menuRow">
          <button class="menuBtn" on:click={toggleNeverTranslateSite}>
            Never translate this site
          </button>
          <button class="menuBtn" on:click={openInGoogleTranslate}>
            Open in Google Translate
          </button>
          <button class="menuBtn" on:click={openOptions}>
            More options…
          </button>
        </div>
      </div>
    </Show>
  );
}

export default App;

import { createResource, createSignal, For, onMount, Show } from 'solid-js';
import { createStore } from 'solid-js/store';
import type { Browser } from 'wxt/browser';
import { type Config, type ConfigKey, defaultConfig } from '@/modules/config/schema';
import { twpConfig } from '@/modules/config/store';
import { codeToLanguage, fixTLanguageCode } from '@/modules/languages';
import { sendEnsuringContentScript } from '@/modules/messaging/ensureContentScript';
import { sendMessage } from '@/modules/messaging/protocol';
import { mainFrameTarget, pageActionTarget } from '@/modules/messaging/tabTarget';
import './App.css';

/**
 * The toolbar popup, ported from popup/popup.js + popup.html. Simplified
 * relative to the old version: no w3.css (hand-rolled CSS instead, same call
 * as elsewhere in this rewrite), no old-popup alternate skin (deleted in
 * Gen 2 Session 3 — one popup now, not two), and the "more/less" expand
 * only covers the hover-related checkboxes rather than the old code's more
 * granular per-section reveal state (`popupPanelSection`).
 *
 * Gen 2 Session 3: rebuilt on `styles/tokens.css`'s design language — same
 * functions/handlers/state as before, new layout (header + primary CTA +
 * pill row + toggle rows + menu list) instead of the flat button stack.
 */

const SERVICE_LABELS: Record<Config['pageTranslatorService'], string> = {
  google: 'Google',
  bing: 'Bing',
  yandex: 'Yandex',
  // Not in the quick-switch service button row (yet) — curated placement
  // is a Session 3 UI call, this Record just needs to type-check.
  llm: 'AI',
  builtin: 'Built-in AI',
};

async function getActiveTab(): Promise<Browser.tabs.Tab | undefined> {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  return tab;
}

function effectiveUiLanguage(uiLanguage: string): string {
  return uiLanguage !== 'default' ? uiLanguage : browser.i18n.getUILanguage();
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

  // `cfg` mirrors twpConfig's state as a genuine Solid store, for every
  // config-driven JSX read below other than `service`/`targetLanguage`
  // (which already have their own dedicated signals, incl. deliberate
  // optimistic updates in translateToLanguage/onSwapService below — left
  // untouched). twpConfig.get() read directly in JSX is NOT reactive: it's
  // a plain mutable object property, not a signal, so Solid has nothing to
  // subscribe to and the expression only evaluates once, at mount. This
  // was a real bug here too (same root cause fixed in options/App.tsx):
  // toggling "always translate this site" correctly persisted the setting
  // but the checkbox never visually reflected other list-driven state
  // (hover-translate lists, per-host bubble overrides) changing elsewhere.
  const [cfg, setCfg] = createStore<Config>({ ...defaultConfig });

  onMount(async () => {
    await twpConfig.onReady();
    setCfg(Object.fromEntries((Object.keys(defaultConfig) as ConfigKey[]).map((k) => [k, twpConfig.get(k)])) as Config);
    const tab = await getActiveTab();
    if (!tab?.id) return;
    setTabId(tab.id);
    try {
      setHostname(tab.url ? new URL(tab.url).hostname : '');
    } catch {
      setHostname('');
    }

    const [state, originalLang] = await Promise.all([
      sendMessage('getCurrentPageLanguageState', undefined, mainFrameTarget(tab.id)).catch(() => 'original' as const),
      sendMessage('getOriginalTabLanguage', undefined, mainFrameTarget(tab.id)).catch(() => 'und'),
    ]);
    setPageState(state);
    setOriginalLanguage(originalLang);
    setReady(true);

    twpConfig.onChanged((name, value) => {
      setCfg(name, value as never);
      if (name === 'pageTranslatorService') setServiceSignal(value as Config['pageTranslatorService']);
      else if (name === 'targetLanguage') setTargetLanguageSignal((value as string | null) ?? 'en');
    });
  });

  async function toggleTranslate(): Promise<void> {
    const id = tabId();
    if (!id) return;
    setBusy(true);
    if (pageState() === 'translated') {
      await sendEnsuringContentScript(id, () => sendMessage('restorePage', undefined, pageActionTarget(id)));
      setPageState('original');
    } else {
      await sendEnsuringContentScript(id, () =>
        sendMessage('translatePage', { targetLanguage: targetLanguage() }, pageActionTarget(id)),
      );
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
    await sendEnsuringContentScript(id, () =>
      sendMessage('translatePage', { targetLanguage: fixed }, pageActionTarget(id)),
    );
    setPageState('translated');
    setBusy(false);
  }

  async function onSwapService(): Promise<void> {
    const id = tabId();
    if (!id) return;
    const next = await sendEnsuringContentScript(id, () =>
      sendMessage('swapTranslationService', undefined, mainFrameTarget(id)),
    );
    setServiceSignal((next as Config['pageTranslatorService'] | undefined) ?? service());
  }

  function toggleAlwaysTranslateLang(): void {
    const lang = originalLanguage();
    if (lang === 'und') return;
    if (!twpConfig.get('alwaysTranslateLangs').includes(lang)) {
      void twpConfig.addLangToAlwaysTranslate(lang, hostname());
    } else void twpConfig.removeLangFromAlwaysTranslate(lang);
  }
  function toggleAlwaysTranslateSite(): void {
    const host = hostname();
    if (!host) return;
    if (!twpConfig.get('alwaysTranslateSites').includes(host)) {
      void twpConfig.addSiteToAlwaysTranslate(host);
    } else void twpConfig.removeSiteFromAlwaysTranslate(host);
  }
  function toggleNeverTranslateSite(): void {
    const host = hostname();
    if (!host) return;
    if (!twpConfig.get('neverTranslateSites').includes(host)) {
      void twpConfig.addSiteToNeverTranslate(host);
      const id = tabId();
      if (id) void sendMessage('restorePage', undefined, pageActionTarget(id));
      setPageState('original');
    } else {
      void twpConfig.removeSiteFromNeverTranslate(host);
    }
  }
  function toggleFloatingBubble(): void {
    const host = hostname();
    const map = { ...(twpConfig.get('fpBubbleByHost') ?? {}) };
    const currentlyVisible = Object.hasOwn(map, host)
      ? map[host] !== 'no'
      : twpConfig.get('fpShowFloatingBubble') !== 'no';
    map[host] = currentlyVisible ? 'no' : 'yes';
    void twpConfig.set('fpBubbleByHost', map);
  }
  function toggleShowTranslateSelectedButton(): void {
    void twpConfig.set(
      'showTranslateSelectedButton',
      twpConfig.get('showTranslateSelectedButton') === 'yes' ? 'no' : 'yes',
    );
  }
  function toggleShowOriginalOnHover(): void {
    void twpConfig.set(
      'showOriginalTextWhenHovering',
      twpConfig.get('showOriginalTextWhenHovering') === 'yes' ? 'no' : 'yes',
    );
  }
  function toggleShowTranslatedOnHoverSite(): void {
    const host = hostname();
    if (!host) return;
    if (!twpConfig.get('sitesToTranslateWhenHovering').includes(host))
      void twpConfig.addSiteToTranslateWhenHovering(host);
    else void twpConfig.removeSiteFromTranslateWhenHovering(host);
  }
  function toggleShowTranslatedOnHoverLang(): void {
    const lang = originalLanguage();
    if (lang === 'und') return;
    if (!twpConfig.get('langsToTranslateWhenHovering').includes(lang))
      void twpConfig.addLangToTranslateWhenHovering(lang);
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
  function openImproveTranslation(): void {
    window.location.href = browser.runtime.getURL('/improve-translation.html');
  }
  function openTranslateText(): void {
    void browser.tabs.create({ url: browser.runtime.getURL('/translate-text.html') });
  }
  function openTranslateDocument(): void {
    void browser.tabs.create({ url: browser.runtime.getURL('/translate-document.html') });
  }

  const [langResource] = createResource(originalLanguage, (lang) =>
    codeToLanguage(lang === 'und' ? 'en' : lang, effectiveUiLanguage(cfg.uiLanguage)),
  );

  const translated = () => pageState() === 'translated';

  return (
    <Show when={ready()} fallback={<div class="loading">Loading…</div>}>
      <div class="popup">
        <header class="header">
          <div class="brand">
            <svg class="brandIcon" viewBox="0 0 128 128" aria-hidden="true">
              <polygon points="56.3,29.2 32.6,72 80,72" fill="currentColor" />
              <circle cx="87" cy="65" r="5.6" fill="var(--prism-accent-amber)" />
              <circle cx="97" cy="72" r="4.1" fill="var(--prism-accent-rose)" />
              <circle cx="106" cy="79" r="2.7" fill="var(--prism-accent-teal)" />
            </svg>
            <span class="brandName">Prism</span>
          </div>
          <span class="statusPill" classList={{ on: translated() }}>
            {translated() ? 'Translated' : `Original · ${langResource() ?? '…'}`}
          </span>
        </header>

        <button type="button" class="primaryBtn" on:click={toggleTranslate} disabled={busy()}>
          {translated() ? 'Show original' : 'Translate this page'}
        </button>

        <div class="langPills" role="group" aria-label="Quick target languages">
          <For each={cfg.targetLanguages.slice(0, 3)}>
            {(code) => (
              <button
                type="button"
                class="langPill"
                classList={{ on: translated() && code === targetLanguage() }}
                on:click={() => translateToLanguage(code)}
                disabled={busy()}
              >
                {codeToLanguage(code, effectiveUiLanguage(cfg.uiLanguage))}
              </button>
            )}
          </For>
        </div>

        <button type="button" class="serviceChip" on:click={onSwapService} title="Switch translation service">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
            <path d="M7 7h11M7 7l3-3M7 7l3 3M17 17H6m11 0-3 3m3-3-3-3" />
          </svg>
          <span>Using {SERVICE_LABELS[service()]}</span>
        </button>

        <div class="toggleList">
          <Show when={originalLanguage() !== 'und' && originalLanguage() !== targetLanguage()}>
            <label class="toggleRow">
              <span>Always translate from {langResource()}</span>
              <input
                type="checkbox"
                checked={cfg.alwaysTranslateLangs.includes(originalLanguage())}
                on:change={toggleAlwaysTranslateLang}
              />
            </label>
          </Show>
          <label class="toggleRow">
            <span>Always translate this site</span>
            <input
              type="checkbox"
              checked={cfg.alwaysTranslateSites.includes(hostname())}
              on:change={toggleAlwaysTranslateSite}
            />
          </label>
          <label class="toggleRow accent">
            <span>Show the floating translate bubble</span>
            <input
              type="checkbox"
              checked={
                Object.hasOwn(cfg.fpBubbleByHost ?? {}, hostname())
                  ? cfg.fpBubbleByHost[hostname()] !== 'no'
                  : cfg.fpShowFloatingBubble !== 'no'
              }
              on:change={toggleFloatingBubble}
            />
          </label>
        </div>

        <button type="button" class="expandBtn" aria-expanded={showMore()} on:click={() => setShowMore(!showMore())}>
          {showMore() ? 'Less' : 'More settings'}
          <svg
            class="chev"
            classList={{ open: showMore() }}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2.2"
            aria-hidden="true"
          >
            <path d="m6 9 6 6 6-6" />
          </svg>
        </button>

        <Show when={showMore()}>
          <div class="toggleList">
            <label class="toggleRow">
              <span>Show the button to translate selected text</span>
              <input
                type="checkbox"
                checked={cfg.showTranslateSelectedButton === 'yes'}
                on:change={toggleShowTranslateSelectedButton}
              />
            </label>
            <label class="toggleRow">
              <span>Show original text when hovering</span>
              <input
                type="checkbox"
                checked={cfg.showOriginalTextWhenHovering === 'yes'}
                on:change={toggleShowOriginalOnHover}
              />
            </label>
            <label class="toggleRow">
              <span>Show translation when hovering over this site</span>
              <input
                type="checkbox"
                checked={cfg.sitesToTranslateWhenHovering.includes(hostname())}
                on:change={toggleShowTranslatedOnHoverSite}
              />
            </label>
            <Show when={originalLanguage() !== 'und'}>
              <label class="toggleRow">
                <span>Show translation when hovering over websites in {langResource()}</span>
                <input
                  type="checkbox"
                  checked={cfg.langsToTranslateWhenHovering.includes(originalLanguage())}
                  on:change={toggleShowTranslatedOnHoverLang}
                />
              </label>
            </Show>
          </div>
        </Show>

        <nav class="menuList">
          <button type="button" class="menuBtn" on:click={openImproveTranslation}>
            Improve translation…
          </button>
          <button type="button" class="menuBtn" on:click={openTranslateText}>
            Translate text…
          </button>
          <button type="button" class="menuBtn" on:click={openTranslateDocument}>
            Translate document…
          </button>
          <button type="button" class="menuBtn" on:click={toggleNeverTranslateSite}>
            Never translate this site
          </button>
          <button type="button" class="menuBtn" on:click={openInGoogleTranslate}>
            Open in Google Translate
          </button>
          <button type="button" class="menuBtn" on:click={openOptions}>
            More options…
          </button>
        </nav>
      </div>
    </Show>
  );
}

export default App;

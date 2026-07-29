import { createSignal, For, Show, onMount } from 'solid-js';
import { twpConfig } from '@/modules/config/store';
import { sendMessage } from '@/modules/messaging/protocol';
import { codeToLanguage, fixTLanguageCode, getLanguageList } from '@/modules/languages';
import { mainFrameTarget, pageActionTarget } from '@/modules/messaging/tabTarget';
import type { Config } from '@/modules/config/schema';
import './App.css';

/**
 * The alternate "old" toolbar popup, ported from popup/old-popup.js +
 * old-popup.html — a select-driven options menu instead of the new popup's
 * button list, kept as a genuinely distinct skin (per useOldPopup) rather
 * than folded into entrypoints/popup. The old code's "translating"/"error"
 * pageLanguageState cases and the vestigial getCurrentPageLanguage fetch are
 * both dead code (pageLanguageState only ever takes 'original'/'translated'
 * in both the old and new page-translator engines) and are omitted here.
 * Donation link and PDF-upstream-service menu entries are dropped, matching
 * the same upstream-integration carve-outs made throughout this rewrite.
 */

const SERVICE_LABELS: Record<Config['pageTranslatorService'], string> = {
  google: 'Google',
  bing: 'Bing',
  yandex: 'Yandex',
};

function effectiveUiLanguage(): string {
  const configured = twpConfig.get('uiLanguage');
  return configured !== 'default' ? configured : browser.i18n.getUILanguage();
}

const MENU_PLACEHOLDER = 'options';

function App() {
  const [ready, setReady] = createSignal(false);
  const [tabId, setTabId] = createSignal<number | undefined>();
  const [hostname, setHostname] = createSignal('');
  const [originalTabLanguage, setOriginalTabLanguage] = createSignal('und');
  const [pageState, setPageState] = createSignal<'original' | 'translated'>('original');
  const [service, setService] = createSignal(twpConfig.get('pageTranslatorService'));
  const [targetLanguage, setTargetLanguageSignal] = createSignal(twpConfig.get('targetLanguage') ?? 'en');
  const [showChangeLanguage, setShowChangeLanguage] = createSignal(false);
  const [busy, setBusy] = createSignal(false);
  // Deliberately uncontrolled (ref, not a value={} signal binding): the
  // select's DOM value changes on every user pick without the placeholder
  // signal itself ever changing, so a signal-driven reset would be a no-op
  // under Solid's Object.is equality bail-out — the framework would never
  // see the value "change" back to the placeholder it already thinks it's
  // at. Reset it imperatively instead, same as old-popup.js's
  // `btnOptions.value = "options"`.
  let menuSelectRef: HTMLSelectElement | undefined;
  // Bumped after any twpConfig mutation so the ✔-prefixed menu labels and
  // checkboxes re-read directly from twpConfig instead of duplicating its
  // state into more signals. JSX must read config via cfg() (not
  // twpConfig.get directly) for the bump to be reactive.
  const [configTick, setConfigTick] = createSignal(0);
  const bump = () => setConfigTick((n) => n + 1);
  const cfg = <K extends keyof Config>(key: K): Config[K] => {
    configTick();
    return twpConfig.get(key);
  };

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

    const [state, originalLang] = await Promise.all([
      sendMessage('getCurrentPageLanguageState', undefined, mainFrameTarget(tab.id)).catch(() => 'original' as const),
      sendMessage('getOriginalTabLanguage', undefined, mainFrameTarget(tab.id)).catch(() => 'und'),
    ]);
    setPageState(state);
    const fixed = fixTLanguageCode(originalLang);
    if (fixed) setOriginalTabLanguage(fixed);
    setReady(true);

    twpConfig.onChanged((name, value) => {
      if (name === 'pageTranslatorService') setService(value as Config['pageTranslatorService']);
      else if (name === 'targetLanguage') setTargetLanguageSignal((value as string | null) ?? 'en');
      bump();
    });
  });

  async function onTranslateClick(chosenTarget?: string): Promise<void> {
    const id = tabId();
    if (!id) return;
    const target = chosenTarget ?? targetLanguage();
    setBusy(true);
    const changed = twpConfig.get('targetLanguage') !== target;
    await twpConfig.setTargetLanguage(target, changed);
    setTargetLanguageSignal(target);
    await sendMessage('translatePage', { targetLanguage: target }, pageActionTarget(id)).catch(() => {});
    setPageState('translated');
    setShowChangeLanguage(false);
    setBusy(false);
  }

  async function onRestoreClick(): Promise<void> {
    const id = tabId();
    if (!id) return;
    setPageState('original');
    await sendMessage('restorePage', undefined, pageActionTarget(id)).catch(() => {});
  }

  async function onSwapService(): Promise<void> {
    const id = tabId();
    if (!id) return;
    const next = await sendMessage('swapTranslationService', undefined, mainFrameTarget(id)).catch(() => service());
    setService(next as Config['pageTranslatorService']);
  }

  function switchToNewPopup(): void {
    void twpConfig.set('useOldPopup', 'no');
    window.location.href = browser.runtime.getURL('/popup.html');
  }

  function openImproveTranslation(): void {
    window.location.href = browser.runtime.getURL('/improve-translation.html');
  }

  function toggleAlwaysTranslateThisLang(checked: boolean): void {
    const lang = originalTabLanguage();
    if (lang === 'und') return;
    if (checked) void twpConfig.addLangToAlwaysTranslate(lang, hostname());
    else void twpConfig.removeLangFromAlwaysTranslate(lang);
    bump();
  }

  async function onMenuChange(value: string): Promise<void> {
    const host = hostname();
    switch (value) {
      case 'changeLanguage':
        setShowChangeLanguage(true);
        break;
      case 'alwaysTranslateThisSite':
        if (host) {
          if (!twpConfig.get('alwaysTranslateSites').includes(host)) {
            await twpConfig.addSiteToAlwaysTranslate(host);
            await onTranslateClick();
          } else {
            await twpConfig.removeSiteFromAlwaysTranslate(host);
          }
        }
        window.close();
        break;
      case 'neverTranslateThisSite':
        if (host) {
          if (!twpConfig.get('neverTranslateSites').includes(host)) {
            await twpConfig.addSiteToNeverTranslate(host);
            await onRestoreClick();
          } else {
            await twpConfig.removeSiteFromNeverTranslate(host);
          }
        }
        window.close();
        break;
      case 'neverTranslateThisLanguage': {
        const lang = originalTabLanguage();
        if (lang !== 'und') {
          if (!twpConfig.get('neverTranslateLangs').includes(lang)) {
            await twpConfig.addLangToNeverTranslate(lang, host);
            await onRestoreClick();
          } else {
            await twpConfig.removeLangFromNeverTranslate(lang);
          }
        }
        window.close();
        break;
      }
      case 'showTranslateSelectedButton':
        await twpConfig.set('showTranslateSelectedButton', twpConfig.get('showTranslateSelectedButton') === 'yes' ? 'no' : 'yes');
        window.close();
        break;
      case 'showOriginalTextWhenHovering':
        await twpConfig.set('showOriginalTextWhenHovering', twpConfig.get('showOriginalTextWhenHovering') === 'yes' ? 'no' : 'yes');
        window.close();
        break;
      case 'showTranslatedWhenHoveringThisSite':
        if (host) {
          if (!twpConfig.get('sitesToTranslateWhenHovering').includes(host)) await twpConfig.addSiteToTranslateWhenHovering(host);
          else await twpConfig.removeSiteFromTranslateWhenHovering(host);
        }
        window.close();
        break;
      case 'showTranslatedWhenHoveringThisLang': {
        const lang = originalTabLanguage();
        if (lang !== 'und') {
          if (!twpConfig.get('langsToTranslateWhenHovering').includes(lang)) await twpConfig.addLangToTranslateWhenHovering(lang);
          else await twpConfig.removeLangFromTranslateWhenHovering(lang);
        }
        window.close();
        break;
      }
      case 'translateInExternalSite': {
        const id = tabId();
        if (id) {
          const tab = await browser.tabs.get(id);
          if (tab.url) {
            const url =
              service() === 'yandex'
                ? `https://translate.yandex.com/translate?view=compact&url=${encodeURIComponent(tab.url)}&lang=${targetLanguage().split('-')[0]}`
                : `https://translate.google.com/translate?tl=${targetLanguage()}&u=${encodeURIComponent(tab.url)}`;
            await browser.tabs.create({ url });
          }
        }
        break;
      }
      case 'moreOptions':
        await browser.runtime.openOptionsPage().catch(() => {});
        break;
      default:
        break;
    }
    if (menuSelectRef) menuSelectRef.value = MENU_PLACEHOLDER;
    bump();
  }

  const allLangs = () => Object.entries(getLanguageList(effectiveUiLanguage())).sort((a, b) => a[1].localeCompare(b[1]));
  const showAlwaysTranslateCheckbox = () => originalTabLanguage() !== 'und' && originalTabLanguage() !== cfg('targetLanguage');

  const externalSiteLabel = () => (service() === 'yandex' ? 'Open on Yandex Translator' : 'Open in Google Translate');
  const checkMark = (active: boolean) => (active ? '✔ ' : '');

  return (
    <Show when={ready()} fallback={<div class="loading">Loading…</div>}>
      <main>
        <div class="topRight">
          <button class="iconBtn" on:click={switchToNewPopup} title="Switch between simple and complex interface">
            ⇄
          </button>
        </div>

        <Show when={showChangeLanguage()}>
          <label>Select target language</label>
          <br />
          <select
            id="selectTargetLanguage"
            value={targetLanguage()}
            on:change={(e) => setTargetLanguageSignal((e.currentTarget as HTMLSelectElement).value)}
          >
            <optgroup label="Recents">
              <For each={cfg('targetLanguages')}>
                {(code) => <option value={code}>{codeToLanguage(code, effectiveUiLanguage())}</option>}
              </For>
            </optgroup>
            <optgroup label="All">
              <For each={allLangs()}>{([code, name]) => <option value={code}>{name}</option>}</For>
            </optgroup>
          </select>
          <div class="flexRow">
            <button on:click={() => setShowChangeLanguage(false)}>Reset</button>
            <button class="primary" on:click={() => void onTranslateClick(targetLanguage())} disabled={busy()}>
              Translate
            </button>
          </div>
        </Show>

        <Show when={!showChangeLanguage()}>
          <Show when={pageState() === 'original'}>
            <label>Translate page into {codeToLanguage(targetLanguage(), effectiveUiLanguage())}?</label>
            <Show when={originalTabLanguage() !== 'und'}>
              <div class="checkRow">
                <input
                  type="checkbox"
                  id="cbAlwaysTranslateThisLang"
                  checked={cfg('alwaysTranslateLangs').includes(originalTabLanguage())}
                  disabled={!showAlwaysTranslateCheckbox()}
                  on:change={(e) => toggleAlwaysTranslateThisLang((e.currentTarget as HTMLInputElement).checked)}
                />
                <label for="cbAlwaysTranslateThisLang">Always translate from {codeToLanguage(originalTabLanguage(), effectiveUiLanguage())}</label>
              </div>
            </Show>
          </Show>
          <Show when={pageState() === 'translated'}>
            <label>Page translated into {codeToLanguage(targetLanguage(), effectiveUiLanguage())}</label>
          </Show>

          <div class="flex-container">
            <div class="serviceSwap" title="Switch translation service" on:click={() => void onSwapService()}>
              {SERVICE_LABELS[service()]}
            </div>

            <div class="rightButtons">
              <Show when={pageState() === 'original'}>
                <button class="primary" on:click={() => void onTranslateClick()} disabled={busy()}>
                  Translate
                </button>
              </Show>
              <Show when={pageState() === 'translated'}>
                <button on:click={() => void onRestoreClick()}>Show original</button>
              </Show>
              <select
                id="btnOptions"
                ref={menuSelectRef}
                on:change={(e) => void onMenuChange((e.currentTarget as HTMLSelectElement).value)}
              >
                <option value={MENU_PLACEHOLDER} disabled hidden>
                  Options
                </option>
                <option value="changeLanguage">Choose another language</option>
                <option value="alwaysTranslateThisSite">
                  {checkMark(cfg('alwaysTranslateSites').includes(hostname()))}Always translate this site
                </option>
                <option value="neverTranslateThisSite">
                  {checkMark(cfg('neverTranslateSites').includes(hostname()))}Never translate this site
                </option>
                <Show when={originalTabLanguage() !== 'und'}>
                  <option value="neverTranslateThisLanguage">
                    {checkMark(cfg('neverTranslateLangs').includes(originalTabLanguage()))}Never translate this language
                  </option>
                </Show>
                <option value="showTranslateSelectedButton">
                  {checkMark(cfg('showTranslateSelectedButton') === 'yes')}Show the button to translate the selected text
                </option>
                <option value="showOriginalTextWhenHovering">
                  {checkMark(cfg('showOriginalTextWhenHovering') === 'yes')}Show original text when hovering
                </option>
                <option value="showTranslatedWhenHoveringThisSite">
                  {checkMark(cfg('sitesToTranslateWhenHovering').includes(hostname()))}Show translation when hovering over this site
                </option>
                <Show when={originalTabLanguage() !== 'und'}>
                  <option value="showTranslatedWhenHoveringThisLang">
                    {checkMark(cfg('langsToTranslateWhenHovering').includes(originalTabLanguage()))}Show translation when hovering
                    over websites in {codeToLanguage(originalTabLanguage(), effectiveUiLanguage())}
                  </option>
                </Show>
                <option value="translateInExternalSite">{externalSiteLabel()}</option>
                <option value="moreOptions">More options</option>
              </select>
            </div>
          </div>
        </Show>

        <div class="fpBubbleToggleRow">
          <input
            type="checkbox"
            id="cbShowFloatingBubble"
            checked={
              Object.prototype.hasOwnProperty.call(cfg('fpBubbleByHost') ?? {}, hostname())
                ? cfg('fpBubbleByHost')[hostname()] !== 'no'
                : cfg('fpShowFloatingBubble') !== 'no'
            }
            on:change={(e) => {
              const host = hostname();
              const map = { ...(twpConfig.get('fpBubbleByHost') ?? {}) };
              if (host) map[host] = (e.currentTarget as HTMLInputElement).checked ? 'yes' : 'no';
              void twpConfig.set('fpBubbleByHost', map);
              bump();
            }}
          />
          <label for="cbShowFloatingBubble">Show the floating translate bubble</label>
        </div>

        <button class="improveBtn" on:click={openImproveTranslation}>
          Improve translation
        </button>
      </main>
    </Show>
  );
}

export default App;

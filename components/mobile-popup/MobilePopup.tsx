import { createSignal, For, onCleanup, Show, onMount as solidOnMount } from 'solid-js';
import type { Config } from '@/modules/config/schema';
import { twpConfig } from '@/modules/config/store';
import { codeToLanguage, fixTLanguageCode, getLanguageList, isRtlLanguage } from '@/modules/languages';
import { onMessage, sendMessage } from '@/modules/messaging/protocol';
import type { PageTranslator } from '@/modules/page-translator/translateLoop';
import { getPlatformInfo } from '@/modules/platform/platformInfo';

/**
 * The mobile bottom/top bar popup, ported from contentScript/popupMobile.js
 * (+ its companion html file). Simplified relative to the old version:
 * dropped the swipe-to-dismiss touch gesture and the fancy expand/collapse
 * keyframe animations in favor of a plain show/hide, since those are
 * decorative rather than functional — the auto-show rules, gear menu
 * options, service/language pickers, and translate/undo action are all
 * kept. Runs inside content-main.content.ts's main-frame-only section
 * (see setupFloatingBubble's sibling call) rather than as the old code's
 * own separate all_frames:false content script — since this already only
 * runs in the main frame and shares the same pageTranslator instance
 * directly, a second content-script bundle plus cross-frame relay
 * messaging would add real complexity for no behavioral difference.
 */

export interface MobilePopupProps {
  pageTranslator: PageTranslator;
  hostname: string;
  getOriginalLanguage(): string;
  onOriginalLanguageChange(cb: (lang: string) => void): () => void;
}

export function MobilePopup(props: MobilePopupProps) {
  const platform = getPlatformInfo();
  if (platform.isDesktop && twpConfig.get('showMobilePopupOnDesktop') !== 'yes') {
    return null;
  }

  const [visible, setVisible] = createSignal(false);
  const [menuOpen, setMenuOpen] = createSignal(false);
  const [pageState, setPageState] = createSignal(props.pageTranslator.getState());
  const [service, setServiceSignal] = createSignal(twpConfig.get('pageTranslatorService'));
  const [targetLanguage, setTargetLanguageSignal] = createSignal(twpConfig.get('targetLanguage') ?? 'en');
  const [position, setPositionSignal] = createSignal(twpConfig.get('popupMobilePosition'));

  let barRef!: HTMLDivElement;
  let keepOnScreenTimer: ReturnType<typeof setInterval> | null = null;

  function effectiveUiLanguage(): string {
    const configured = twpConfig.get('uiLanguage');
    return configured !== 'default' ? configured : browser.i18n.getUILanguage();
  }

  function show(): void {
    setVisible(true);
    lastInteraction();
  }
  function hide(): void {
    setVisible(false);
    setMenuOpen(false);
  }

  let lastInteractionAt = Date.now();
  function lastInteraction(): void {
    lastInteractionAt = Date.now();
  }

  solidOnMount(() => {
    keepOnScreenTimer = setInterval(() => {
      if (
        visible() &&
        !menuOpen() &&
        twpConfig.get('popupMobileKeepOnScren') !== 'yes' &&
        Date.now() - lastInteractionAt > 8000
      ) {
        hide();
      }
    }, 1000);

    function onTouchStart(e: TouchEvent): void {
      if (e.touches.length === 3) {
        if (visible()) hide();
        else setTimeout(show, 400);
      }
    }
    window.addEventListener('touchstart', onTouchStart);

    const offShowPopup = onMessage('showPopupMobile', () => show());

    const unsubConfig = twpConfig.onChanged((name, value) => {
      if (name === 'pageTranslatorService') setServiceSignal(value as Config['pageTranslatorService']);
      else if (name === 'targetLanguage') setTargetLanguageSignal((value as string | null) ?? 'en');
      else if (name === 'popupMobilePosition') setPositionSignal(value as Config['popupMobilePosition']);
    });
    const unsubState = props.pageTranslator.onStateChange((state) => setPageState(state));
    const unsubOriginalLang = props.onOriginalLanguageChange((lang) => {
      if (
        twpConfig.get('whenShowMobilePopup') === 'always-show' ||
        (twpConfig.get('whenShowMobilePopup') !== 'only-when-i-touch' &&
          lang !== 'und' &&
          !twpConfig.get('neverTranslateLangs').includes(lang) &&
          !twpConfig.get('neverTranslateSites').includes(props.hostname) &&
          twpConfig.get('targetLanguage') !== lang)
      ) {
        show();
      }
    });

    onCleanup(() => {
      if (keepOnScreenTimer) clearInterval(keepOnScreenTimer);
      window.removeEventListener('touchstart', onTouchStart);
      offShowPopup();
      unsubConfig();
      unsubState();
      unsubOriginalLang();
    });
  });

  function onTranslateClick(): void {
    lastInteraction();
    if (pageState() === 'original') void props.pageTranslator.translatePage(targetLanguage());
    else props.pageTranslator.restorePage();
  }

  function onServiceCycleClick(): void {
    lastInteraction();
    const services: Config['pageTranslatorService'][] = ['google', 'bing', 'yandex'];
    const enabled = twpConfig
      .get('enabledServices')
      .filter((s): s is Config['pageTranslatorService'] => services.includes(s as never));
    const next = enabled[(enabled.indexOf(service()) + 1) % enabled.length] ?? enabled[0];
    if (!next) return;
    setServiceSignal(next);
    void twpConfig.set('pageTranslatorService', next);
    if (pageState() === 'translated') void props.pageTranslator.translatePage(targetLanguage());
  }

  function onGearClick(): void {
    lastInteraction();
    setMenuOpen(!menuOpen());
  }

  function onLanguageChange(e: Event): void {
    lastInteraction();
    const code = (e.currentTarget as HTMLSelectElement).value;
    void twpConfig.setTargetLanguage(code, true);
    setTargetLanguageSignal(code);
    void props.pageTranslator.translatePage(code);
    setMenuOpen(false);
  }

  function toggleAlwaysTranslateFromLang(): void {
    lastInteraction();
    const lang = fixTLanguageCode(props.getOriginalLanguage()) ?? props.getOriginalLanguage();
    if (!twpConfig.get('alwaysTranslateLangs').includes(lang)) {
      void twpConfig.addLangToAlwaysTranslate(lang);
      void props.pageTranslator.translatePage(targetLanguage());
    } else {
      void twpConfig.removeLangFromAlwaysTranslate(lang);
    }
  }
  function toggleNeverTranslateFromLang(): void {
    lastInteraction();
    const lang = fixTLanguageCode(props.getOriginalLanguage()) ?? props.getOriginalLanguage();
    if (!twpConfig.get('neverTranslateLangs').includes(lang)) {
      void twpConfig.addLangToNeverTranslate(lang);
      props.pageTranslator.restorePage();
    } else {
      void twpConfig.removeLangFromNeverTranslate(lang);
    }
  }
  function toggleNeverTranslateSite(): void {
    lastInteraction();
    if (!twpConfig.get('neverTranslateSites').includes(props.hostname)) {
      void twpConfig.addSiteToNeverTranslate(props.hostname);
      props.pageTranslator.restorePage();
    } else {
      void twpConfig.removeSiteFromNeverTranslate(props.hostname);
    }
  }
  function toggleShowSelectedButton(): void {
    lastInteraction();
    void twpConfig.set(
      'showTranslateSelectedButton',
      twpConfig.get('showTranslateSelectedButton') === 'yes' ? 'no' : 'yes',
    );
  }
  function toggleKeepOnScreen(): void {
    lastInteraction();
    void twpConfig.set('popupMobileKeepOnScren', twpConfig.get('popupMobileKeepOnScren') === 'yes' ? 'no' : 'yes');
  }
  function toggleChangePosition(): void {
    lastInteraction();
    void twpConfig.set('popupMobilePosition', position() === 'top' ? 'bottom' : 'top');
  }
  function onMoreOptions(): void {
    void sendMessage('openOptionsPage', undefined);
  }

  const langOriginal = () => {
    const fixed = fixTLanguageCode(props.getOriginalLanguage()) ?? 'und';
    return codeToLanguage(fixed, effectiveUiLanguage());
  };
  const langTarget = () => codeToLanguage(targetLanguage(), effectiveUiLanguage());
  const recentLangs = () => twpConfig.get('targetLanguages');
  const allLangs = () =>
    Object.entries(getLanguageList(effectiveUiLanguage())).sort((a, b) => a[1].localeCompare(b[1]));

  return (
    <>
      <style>{`
        * { box-sizing: border-box; margin: 0; padding: 0;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif; }
        .bar {
          position: fixed; left: 0; right: 0; z-index: 2147483647;
          display: flex; align-items: center; gap: 10px; padding: 10px 14px;
          background: #1e293b; color: #fff; box-shadow: 0 -2px 12px rgba(0,0,0,.3);
        }
        .bar.top { top: 0; box-shadow: 0 2px 12px rgba(0,0,0,.3); }
        .bar.bottom { bottom: 0; }
        @media (prefers-color-scheme: light) { .bar { background: #f1f5f9; color: #0f172a; } }
        .question { flex: 1; font-size: 13px; min-width: 0; }
        .btn {
          border: none; border-radius: 8px; padding: 8px 14px; font-size: 13px; font-weight: 700;
          background: #2563eb; color: #fff; cursor: pointer;
        }
        .iconBtn {
          border: none; background: transparent; color: inherit; font-size: 18px; cursor: pointer;
          width: 30px; height: 30px; border-radius: 50%; display: flex; align-items: center; justify-content: center;
        }
        .iconBtn:hover { background: rgba(128,128,128,.2); }
        .menu {
          position: fixed; left: 8px; right: 8px; z-index: 2147483647;
          background: #1e293b; color: #fff; border-radius: 12px; padding: 8px;
          box-shadow: 0 8px 24px rgba(0,0,0,.4);
        }
        @media (prefers-color-scheme: light) { .menu { background: #f8fafc; color: #0f172a; } }
        .menuItem {
          display: flex; align-items: center; justify-content: space-between;
          padding: 10px 8px; font-size: 13px; cursor: pointer; border-radius: 8px;
        }
        .menuItem:hover { background: rgba(128,128,128,.15); }
        select { font-size: 13px; padding: 4px; border-radius: 6px; }
      `}</style>

      <Show when={visible()}>
        <div
          class="bar"
          classList={{ top: position() === 'top', bottom: position() !== 'top' }}
          ref={barRef}
          dir={isRtlLanguage(effectiveUiLanguage()) ? 'rtl' : 'ltr'}
        >
          <div class="question">
            {pageState() === 'original'
              ? `Translate from ${langOriginal()} to ${langTarget()}?`
              : `Page translated to ${langTarget()}`}
          </div>
          <select value={targetLanguage()} on:change={onLanguageChange} on:click={(e) => e.stopPropagation()}>
            <optgroup label="Recent">
              <For each={recentLangs()}>
                {(code) => <option value={code}>{codeToLanguage(code, effectiveUiLanguage())}</option>}
              </For>
            </optgroup>
            <optgroup label="All">
              <For each={allLangs()}>{([code, name]) => <option value={code}>{name}</option>}</For>
            </optgroup>
          </select>
          <button class="btn" on:click={onTranslateClick}>
            {pageState() === 'original' ? 'Translate' : 'Undo'}
          </button>
          <button class="iconBtn" title={service()} on:click={onServiceCycleClick}>
            {service().charAt(0).toUpperCase()}
          </button>
          <button class="iconBtn" on:click={onGearClick}>
            ⚙
          </button>
        </div>
        <Show when={menuOpen()}>
          <div class="menu" style={{ [position() === 'top' ? 'top' : 'bottom']: '56px' }}>
            <div class="menuItem" on:click={toggleShowSelectedButton}>
              <span>Show "translate selection" button</span>
              <span>{twpConfig.get('showTranslateSelectedButton') === 'yes' ? '✔' : ''}</span>
            </div>
            <Show when={props.getOriginalLanguage() !== 'und' && props.getOriginalLanguage() !== targetLanguage()}>
              <div class="menuItem" on:click={toggleAlwaysTranslateFromLang}>
                <span>Always translate from {langOriginal()}</span>
                <span>{twpConfig.get('alwaysTranslateLangs').includes(props.getOriginalLanguage()) ? '✔' : ''}</span>
              </div>
              <div class="menuItem" on:click={toggleNeverTranslateFromLang}>
                <span>Never translate from {langOriginal()}</span>
                <span>{twpConfig.get('neverTranslateLangs').includes(props.getOriginalLanguage()) ? '✔' : ''}</span>
              </div>
            </Show>
            <div class="menuItem" on:click={toggleNeverTranslateSite}>
              <span>Never translate this site</span>
              <span>{twpConfig.get('neverTranslateSites').includes(props.hostname) ? '✔' : ''}</span>
            </div>
            <div class="menuItem" on:click={toggleKeepOnScreen}>
              <span>Keep on screen</span>
              <span>{twpConfig.get('popupMobileKeepOnScren') === 'yes' ? '✔' : ''}</span>
            </div>
            <div class="menuItem" on:click={toggleChangePosition}>
              <span>Position: {position()}</span>
            </div>
            <div class="menuItem" on:click={onMoreOptions}>
              <span>More options…</span>
            </div>
          </div>
        </Show>
      </Show>
    </>
  );
}

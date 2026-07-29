import { render } from 'solid-js/web';
import type { ContentScriptContext } from 'wxt/utils/content-script-context';
import { FloatingBubble } from '@/components/bubble/FloatingBubble';
import { OriginalTextTooltip } from '@/components/hover-tooltip/OriginalTextTooltip';
import { TranslatedTextTooltip } from '@/components/hover-tooltip/TranslatedTextTooltip';
import { MobilePopup } from '@/components/mobile-popup/MobilePopup';
import { SelectionPopup } from '@/components/selection-popup/SelectionPopup';
import { twpConfig } from '@/modules/config/store';
import { onMessage, sendMessage } from '@/modules/messaging/protocol';
import { createOriginalLanguageTracker, shouldAutoTranslateOnLoad } from '@/modules/page-translator/originalLanguage';
import { createPageTranslator, type PageTranslator } from '@/modules/page-translator/translateLoop';

/**
 * The page-translation content script — wires modules/page-translator's
 * engine (dedupe + mutation watching + adaptive resweep, ported from the old
 * contentScript/pageTranslator.js's hardening work) up to config and the
 * background message router, detects the page's original language and
 * decides whether to auto-translate on load (modules/page-translator/
 * originalLanguage.ts), and mounts every content-script UI surface: the
 * floating bubble, the selection-translate popup + both hover tooltips (all
 * frames, matching the old translateSelected.js/showOriginal.js/
 * showTranslated.js bundle), and the mobile popup (main frame only). See
 * translateLoop.ts for the fidelity note on what's simplified in the
 * page-translation engine itself.
 */
export default defineContentScript({
  // No `matches` here — deliberately. Gen 2 Session 4: 'runtime' instead of
  // the default 'manifest' is the load-bearing part of the permission
  // scope-down, not just the host_permissions/optional_host_permissions
  // split in wxt.config.ts. A *static* manifest content_scripts entry with
  // matches:['<all_urls>'] grants itself the right to inject everywhere as
  // part of what the user approves at install/update time — that's
  // independent of host_permissions and does NOT shrink just because
  // host_permissions does (confirmed the hard way: removing
  // host_permissions alone, with this still on 'manifest' registration,
  // left the script injecting on every page regardless — a real E2E check
  // caught it, code review alone would not have).
  //
  // A *second*, subtler version of the same bug: WXT's own build step
  // unconditionally folds a 'runtime'-registration script's `matches` into
  // the manifest's mandatory `host_permissions` array (see
  // node_modules/wxt/dist/core/utils/manifest.mjs — documented behavior,
  // not a bug in WXT: it assumes a runtime-registered script's origins are
  // always meant to be permanently available, so registerContentScripts()
  // never fails for lack of permission). Declaring matches:['<all_urls>']
  // here — even with registration:'runtime' — silently put <all_urls> back
  // into host_permissions, defeating the entire scope-down while every
  // other signal (manifest content_scripts array, a fresh-install E2E
  // check) looked correct. Caught only by a diagnostic that logged
  // chrome.permissions.contains() on a brand-new profile and got `true`
  // when it should have been `false`. Fix: omit `matches` entirely from
  // this entrypoint. The real matches pattern this script is registered
  // for lives solely in contentMainRegistration.ts's own argument to
  // browser.scripting.registerContentScripts(), called only once the
  // optional <all_urls> permission has actually been granted — see
  // background.ts's syncContentMainRegistration. That call is the real
  // Chrome scripting API operating on a runtime-granted optional
  // permission, which Chrome does support without the pattern needing to
  // be in static host_permissions ahead of time.
  runAt: 'document_end',
  allFrames: true,
  matchAboutBlank: true,
  cssInjectionMode: 'ui',
  registration: 'runtime',
  async main(ctx) {
    // This script can now run two ways in the same frame — registered
    // broadly via background.ts's syncContentMainRegistration (once the
    // optional host permission is granted) or on-demand via
    // background.ts's chrome.scripting.executeScript fallback (the
    // activeTab path used when that permission hasn't been granted for
    // this origin). Never both by design, but this guards the case where
    // a fresh on-demand injection would otherwise double-run everything
    // below — duplicate mutation observers, duplicate onMessage
    // registrations (which @webext-core/messaging itself throws on: "only
    // one listener can be setup for X"), the works.
    const w = window as typeof window & { __prismContentMainActive?: boolean };
    if (w.__prismContentMainActive) return;
    w.__prismContentMainActive = true;

    await twpConfig.onReady();

    const isMainFrame = window.self === window.top;
    // Main frame already knows its own hostname; subframes ask background
    // for the *tab's* hostname (not their own, possibly cross-origin, one) —
    // always/never-translate-site rules are meant to key off the outer page.
    const hostname = isMainFrame
      ? location.hostname
      : await sendMessage('getTabHostName', undefined).catch(() => location.hostname);

    const pageTranslator = createPageTranslator({
      getService: () => twpConfig.get('pageTranslatorService'),
      // Per-host "From" language picked in the bubble, persisted straight to
      // config — reading it live here (instead of threading a local mutable
      // var through) keeps this in sync with the bubble for free.
      getSourceLanguage: () => twpConfig.get('fpSourceLangByHost')[location.hostname] ?? 'auto',
      getDontSortResults: () => twpConfig.get('dontSortResults') === 'yes',
    });

    onMessage('getCurrentPageLanguageState', () => pageTranslator.getState());
    onMessage('translatePage', async (message) => {
      const targetLanguage = message.data?.targetLanguage ?? twpConfig.get('targetLanguage') ?? 'en';
      await pageTranslator.translatePage(targetLanguage);
    });
    onMessage('restorePage', () => {
      pageTranslator.restorePage();
    });
    // The toolbar icon, hotkey-toggle-translation, and the "translate page"
    // context-menu item all funnel through this — each frame that receives
    // it (main frame only, or every frame, depending on
    // enableIframePageTranslation — background.ts decides which) toggles
    // based on its own current state, matching the old code's
    // "toggle-translation" action.
    onMessage('toggleTranslation', async () => {
      if (pageTranslator.getState() === 'translated') {
        pageTranslator.restorePage();
      } else {
        await pageTranslator.translatePage(twpConfig.get('targetLanguage') ?? 'en');
      }
    });

    const originalLanguage = createOriginalLanguageTracker();
    const originalLanguageReady = originalLanguage.start();

    if (isMainFrame) {
      pageTranslator.onStateChange((state) => {
        void sendMessage('reportMainFramePageLanguageState', { state }).catch(() => {});
      });

      // Popup queries (tab-targeted, main frame only — no frameId means
      // Chrome would deliver to every frame otherwise, and these are
      // inherently whole-tab concepts).
      onMessage('getOriginalTabLanguage', () => originalLanguage.get());
      onMessage('swapTranslationService', async () => {
        const next = await twpConfig.swapPageTranslationService();
        if (pageTranslator.getState() === 'translated') {
          await pageTranslator.translatePage(twpConfig.get('targetLanguage') ?? 'en');
        }
        return next;
      });

      // Auto-translate-on-load decision, once the original language resolves.
      void originalLanguageReady.then(() => {
        const decision = shouldAutoTranslateOnLoad({
          originalLanguage: originalLanguage.get(),
          hostname,
          targetLanguage: twpConfig.get('targetLanguage') ?? 'en',
          pageLanguageState: pageTranslator.getState(),
          alwaysTranslateSites: twpConfig.get('alwaysTranslateSites'),
          neverTranslateSites: twpConfig.get('neverTranslateSites'),
          alwaysTranslateLangs: twpConfig.get('alwaysTranslateLangs'),
          neverTranslateLangs: twpConfig.get('neverTranslateLangs'),
          hasSavedSourceLangForHost: !!twpConfig.get('fpSourceLangByHost')[hostname],
          isIncognito: browser.extension.inIncognitoContext,
        });
        if (decision) void pageTranslator.translatePage(twpConfig.get('targetLanguage') ?? 'en');
      });

      await setupFloatingBubble(ctx, pageTranslator);
      await mountPersistentOverlay(ctx, 'twp-mobile-popup', (uiContainer) =>
        render(
          () =>
            MobilePopup({
              pageTranslator,
              hostname,
              getOriginalLanguage: () => originalLanguage.get(),
              onOriginalLanguageChange: originalLanguage.onChange,
            }),
          uiContainer,
        ),
      );
    }

    await mountPersistentOverlay(ctx, 'twp-selection-hover', (uiContainer, shadowHost) => {
      const disposeSelection = render(
        () =>
          SelectionPopup({
            hostname,
            shadowHost,
            getOriginalLanguage: () => originalLanguage.get(),
            onOriginalLanguageChange: originalLanguage.onChange,
          }),
        uiContainer,
      );
      const disposeOriginal = render(() => OriginalTextTooltip({ pageTranslator, shadowHost }), uiContainer);
      const disposeTranslated = render(
        () =>
          TranslatedTextTooltip({
            hostname,
            shadowHost,
            getPageLanguageState: () => pageTranslator.getState(),
            onPageLanguageStateChange: pageTranslator.onStateChange,
            getOriginalLanguage: () => originalLanguage.get(),
            onOriginalLanguageChange: originalLanguage.onChange,
          }),
        uiContainer,
      );
      return () => {
        disposeSelection();
        disposeOriginal();
        disposeTranslated();
      };
    });
  },
});

function bubbleVisibleForHost(host: string): boolean {
  const map = twpConfig.get('fpBubbleByHost');
  if (Object.hasOwn(map, host)) return map[host] !== 'no';
  return twpConfig.get('fpShowFloatingBubble') !== 'no';
}

/**
 * Mounts a content-script UI that stays up for the page's whole lifetime
 * (no user-facing show/hide toggle, unlike the bubble) with the same
 * zero-size fixed `:host` positioning fix and SPA-body-wipe remount safety
 * net the bubble needed — factored out here since two separate overlays
 * (mobile popup, selection+hover) both need exactly this and nothing more.
 */
async function mountPersistentOverlay(
  ctx: ContentScriptContext,
  name: string,
  renderFn: (uiContainer: HTMLElement, shadowHost: HTMLElement) => (() => void) | void,
): Promise<void> {
  const { createShadowRootUi } = await import('wxt/utils/content-script-ui/shadow-root');

  let dispose: (() => void) | void;

  const ui = await createShadowRootUi(ctx, {
    name,
    position: 'inline',
    anchor: 'body',
    append: 'last',
    mode: 'closed',
    css: `:host{
      position: fixed !important;
      z-index: 2147483647 !important;
      top: 0 !important;
      left: 0 !important;
      width: 0 !important;
      height: 0 !important;
    }`,
    onMount(uiContainer, _shadow, shadowHost) {
      dispose = renderFn(uiContainer, shadowHost);
    },
    onRemove() {
      if (typeof dispose === 'function') dispose();
      dispose = undefined;
    },
  });

  ui.mount();

  new MutationObserver(() => {
    if (!ui.shadowHost.isConnected) ui.mount();
  }).observe(document.body, { childList: true });
}

async function setupFloatingBubble(ctx: ContentScriptContext, pageTranslator: PageTranslator): Promise<void> {
  if (
    location.protocol === 'chrome-extension:' ||
    location.protocol === 'moz-extension:' ||
    location.protocol === 'about:'
  ) {
    return;
  }

  const { createShadowRootUi } = await import('wxt/utils/content-script-ui/shadow-root');

  let dispose: (() => void) | null = null;
  let hiddenByUser = false;

  const ui = await createShadowRootUi(ctx, {
    name: 'twp-fp-bubble',
    position: 'inline',
    anchor: 'body',
    append: 'last',
    // Closed mode: the host page cannot reach into the bubble via
    // .shadowRoot, matching the old code's deliberate choice here.
    mode: 'closed',
    // WXT's "inline" position leaves the host unstyled — give it the same
    // zero-size fixed anchor the old code used, so the ball/panel inside
    // (both position: fixed) can freely place themselves anywhere in the
    // viewport without affecting page layout. This has to be a `:host` rule
    // in the shadow root's own stylesheet, appended *after* WXT's built-in
    // `:host{all:initial!important}` reset — empirically, an inline
    // `style="...!important"` set on the host element from the outside
    // (i.e. from JS in onMount) loses to that reset rule despite being
    // `!important` too; a later same-specificity `:host` rule in the same
    // stylesheet is what actually wins.
    css: `:host{
      position: fixed !important;
      z-index: 2147483647 !important;
      top: 0 !important;
      left: 0 !important;
      width: 0 !important;
      height: 0 !important;
    }`,
    onMount(uiContainer, _shadow, shadowHost) {
      dispose = render(
        () =>
          FloatingBubble({
            pageTranslator,
            hostname: location.hostname,
            shadowHost,
            onHide() {
              hiddenByUser = true;
              ui.remove();
            },
          }),
        uiContainer,
      );
    },
    onRemove() {
      dispose?.();
      dispose = null;
    },
  });

  function reevaluate(): void {
    const shouldShow = bubbleVisibleForHost(location.hostname);
    const isMounted = ui.mounted !== undefined;
    if (shouldShow && !isMounted) {
      hiddenByUser = false;
      ui.mount();
    } else if (!shouldShow && isMounted) {
      ui.remove();
    }
  }

  if (bubbleVisibleForHost(location.hostname)) {
    ui.mount();
  }

  // Live show/hide toggling from elsewhere (options page, later phases) even
  // if the bubble wasn't mounted at page load.
  twpConfig.onChanged((name) => {
    if (name === 'fpShowFloatingBubble' || name === 'fpBubbleByHost') reevaluate();
  });

  // WXT's shadow-root UI does not auto-remount if some page script wipes out
  // the bubble's host element without touching the anchor itself (e.g. an SPA
  // clearing document.body's children wholesale on navigation, rather than
  // diffing them) — reattach it ourselves unless the user deliberately hid it.
  new MutationObserver(() => {
    if (!hiddenByUser && bubbleVisibleForHost(location.hostname) && !ui.shadowHost.isConnected) {
      ui.mount();
    }
  }).observe(document.body, { childList: true });
}

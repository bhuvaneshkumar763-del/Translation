import { render } from 'solid-js/web';
import type { ContentScriptContext } from 'wxt/utils/content-script-context';
import { twpConfig } from '@/modules/config/store';
import { onMessage } from '@/modules/messaging/protocol';
import { createPageTranslator } from '@/modules/page-translator/translateLoop';
import { FloatingBubble } from '@/components/bubble/FloatingBubble';

/**
 * The page-translation content script — wires modules/page-translator's
 * engine (dedupe + mutation watching + adaptive resweep, ported from the old
 * contentScript/pageTranslator.js's hardening work) up to config and the
 * background message router, and (main frame only) mounts the floating
 * translate bubble. See translateLoop.ts for the fidelity note on what's
 * simplified in this phase (individual text nodes, not paragraph-level
 * "pieces"; no attribute/title/dictionary translation yet).
 */
export default defineContentScript({
  matches: ['<all_urls>'],
  runAt: 'document_end',
  allFrames: true,
  matchAboutBlank: true,
  cssInjectionMode: 'ui',
  async main(ctx) {
    await twpConfig.onReady();

    const pageTranslator = createPageTranslator({
      getService: () => twpConfig.get('pageTranslatorService'),
      // Per-host "From" language picked in the bubble, persisted straight to
      // config — reading it live here (instead of threading a local mutable
      // var through) keeps this in sync with the bubble for free.
      getSourceLanguage: () => twpConfig.get('fpSourceLangByHost')[location.hostname] ?? 'auto',
    });

    onMessage('getCurrentPageLanguageState', () => pageTranslator.getState());
    onMessage('translatePage', async (message) => {
      const targetLanguage = message.data?.targetLanguage ?? twpConfig.get('targetLanguage') ?? 'en';
      await pageTranslator.translatePage(targetLanguage);
    });
    onMessage('restorePage', () => {
      pageTranslator.restorePage();
    });

    if (window.self === window.top) {
      await setupFloatingBubble(ctx, pageTranslator);
    }
  },
});

function bubbleVisibleForHost(host: string): boolean {
  const map = twpConfig.get('fpBubbleByHost');
  if (Object.prototype.hasOwnProperty.call(map, host)) return map[host] !== 'no';
  return twpConfig.get('fpShowFloatingBubble') !== 'no';
}

async function setupFloatingBubble(
  ctx: ContentScriptContext,
  pageTranslator: ReturnType<typeof createPageTranslator>,
): Promise<void> {
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

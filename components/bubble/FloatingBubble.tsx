import { createSignal, For, onCleanup, onMount as solidOnMount } from 'solid-js';
import type { Config } from '@/modules/config/schema';
import { twpConfig } from '@/modules/config/store';
import { codeToLanguage } from '@/modules/languages';
import { sendMessage } from '@/modules/messaging/protocol';
import type { PageTranslator } from '@/modules/page-translator/translateLoop';

/**
 * The floating translate bubble (Immersive-Translate-style): a draggable
 * circular button fixed on screen, click toggles translation, hover reveals
 * a small menu. Ported from the ~600-line "TWP-FullPage" block at the end of
 * the old contentScript/pageTranslator.js, kept close to line-for-line for
 * the drag/positioning math (edge-docking + panel placement, all clamped to
 * the viewport) since that's fiddly, already-tuned geometry code, not
 * something to "clean up" into a different design mid-port. Reactive state
 * (translated/busy/pinned/selected languages) uses Solid signals; positioning
 * during drag stays direct style writes for the same reason the old code did
 * it that way — it runs on every pointermove.
 */

export interface FloatingBubbleProps {
  pageTranslator: PageTranslator;
  hostname: string;
  shadowHost: HTMLElement;
  onHide(): void;
}

const COMMON_TARGET_LANGS = [
  'en',
  'es',
  'fr',
  'de',
  'pt',
  'it',
  'ru',
  'ja',
  'ko',
  'zh-CN',
  'zh-TW',
  'vi',
  'ar',
  'hi',
  'id',
  'th',
];
const COMMON_SOURCE_LANGS = [
  'auto',
  'en',
  'zh-CN',
  'zh-TW',
  'ja',
  'ko',
  'vi',
  'es',
  'fr',
  'de',
  'pt',
  'it',
  'ru',
  'ar',
  'hi',
  'id',
  'th',
];
const PAGE_TRANSLATION_SERVICES: Array<Config['pageTranslatorService']> = ['google', 'bing', 'yandex'];
const SERVICE_LABELS: Record<Config['pageTranslatorService'], string> = {
  google: 'Google',
  bing: 'Bing',
  yandex: 'Yandex',
  // Not in PAGE_TRANSLATION_SERVICES above (yet) — the quick-switch pill
  // list is being deliberately curated, not every provider belongs in a
  // one-tap surface. Entries exist so this Record type-checks against the
  // full pageTranslatorService enum; visual placement is a Session 3 UI call.
  llm: 'AI',
  builtin: 'Built-in AI',
};

const BALL = 40;

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function vw(): number {
  return window.visualViewport?.width || window.innerWidth;
}
function vh(): number {
  return window.visualViewport?.height || window.innerHeight;
}

function effectiveUiLanguage(): string {
  const configured = twpConfig.get('uiLanguage');
  return configured !== 'default' ? configured : browser.i18n.getUILanguage();
}

function uniq(codes: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const c of codes) {
    if (c && !seen.has(c)) {
      seen.add(c);
      out.push(c);
    }
  }
  return out;
}

export function FloatingBubble(props: FloatingBubbleProps) {
  let wrap!: HTMLDivElement;
  let ball!: HTMLDivElement;
  let panel!: HTMLDivElement;

  const [pageState, setPageState] = createSignal(props.pageTranslator.getState());
  const [busy, setBusy] = createSignal(false);
  const [pinned, setPinned] = createSignal(false);

  const [targetLanguage, setTargetLanguageSignal] = createSignal(twpConfig.get('targetLanguage') ?? 'en');
  const [service, setServiceSignal] = createSignal(twpConfig.get('pageTranslatorService'));
  const [alwaysOn, setAlwaysOn] = createSignal(twpConfig.get('alwaysTranslateSites').includes(props.hostname));

  const savedSourceMap = twpConfig.get('fpSourceLangByHost') ?? {};
  const [sourceLanguage, setSourceLanguageSignal] = createSignal(savedSourceMap[props.hostname] ?? 'auto');

  const targetLangOptions = () => uniq([targetLanguage(), ...twpConfig.get('targetLanguages'), ...COMMON_TARGET_LANGS]);
  const sourceLangOptions = () => uniq([sourceLanguage(), ...COMMON_SOURCE_LANGS]);
  const serviceOptions = () => {
    const enabled = twpConfig.get('enabledServices');
    return PAGE_TRANSLATION_SERVICES.filter((s) => enabled.includes(s));
  };

  // Position is stored as a dock side + vertical fraction, so the ball is
  // ALWAYS pinned to a screen edge regardless of viewport size, device, or
  // orientation — avoids the ball drifting off-edge on mobile/rotation.
  const savedPos = twpConfig.get('fpBubblePos');
  const state = {
    side: savedPos?.side === 'left' || savedPos?.side === 'right' ? savedPos.side : 'right',
    yFrac: typeof savedPos?.yFrac === 'number' ? clamp(savedPos.yFrac, 0, 1) : 0.55,
  };

  function setEdgeClass(x: number): void {
    wrap.classList.toggle('right', x + BALL / 2 > vw() / 2);
  }

  function positionPanel(): void {
    const r = ball.getBoundingClientRect();
    const pw = panel.offsetWidth || 296;
    const ph = panel.offsetHeight || 200;
    const edge = 8;
    const gap = 10;
    const W = vw();
    const H = vh();
    const roomRight = W - r.right;
    const roomLeft = r.left;
    let left = roomRight >= pw + gap || roomRight >= roomLeft ? r.right + gap : r.left - gap - pw;
    left = Math.max(edge, Math.min(left, W - pw - edge));
    let top = r.top + r.height / 2 - ph / 2;
    top = Math.max(edge, Math.min(top, H - ph - edge));
    panel.style.left = Math.round(left) + 'px';
    panel.style.top = Math.round(top) + 'px';
  }

  function applyState(): { x: number; y: number } {
    const maxY = vh() - BALL - 4;
    const x = state.side === 'right' ? vw() - BALL - 6 : 6;
    const y = clamp(Math.round(state.yFrac * maxY), 4, maxY);
    wrap.style.left = x + 'px';
    wrap.style.top = y + 'px';
    setEdgeClass(x);
    positionPanel();
    return { x, y };
  }

  function previewAt(x: number, y: number): { x: number; y: number } {
    const maxX = vw() - BALL - 2;
    const maxY = vh() - BALL - 2;
    x = clamp(x, 2, maxX);
    y = clamp(y, 2, maxY);
    wrap.style.left = x + 'px';
    wrap.style.top = y + 'px';
    setEdgeClass(x);
    positionPanel();
    return { x, y };
  }

  let pos = { x: 0, y: 0 };

  function reflow(): void {
    pos = applyState();
  }

  let actionBusy = false;
  function toggleTranslate(): void {
    if (actionBusy) return; // ignore rapid double clicks/taps
    actionBusy = true;
    setTimeout(() => {
      actionBusy = false;
    }, 600);
    if (pageState() === 'translated') {
      props.pageTranslator.restorePage();
    } else {
      setBusy(true);
      void props.pageTranslator.translatePage(targetLanguage());
    }
  }

  solidOnMount(() => {
    pos = applyState();

    wrap.addEventListener('pointerenter', positionPanel);
    wrap.addEventListener('focusin', positionPanel);
    window.addEventListener('resize', reflow);
    window.visualViewport?.addEventListener('resize', reflow);
    window.visualViewport?.addEventListener('scroll', reflow);
    const onOrientationChange = () => setTimeout(reflow, 250);
    window.addEventListener('orientationchange', onOrientationChange);

    let dragging = false;
    let moved = false;
    let sx = 0;
    let sy = 0;
    let ox = 0;
    let oy = 0;
    let longPressTimer: ReturnType<typeof setTimeout> | null = null;

    const onPointerDown = (e: PointerEvent) => {
      dragging = true;
      moved = false;
      sx = e.clientX;
      sy = e.clientY;
      ox = pos.x;
      oy = pos.y;
      try {
        ball.setPointerCapture(e.pointerId);
      } catch {
        // ignore — pointer capture is best-effort
      }
      longPressTimer = setTimeout(() => {
        positionPanel();
        setPinned(true);
      }, 450);
      e.preventDefault();
    };
    const onPointerMove = (e: PointerEvent) => {
      if (!dragging) return;
      const dx = e.clientX - sx;
      const dy = e.clientY - sy;
      if (!moved && (Math.abs(dx) > 4 || Math.abs(dy) > 4)) {
        moved = true;
        if (longPressTimer) clearTimeout(longPressTimer);
      }
      if (moved) pos = previewAt(ox + dx, oy + dy);
    };
    const onPointerUp = (e: PointerEvent) => {
      dragging = false;
      if (longPressTimer) clearTimeout(longPressTimer);
      try {
        ball.releasePointerCapture(e.pointerId);
      } catch {
        // ignore
      }
      if (moved) {
        state.side = pos.x + BALL / 2 < vw() / 2 ? 'left' : 'right';
        const maxY = vh() - BALL - 4;
        state.yFrac = clamp(pos.y / maxY, 0, 1);
        pos = applyState();
        void twpConfig.set('fpBubblePos', { side: state.side, yFrac: state.yFrac });
      } else {
        toggleTranslate();
      }
    };
    ball.addEventListener('pointerdown', onPointerDown);
    ball.addEventListener('pointermove', onPointerMove);
    ball.addEventListener('pointerup', onPointerUp);

    const onDocPointerDown = (e: PointerEvent) => {
      if (pinned() && e.target !== props.shadowHost) setPinned(false);
    };
    document.addEventListener('pointerdown', onDocPointerDown, true);

    const onKeydown = (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        toggleTranslate();
      } else if (e.key === 'Escape') {
        setPinned(false);
        ball.blur();
      }
    };
    ball.addEventListener('keydown', onKeydown);

    const onFsChange = () => {
      const fs = document.fullscreenElement;
      wrap.style.display = fs ? 'none' : '';
    };
    document.addEventListener('fullscreenchange', onFsChange, false);

    const unsubState = props.pageTranslator.onStateChange((next) => {
      setBusy(false);
      setPageState(next);
    });
    const unsubConfig = twpConfig.onChanged((name, value) => {
      if (name === 'targetLanguage') setTargetLanguageSignal((value as string | null) ?? 'en');
      else if (name === 'pageTranslatorService') setServiceSignal(value as Config['pageTranslatorService']);
      else if (name === 'alwaysTranslateSites') setAlwaysOn((value as string[]).includes(props.hostname));
    });

    onCleanup(() => {
      wrap.removeEventListener('pointerenter', positionPanel);
      wrap.removeEventListener('focusin', positionPanel);
      window.removeEventListener('resize', reflow);
      window.visualViewport?.removeEventListener('resize', reflow);
      window.visualViewport?.removeEventListener('scroll', reflow);
      window.removeEventListener('orientationchange', onOrientationChange);
      ball.removeEventListener('pointerdown', onPointerDown);
      ball.removeEventListener('pointermove', onPointerMove);
      ball.removeEventListener('pointerup', onPointerUp);
      document.removeEventListener('pointerdown', onDocPointerDown, true);
      ball.removeEventListener('keydown', onKeydown);
      document.removeEventListener('fullscreenchange', onFsChange, false);
      unsubState();
      unsubConfig();
    });
  });

  function onPrimaryClick(e: MouseEvent): void {
    e.stopPropagation();
    toggleTranslate();
  }

  function onAlwaysClick(e: MouseEvent): void {
    e.stopPropagation();
    if (!alwaysOn()) {
      void twpConfig.addSiteToAlwaysTranslate(props.hostname);
      if (pageState() !== 'translated') {
        setBusy(true);
        void props.pageTranslator.translatePage(targetLanguage());
      }
    } else {
      void twpConfig.removeSiteFromAlwaysTranslate(props.hostname);
    }
    setAlwaysOn(!alwaysOn());
  }

  function onSettingsClick(e: MouseEvent): void {
    e.stopPropagation();
    void sendMessage('openOptionsPage', undefined);
  }

  function onHideClick(e: MouseEvent): void {
    e.stopPropagation();
    const map = { ...(twpConfig.get('fpBubbleByHost') ?? {}) };
    map[props.hostname] = 'no';
    void twpConfig.set('fpBubbleByHost', map);
    props.onHide();
  }

  function onChipKeydown(e: KeyboardEvent): void {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      (e.currentTarget as HTMLElement).click();
    }
  }

  function onSourceLanguageChange(e: Event): void {
    e.stopPropagation();
    const code = (e.currentTarget as HTMLSelectElement).value;
    const map = { ...(twpConfig.get('fpSourceLangByHost') ?? {}) };
    if (code !== 'auto') map[props.hostname] = code;
    else delete map[props.hostname];
    void twpConfig.set('fpSourceLangByHost', map);
    setSourceLanguageSignal(code);
    setBusy(true);
    void props.pageTranslator.translatePage(targetLanguage());
  }

  function onTargetLanguageChange(e: Event): void {
    e.stopPropagation();
    const code = (e.currentTarget as HTMLSelectElement).value;
    void twpConfig.set('targetLanguage', code);
    setTargetLanguageSignal(code);
    setBusy(true);
    void props.pageTranslator.translatePage(code);
  }

  function onServiceChange(e: Event): void {
    e.stopPropagation();
    const svc = (e.currentTarget as HTMLSelectElement).value as Config['pageTranslatorService'];
    void twpConfig.set('pageTranslatorService', svc);
    setServiceSignal(svc);
    setBusy(true);
    void props.pageTranslator.translatePage(targetLanguage());
  }

  const translated = () => pageState() === 'translated';

  return (
    <>
      {/*
        Gen 2 Session 3: restyled on the Prism token palette. Values are
        duplicated here (not @import'd from styles/tokens.css) because this
        renders inside a shadow root injected into arbitrary third-party
        pages — the extension's own stylesheet isn't reachable by a plain
        relative path from there. Keep these in sync with tokens.css by hand
        if the palette changes. Pointer-event/drag/edge-docking math above
        (solidOnMount, applyState/previewAt/positionPanel) is untouched.
      */}
      <style>{`
        * { box-sizing: border-box; margin: 0; padding: 0;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif; }
        .wrap { position: fixed; width: 40px; height: 40px;
                --accent: #6366f1; --accent2: #4f46e5; }
        .wrap.translated { --accent: #16a34a; --accent2: #15803d; }

        .ball {
          position: absolute; inset: 0;
          width: 40px; height: 40px; border-radius: 50%;
          display: flex; align-items: center; justify-content: center;
          cursor: grab; user-select: none;
          color: #fff; font-weight: 700; font-size: 14px; letter-spacing: -.5px;
          background: linear-gradient(140deg, var(--accent), var(--accent2));
          box-shadow: 0 4px 14px -3px rgba(0,0,0,.5), 0 0 0 1px rgba(255,255,255,.08) inset;
          opacity: .55; transition: opacity .2s ease, transform .15s ease, box-shadow .2s ease;
          touch-action: none;
        }
        .wrap:hover .ball, .ball.active { opacity: 1; }
        .ball:active { cursor: grabbing; transform: scale(.94); }
        .ball .ic { width: 21px; height: 21px; pointer-events: none; }
        .ball .ic-or { display: none; }
        .wrap.translated .ball .ic-tr { display: none; }
        .wrap.translated .ball .ic-or { display: block; }
        .ball .spinner {
          display: none; width: 18px; height: 18px; border-radius: 50%;
          border: 2px solid rgba(255,255,255,.35); border-top-color: #fff;
          animation: twpspin .7s linear infinite;
        }
        .ball.busy .ic { display: none !important; }
        .ball.busy .spinner { display: block; }
        @keyframes twpspin { to { transform: rotate(360deg); } }

        .panel {
          position: fixed; left: 0; top: 0;
          width: 296px; max-width: calc(100vw - 16px); max-height: calc(100vh - 16px);
          overflow: auto;
          border-radius: 16px;
          background: #ffffff; color: #0f172a;
          box-shadow: 0 12px 40px -10px rgba(15,23,42,.55), 0 0 0 1px rgba(15,23,42,.06);
          opacity: 0; visibility: hidden;
          transform: scale(.96);
          transform-origin: center center;
          transition: opacity .16s ease, transform .16s ease, visibility .16s;
        }
        .wrap:hover .panel, .panel.pinned {
          opacity: 1; visibility: visible; transform: scale(1);
        }

        .head {
          padding: 13px 14px 11px; display: flex; align-items: center; gap: 9px;
          background: linear-gradient(135deg, var(--accent), var(--accent2)); color: #fff;
        }
        .head .hicon { width: 22px; height: 22px; padding: 4px; border-radius: 6px; background: rgba(255,255,255,.18); }
        .head .htitle { font-size: 13.5px; font-weight: 700; }
        .head .hsub { font-size: 11px; opacity: .85; font-weight: 500; }

        .body { padding: 12px; display: flex; flex-direction: column; gap: 11px; }
        .primary {
          width: 100%; border: none; cursor: pointer; border-radius: 11px;
          padding: 12px; font-size: 14px; font-weight: 700; color: #fff;
          background: linear-gradient(135deg, var(--accent), var(--accent2));
          box-shadow: 0 4px 12px -4px var(--accent);
          transition: transform .12s ease, filter .12s ease;
        }
        .primary:hover { transform: translateY(-1px); filter: brightness(1.06); }
        .primary:active { transform: translateY(0); }

        .divider { height: 1px; background: #e8edf3; margin: 1px 0; }

        .row { display: flex; gap: 8px; }
        .chip {
          flex: 1; border: 1px solid #e2e8f0; background: #f8fafc; color: #0f172a;
          border-radius: 10px; padding: 9px 6px; font-size: 11.5px; font-weight: 600;
          cursor: pointer; display: flex; flex-direction: column; align-items: center; gap: 5px;
          transition: background .12s ease, border-color .12s ease, color .12s ease;
        }
        .chip:hover { background: #eef2f7; }
        .chip svg { width: 17px; height: 17px; }
        .chip.on { border-color: var(--accent); color: var(--accent); background: rgba(99,102,241,.08); }

        .selrow { display: flex; gap: 8px; }
        .selcol { flex: 1; display: flex; flex-direction: column; gap: 4px; min-width: 0; }
        .sellbl { font-size: 9.5px; font-weight: 700; letter-spacing: .4px; text-transform: uppercase;
                  opacity: .55; padding-left: 2px; }
        .sel {
          width: 100%; padding: 8px 9px; border-radius: 10px; cursor: pointer;
          border: 1px solid #e2e8f0; background: #f8fafc; color: #0f172a;
          font-size: 12.5px; font-weight: 600; appearance: auto;
          text-overflow: ellipsis;
        }
        .sel:hover { border-color: var(--accent); }

        @media (prefers-color-scheme: dark) {
          .panel { background: #1f1f38; color: #f1f5f9; box-shadow: 0 12px 40px -10px rgba(0,0,0,.7), 0 0 0 1px rgba(255,255,255,.06); }
          .divider { background: #33335a; }
          .chip { background: #232342; border-color: #33335a; color: #f1f5f9; }
          .chip:hover { background: #2b2b4d; }
          .chip.on { background: rgba(129,140,248,.18); }
          .sel { background: #232342; border-color: #33335a; color: #f1f5f9; }
          .sel option { background: #1f1f38; color: #f1f5f9; }
        }

        @media (prefers-reduced-motion: reduce) {
          .ball, .panel { transition: opacity .12s linear !important; }
          .ball .spinner { animation-duration: 1.2s; }
        }

        @media print { .wrap { display: none !important; } }

        .ball:focus-visible { outline: 3px solid #fff; outline-offset: 2px; }
        .primary:focus-visible, .chip:focus-visible, .sel:focus-visible {
          outline: 2px solid var(--accent); outline-offset: 2px;
        }
      `}</style>
      <div class="wrap" classList={{ translated: translated() }} ref={wrap}>
        <div
          class="ball"
          classList={{ busy: busy() }}
          ref={ball}
          tabindex="0"
          role="button"
          aria-label="Translate this page"
          title="Click to translate · drag to move"
        >
          <svg class="ic ic-tr" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M12.87 15.07l-2.54-2.51.03-.03c1.74-1.94 2.98-4.17 3.71-6.53H17V4h-7V2H8v2H1v1.99h11.17C11.5 7.92 10.44 9.75 9 11.35c-.93-1.03-1.7-2.16-2.31-3.35h-2c.73 1.63 1.73 3.17 2.98 4.56l-5.09 5.02L4 19l5-5 3.11 3.11.76-2.04zM18.5 10h-2L12 22h2l1.12-3h4.75L21 22h2l-4.5-12zm-2.62 7l1.62-4.33L19.12 17h-3.24z" />
          </svg>
          <svg
            class="ic ic-or"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2.2"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
            <path d="M3 4v4h4" />
          </svg>
          <span class="spinner" />
        </div>
        <div class="panel" classList={{ pinned: pinned() }} ref={panel}>
          <div class="head">
            <svg class="hicon" viewBox="0 0 128 128" aria-hidden="true">
              <polygon points="56.3,29.2 32.6,72 80,72" fill="#fff" />
            </svg>
            <div>
              <div class="htitle">{translated() ? 'Page translated' : 'Translate this page'}</div>
              <div class="hsub">Prism</div>
            </div>
          </div>
          <div class="body">
            <button class="primary" on:click={onPrimaryClick}>
              {translated() ? 'Show original' : 'Translate page'}
            </button>
            <div class="selrow">
              <div class="selcol">
                <span class="sellbl">From</span>
                <select class="sel" on:click={(e) => e.stopPropagation()} on:change={onSourceLanguageChange}>
                  <For each={sourceLangOptions()}>
                    {(code) => (
                      <option value={code} selected={code === sourceLanguage()}>
                        {code === 'auto' ? 'Detect' : codeToLanguage(code, effectiveUiLanguage())}
                      </option>
                    )}
                  </For>
                </select>
              </div>
              <div class="selcol">
                <span class="sellbl">To</span>
                <select class="sel" on:click={(e) => e.stopPropagation()} on:change={onTargetLanguageChange}>
                  <For each={targetLangOptions()}>
                    {(code) => (
                      <option value={code} selected={code === targetLanguage()}>
                        {codeToLanguage(code, effectiveUiLanguage())}
                      </option>
                    )}
                  </For>
                </select>
              </div>
              <div class="selcol">
                <span class="sellbl">Service</span>
                <select class="sel" on:click={(e) => e.stopPropagation()} on:change={onServiceChange}>
                  <For each={serviceOptions()}>
                    {(s) => (
                      <option value={s} selected={s === service()}>
                        {SERVICE_LABELS[s]}
                      </option>
                    )}
                  </For>
                </select>
              </div>
            </div>
            <div class="row">
              <div
                class="chip"
                classList={{ on: alwaysOn() }}
                tabindex="0"
                role="button"
                on:click={onAlwaysClick}
                on:keydown={onChipKeydown}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M5 13l4 4L19 7" />
                </svg>
                <span>Always</span>
              </div>
              <div class="chip" tabindex="0" role="button" on:click={onSettingsClick} on:keydown={onChipKeydown}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <circle cx="12" cy="12" r="3" />
                  <path d="M19 12a7 7 0 0 0-.1-1l2-1.6-2-3.4-2.3 1a7 7 0 0 0-1.7-1l-.4-2.5H9.5L9 4.4a7 7 0 0 0-1.7 1l-2.3-1-2 3.4L5 11a7 7 0 0 0 0 2l-2 1.6 2 3.4 2.3-1a7 7 0 0 0 1.7 1l.5 2.5h4l.4-2.5a7 7 0 0 0 1.7-1l2.3 1 2-3.4-2-1.6a7 7 0 0 0 .1-1z" />
                </svg>
                <span>Settings</span>
              </div>
              <div class="chip" tabindex="0" role="button" on:click={onHideClick} on:keydown={onChipKeydown}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M18 6 6 18M6 6l12 12" />
                </svg>
                <span>Hide</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

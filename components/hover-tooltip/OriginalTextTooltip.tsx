import { createSignal, onCleanup, Show, onMount as solidOnMount } from 'solid-js';
import { twpConfig } from '@/modules/config/store';
import type { PageTranslator } from '@/modules/page-translator/translateLoop';
import { getIsTranslatingSelected } from '@/modules/selection/state';

/**
 * "Hover over translated text to see the original" tooltip, ported from
 * contentScript/showOriginal.js. Desktop only (matches the old code's mobile
 * no-op). Finds the hovered element by linear-scanning the page-translator's
 * live list of translated text nodes for one whose parentElement matches —
 * a plain array scan rather than keeping a WeakMap in sync with continuous
 * mutation-watcher/resweep traffic, since hover events are low-frequency
 * compared to translation network latency.
 */
export function OriginalTextTooltip(props: { pageTranslator: PageTranslator; shadowHost: HTMLElement }) {
  let tooltipRef!: HTMLDivElement;
  const [visible, setVisible] = createSignal(false);
  const [text, setText] = createSignal('');
  const [pos, setPos] = createSignal({ top: 0, left: 0 });

  function findOriginalFor(target: EventTarget | null): string | null {
    if (!(target instanceof Element)) return null;
    for (const { node, original } of props.pageTranslator.getTranslatedNodes()) {
      if (node.parentElement === target && node.data !== original) return original;
    }
    return null;
  }

  solidOnMount(() => {
    const platform = navigator.userAgent;
    const isMobile = /Android|iPhone|iPad|iPod|BlackBerry|Opera Mini|IEMobile|WPDesktop/i.test(platform);
    if (isMobile) return;

    let enabled = twpConfig.get('showOriginalTextWhenHovering') === 'yes';
    let currentTarget: EventTarget | null = null;
    let showTimer: ReturnType<typeof setTimeout> | null = null;
    const mouse = { x: 0, y: 0 };

    function hide(): void {
      setVisible(false);
      if (showTimer) clearTimeout(showTimer);
    }

    function show(target: EventTarget): void {
      if (getIsTranslatingSelected()) return;
      const original = findOriginalFor(target);
      if (!original) return;
      setText(original);
      setVisible(true);
      requestAnimationFrame(() => {
        if (!tooltipRef) return;
        const height = tooltipRef.offsetHeight;
        const width = tooltipRef.offsetWidth;
        let top = mouse.y + 10;
        top = Math.max(0, Math.min(top, window.innerHeight - height));
        let left = mouse.x;
        left = Math.max(0, Math.min(left, window.innerWidth - width));
        setPos({ top, left });
      });
    }

    function onMouseMove(e: MouseEvent): void {
      mouse.x = e.clientX;
      mouse.y = e.clientY;
      if (!enabled) return;
      if ((e.target as Node) === props.shadowHost) return;
      if (e.target === currentTarget) return;
      currentTarget = e.target;
      hide();
      if (e.buttons === 0) {
        showTimer = setTimeout(() => show(e.target as EventTarget), 1250);
      }
    }

    function onMouseDown(e: MouseEvent): void {
      if ((e.target as Node) === props.shadowHost) return;
      hide();
    }

    function onKeyup(e: KeyboardEvent): void {
      if (e.key === 'Escape') hide();
    }

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('blur', hide);
    document.addEventListener('visibilitychange', hide);
    document.addEventListener('keyup', onKeyup);

    const unsub = twpConfig.onChanged((name, value) => {
      if (name === 'showOriginalTextWhenHovering') {
        enabled = value === 'yes';
        if (!enabled) hide();
      }
    });

    onCleanup(() => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('blur', hide);
      document.removeEventListener('visibilitychange', hide);
      document.removeEventListener('keyup', onKeyup);
      unsub();
      if (showTimer) clearTimeout(showTimer);
    });
  });

  return (
    <>
      <style>{`
        .tooltip {
          position: fixed; z-index: 2147483647;
          max-width: 400px; padding: 10px 12px; border-radius: 10px;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif;
          font-size: 13px; line-height: 1.4;
          background: rgba(30, 41, 59, 0.96); color: #fff;
          box-shadow: 0 8px 24px -6px rgba(0,0,0,.5);
        }
        @media (prefers-color-scheme: light) {
          .tooltip { background: rgba(241, 245, 249, 0.98); color: #0f172a; }
        }
      `}</style>
      <Show when={visible()}>
        <div class="tooltip" ref={tooltipRef} dir="auto" style={{ top: `${pos().top}px`, left: `${pos().left}px` }}>
          {text()}
        </div>
      </Show>
    </>
  );
}

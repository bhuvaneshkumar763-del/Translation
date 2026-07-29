import { createSignal, For, onCleanup, Show, onMount as solidOnMount } from 'solid-js';
import type { Config } from '@/modules/config/schema';
import { twpConfig } from '@/modules/config/store';
import { fixTLanguageCode, isRtlLanguage } from '@/modules/languages';
import { sendMessage } from '@/modules/messaging/protocol';
import type { PageLanguageState } from '@/modules/page-translator/translateLoop';
import { getIsTranslatingSelected } from '@/modules/selection/state';

/**
 * "Hover over foreign text to see a live translation" tooltip, ported from
 * contentScript/showTranslated.js. Only active while the page itself is
 * NOT fully translated (pageLanguageState === 'original') — this is the
 * complement to OriginalTextTooltip, which only fires on already-translated
 * text. Desktop only, same as the old code.
 */

const HTML_TAGS_INLINE_TEXT = new Set([
  'a',
  'abbr',
  'acronym',
  'b',
  'bdo',
  'big',
  'cite',
  'dfn',
  'em',
  'i',
  'label',
  'q',
  's',
  'small',
  'span',
  'strong',
  'sub',
  'sup',
  'u',
  'tt',
  'var',
]);
const HTML_TAGS_NO_TRANSLATE = new Set(['title', 'script', 'style', 'textarea', 'svg', 'template', 'math']);
const INVALID_TEXT_RE = /^[0-9!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?\s]*$/;

function isValidText(text: string): boolean {
  return text.length >= 2 && !INVALID_TEXT_RE.test(text);
}

const SERVICE_LABELS: Record<Config['textTranslatorService'], string> = {
  google: 'G',
  bing: 'B',
  yandex: 'Y',
  deepl: 'D',
  libre: 'L',
};
const PAGE_TEXT_SERVICES: Array<Config['textTranslatorService']> = ['google', 'bing', 'yandex', 'deepl'];

export interface TranslatedTextTooltipProps {
  hostname: string;
  shadowHost: HTMLElement;
  getPageLanguageState(): PageLanguageState;
  onPageLanguageStateChange(cb: (state: PageLanguageState) => void): () => void;
  getOriginalLanguage(): string;
  onOriginalLanguageChange(cb: (lang: string) => void): () => void;
}

export function TranslatedTextTooltip(props: TranslatedTextTooltipProps) {
  let tooltipRef!: HTMLDivElement;
  const [visible, setVisible] = createSignal(false);
  const [text, setText] = createSignal('');
  const [pos, setPos] = createSignal({ top: 0, left: 0 });
  const [service, setService] = createSignal(
    twpConfig.get('textTranslatorService') === 'deepl' ? 'google' : twpConfig.get('textTranslatorService'),
  );
  const [targetLanguage, setTargetLanguageSignal] = createSignal(
    twpConfig.get('targetLanguageTextTranslation') ?? 'en',
  );
  const retranslateRef: { current: (() => void) | null } = { current: null };

  function findTranslatableAncestor(node: Element): { text: string; el: Element } | null {
    let current: Node | null = node;
    while (current) {
      const el = current as Element;
      const tagName = el.tagName?.toLowerCase();
      if (!tagName) return null;
      if (HTML_TAGS_NO_TRANSLATE.has(tagName)) return null;

      if (tagName === 'input' || tagName === 'textarea') {
        const input = el as HTMLInputElement;
        if (tagName === 'input' && !/^(?:text|search|button|submit)$/i.test(input.type)) return null;
        const text = input.value || input.placeholder || (input.type === 'submit' ? 'Submit Query' : '');
        return text ? { text, el } : null;
      }

      if (!HTML_TAGS_INLINE_TEXT.has(tagName)) {
        const text = (el as HTMLElement).innerText;
        if (!text || text.length < 1 || text.length > 1000) return null;
        return { text, el };
      }
      current = el.parentNode;
    }
    return null;
  }

  solidOnMount(() => {
    const isMobile = /Android|iPhone|iPad|iPod|BlackBerry|Opera Mini|IEMobile|WPDesktop/i.test(navigator.userAgent);
    if (isMobile) return;

    let showByHoveringSite = twpConfig.get('sitesToTranslateWhenHovering').includes(props.hostname);
    let showByHoveringLang = twpConfig.get('langsToTranslateWhenHovering').includes(props.getOriginalLanguage());
    let showByPressTwice = twpConfig.get('translateTextOverMouseWhenPressTwice') === 'yes';
    let pageState = props.getPageLanguageState();
    let currentTarget: EventTarget | null = null;
    let showTimer: ReturnType<typeof setTimeout> | null = null;
    let generation = 0;
    let lastSourceText: string | null = null;
    const mouse = { x: 0, y: 0 };

    function hide(): void {
      setVisible(false);
      generation++;
      if (showTimer) clearTimeout(showTimer);
    }

    function shouldListenForHover(): boolean {
      return pageState === 'original' && (showByHoveringSite || showByHoveringLang || showByPressTwice);
    }

    async function translateAndShow(target: EventTarget | null): Promise<void> {
      if (getIsTranslatingSelected()) return;
      if (!(target instanceof Element)) return;
      const found = findTranslatableAncestor(target);
      if (!found || !isValidText(found.text)) return;
      lastSourceText = found.text;
      await runTranslation(found.text);
    }

    async function runTranslation(sourceText: string): Promise<void> {
      const myGeneration = ++generation;
      const result = await sendMessage('translateSingleText', {
        serviceName: service(),
        sourceLanguage: 'auto',
        targetLanguage: targetLanguage(),
        text: sourceText,
      }).catch(() => undefined);
      if (myGeneration !== generation || !result) return;

      setText(result);
      setVisible(true);
      requestAnimationFrame(() => {
        if (!tooltipRef) return;
        const height = tooltipRef.offsetHeight;
        const width = tooltipRef.offsetWidth;
        setPos({
          top: Math.max(0, Math.min(mouse.y + 10, window.innerHeight - height)),
          left: Math.max(0, Math.min(mouse.x, window.innerWidth - width)),
        });
      });
    }

    function onMouseMove(e: MouseEvent): void {
      mouse.x = e.clientX;
      mouse.y = e.clientY;
      if ((e.target as Node) === props.shadowHost) return;
      if (e.target === currentTarget) return;
      currentTarget = e.target;
      if (!shouldListenForHover()) return;
      hide();
      if (e.buttons === 0) {
        showTimer = setTimeout(() => void translateAndShow(e.target), 1250);
      }
    }

    function onMouseDown(e: MouseEvent): void {
      if ((e.target as Node) === props.shadowHost) return;
      hide();
    }

    let lastCtrlPress: number | null = null;
    function onKeyup(e: KeyboardEvent): void {
      if (e.key === 'Escape') {
        hide();
        return;
      }
      if (!showByPressTwice) return;
      if (e.key === 'Control') {
        if (lastCtrlPress && performance.now() - lastCtrlPress < 280 && !getIsTranslatingSelected()) {
          const selection = window.getSelection();
          if (!(selection && selection.type === 'Range' && selection.toString())) {
            const hovered = document.querySelectorAll(':hover');
            const deepest = hovered[hovered.length - 1];
            if (deepest) {
              hide();
              void translateAndShow(deepest);
            }
          }
        }
        lastCtrlPress = performance.now();
      }
    }

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('blur', hide);
    document.addEventListener('visibilitychange', hide);
    document.addEventListener('keyup', onKeyup);

    retranslateRef.current = () => {
      if (visible() && lastSourceText) void runTranslation(lastSourceText);
    };

    const unsubConfig = twpConfig.onChanged((name, value) => {
      switch (name) {
        case 'sitesToTranslateWhenHovering':
          showByHoveringSite = (value as string[]).includes(props.hostname);
          break;
        case 'langsToTranslateWhenHovering':
          showByHoveringLang = (value as string[]).includes(props.getOriginalLanguage());
          break;
        case 'translateTextOverMouseWhenPressTwice':
          showByPressTwice = value === 'yes';
          break;
        case 'textTranslatorService':
          setService(value === 'deepl' ? 'google' : (value as Config['textTranslatorService']));
          break;
        case 'targetLanguageTextTranslation':
          setTargetLanguageSignal((value as string | null) ?? 'en');
          break;
      }
    });
    const unsubOriginalLang = props.onOriginalLanguageChange((lang) => {
      showByHoveringLang = twpConfig.get('langsToTranslateWhenHovering').includes(lang);
    });
    const unsubPageState = props.onPageLanguageStateChange((state) => {
      pageState = state;
      if (state !== 'original') hide();
    });

    onCleanup(() => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('blur', hide);
      document.removeEventListener('visibilitychange', hide);
      document.removeEventListener('keyup', onKeyup);
      unsubConfig();
      unsubOriginalLang();
      unsubPageState();
      if (showTimer) clearTimeout(showTimer);
    });
  });

  function onServiceClick(s: Config['textTranslatorService']): void {
    setService(s);
    void twpConfig.set('textTranslatorService', s);
    retranslateRef.current?.();
  }
  function onTargetLangClick(code: string): void {
    const fixed = fixTLanguageCode(code);
    if (!fixed) return;
    setTargetLanguageSignal(fixed);
    void twpConfig.setTargetLanguageTextTranslation(fixed);
    retranslateRef.current?.();
  }

  const serviceOptions = () => {
    const enabled = twpConfig.get('enabledServices');
    return PAGE_TEXT_SERVICES.filter((s) => enabled.includes(s));
  };

  return (
    <>
      <style>{`
        .tooltip {
          position: fixed; z-index: 2147483647;
          max-width: 400px; border-radius: 10px; overflow: hidden;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif;
          font-size: 13px; line-height: 1.4;
          background: rgba(30, 41, 59, 0.96); color: #fff;
          box-shadow: 0 8px 24px -6px rgba(0,0,0,.5);
        }
        @media (prefers-color-scheme: light) {
          .tooltip { background: rgba(241, 245, 249, 0.98); color: #0f172a; }
          .head { background: rgba(0,0,0,.06) !important; }
          .chip { border-color: rgba(0,0,0,.15) !important; }
        }
        .body { padding: 10px 12px; }
        .head { display: flex; gap: 4px; padding: 5px 8px; background: rgba(255,255,255,.08); }
        .chip {
          border: 1px solid rgba(255,255,255,.25); border-radius: 6px;
          font-size: 10px; font-weight: 700; padding: 2px 6px; cursor: pointer;
        }
        .chip.on { border-color: #60a5fa; color: #60a5fa; }
      `}</style>
      <Show when={visible()}>
        <div class="tooltip" ref={tooltipRef} style={{ top: `${pos().top}px`, left: `${pos().left}px` }}>
          <div class="head">
            <For each={twpConfig.get('targetLanguages').slice(0, 3)}>
              {(code) => (
                <div
                  class="chip"
                  classList={{ on: code === targetLanguage() }}
                  on:click={() => onTargetLangClick(code)}
                >
                  {code}
                </div>
              )}
            </For>
            <For each={serviceOptions()}>
              {(s) => (
                <div class="chip" classList={{ on: s === service() }} on:click={() => onServiceClick(s)}>
                  {SERVICE_LABELS[s]}
                </div>
              )}
            </For>
          </div>
          <div class="body" dir={isRtlLanguage(targetLanguage()) ? 'rtl' : 'ltr'}>
            {text()}
          </div>
        </div>
      </Show>
    </>
  );
}

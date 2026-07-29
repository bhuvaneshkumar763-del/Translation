import { createSignal, onCleanup, onMount as solidOnMount, For, Show } from 'solid-js';
import { twpConfig } from '@/modules/config/store';
import { onMessage, sendMessage } from '@/modules/messaging/protocol';
import { codeToLanguage, fixTLanguageCode, isRtlLanguage } from '@/modules/languages';
import type { Config } from '@/modules/config/schema';
import { getPlatformInfo } from '@/modules/platform/platformInfo';
import {
  detectTextLanguage,
  getSelectionText,
  isSelectingText,
  isValidText,
  readSelection,
  replaceSelectionText,
  type SelectionInfo,
} from '@/modules/selection/selectionUtils';
import { setIsTranslatingSelected } from '@/modules/selection/state';

/**
 * The "translate selected text" feature: a small button appears near a text
 * selection; clicking it (or double-tapping Ctrl, or a hotkey) opens a
 * popup with the original (editable) and translated text, language/service
 * pickers, listen/copy/replace actions. Ported from the ~1300-line
 * contentScript/translateSelected.js. Visual design modernized to match the
 * floating bubble's card style rather than porting the old CSS verbatim
 * (same call as the plan's "drop w3.css, hand-roll instead" decision for
 * other surfaces) — the interaction model (selection detection, cross-frame
 * focus arbitration, drag-to-move, replace-in-place) is kept faithful.
 */

export interface SelectionPopupProps {
  hostname: string;
  shadowHost: HTMLElement;
  getOriginalLanguage(): string;
  onOriginalLanguageChange(cb: (lang: string) => void): () => void;
}

const PAGE_TEXT_SERVICES: Array<Config['textTranslatorService']> = ['google', 'bing', 'yandex', 'deepl', 'libre'];
const SERVICE_LABELS: Record<Config['textTranslatorService'], string> = {
  google: 'G',
  bing: 'B',
  yandex: 'Y',
  deepl: 'D',
  libre: 'L',
};

let isPlayingAudioGlobal = false;

export function SelectionPopup(props: SelectionPopupProps) {
  let buttonRef!: HTMLDivElement;
  let panelRef!: HTMLDivElement;
  let dragHandleRef!: HTMLDivElement;
  let origTextRef!: HTMLDivElement;

  const [buttonVisible, setButtonVisible] = createSignal(false);
  const [buttonPos, setButtonPos] = createSignal({ x: 0, y: 0 });
  const [panelOpen, setPanelOpen] = createSignal(false);
  const [panelPos, setPanelPos] = createSignal<{ top: number; left: number } | null>(null);
  const [busy, setBusy] = createSignal(false);
  const [translatedText, setTranslatedText] = createSignal('');
  const [expanded, setExpanded] = createSignal(twpConfig.get('expandPanelTranslateSelectedText') === 'yes');
  const [service, setService] = createSignal(twpConfig.get('textTranslatorService'));
  const [targetLanguage, setTargetLanguageSignal] = createSignal(twpConfig.get('targetLanguageTextTranslation') ?? 'en');
  const [listening, setListening] = createSignal<'original' | 'translated' | null>(null);
  const [isEditable, setIsEditable] = createSignal(false);

  let selectionInfo: SelectionInfo | null = null;
  let generation = 0;
  let resultApplied = false;

  const platform = getPlatformInfo();

  const targetLanguageOptions = () => twpConfig.get('targetLanguages').slice(0, 3);
  const serviceOptions = () => {
    const enabled = twpConfig.get('enabledServices');
    const hasLibre = twpConfig.get('customServices').some((cs) => cs.name === 'libre');
    return PAGE_TEXT_SERVICES.filter((s) => (s === 'libre' ? hasLibre : enabled.includes(s)));
  };

  function stopAudio(): void {
    if (!isPlayingAudioGlobal) return;
    isPlayingAudioGlobal = false;
    void sendMessage('stopAudio', undefined).catch(() => {});
  }

  function playAudio(text: string, lang: string, onEnded: () => void): void {
    isPlayingAudioGlobal = true;
    void sendMessage('textToSpeech', { text, targetLanguage: lang })
      .catch(() => {})
      .then(() => {
        isPlayingAudioGlobal = false;
        onEnded();
      });
  }

  async function translate(): Promise<void> {
    generation++;
    const myGeneration = generation;
    stopAudio();
    resultApplied = false;
    setBusy(true);

    const text = origTextRef?.textContent ?? '';
    const result = await sendMessage('translateSingleText', {
      serviceName: service(),
      sourceLanguage: 'auto',
      targetLanguage: targetLanguage(),
      text,
    }).catch(() => undefined);

    if (myGeneration !== generation) return;
    resultApplied = true;
    setBusy(false);
    setTranslatedText(result ?? '');
  }

  function positionPanel(): void {
    if (!selectionInfo) return;
    const edge = 8;
    const width = panelRef.offsetWidth || 320;
    const height = panelRef.offsetHeight || 160;
    let top = selectionInfo.bottom + 5;
    top = Math.max(edge, Math.min(top, window.innerHeight - height - edge));
    let left = selectionInfo.left;
    left = Math.max(edge, Math.min(left, window.innerWidth - width - edge));
    setPanelPos({ top, left });
  }

  function openPanel(): void {
    setButtonVisible(false);
    if (!selectionInfo) return;
    setIsEditable(selectionInfo.isInputElement || selectionInfo.isContentEditable);
    if (selectionInfo.isInputElement || selectionInfo.isContentEditable) setExpanded(true);
    else setExpanded(twpConfig.get('expandPanelTranslateSelectedText') === 'yes');

    if (origTextRef) origTextRef.textContent = selectionInfo.text;
    setPanelOpen(true);
    setIsTranslatingSelected(true);
    // Position after render, once the panel has real dimensions.
    requestAnimationFrame(positionPanel);
    void translate();

    // Fallback: if the real translation is slow/silently fails, don't leave
    // the popup showing nothing forever.
    const myGeneration = generation;
    setTimeout(() => {
      if (myGeneration !== generation || resultApplied) return;
      requestAnimationFrame(positionPanel);
    }, 1000);
  }

  function closePanel(): void {
    stopAudio();
    setPanelOpen(false);
    setButtonVisible(false);
    setIsTranslatingSelected(false);
    selectionInfo = null;
  }

  function onListenClick(which: 'original' | 'translated', text: string, lang: string): void {
    if (listening() === which) {
      stopAudio();
      setListening(null);
      return;
    }
    if (listening()) stopAudio();
    setListening(which);
    playAudio(text, lang, () => setListening((cur) => (cur === which ? null : cur)));
  }

  function onCopy(): void {
    void navigator.clipboard.writeText(translatedText());
  }

  function onReplace(): void {
    if (!selectionInfo) return;
    const info = selectionInfo;
    const replacement = translatedText();
    closePanel();
    replaceSelectionText(info, replacement);
  }

  function onServiceClick(s: Config['textTranslatorService']): void {
    if (s === 'deepl' && twpConfig.get('deeplConfirmed') !== 'yes') {
      if (!confirm('DeepL opens a background tab at deepl.com to perform this translation. Continue?')) return;
      void twpConfig.set('deeplConfirmed', 'yes');
    }
    setService(s);
    void twpConfig.set('textTranslatorService', s);
    void translate();
  }

  function onTargetLanguageClick(code: string): void {
    const fixed = fixTLanguageCode(code);
    if (!fixed) return;
    setTargetLanguageSignal(fixed);
    void twpConfig.setTargetLanguageTextTranslation(fixed);
    void translate();
  }

  function onToggleExpand(): void {
    setExpanded(!expanded());
    void twpConfig.set('expandPanelTranslateSelectedText', expanded() ? 'yes' : 'no');
  }

  // --- selection detection ---

  function shouldShowButton(): boolean {
    if (twpConfig.get('showTranslateSelectedButton') !== 'yes') return false;
    const hostname = props.hostname;
    const always = twpConfig.get('alwaysTranslateSites').includes(hostname);
    const neverSite = twpConfig.get('neverTranslateSites').includes(hostname);
    const originalLanguage = props.getOriginalLanguage();
    const neverLang = twpConfig.get('neverTranslateLangs').includes(originalLanguage);
    if (!(always || (!neverSite && !neverLang))) return false;
    if (twpConfig.get('dontShowIfPageLangIsTargetLang') === 'yes' && originalLanguage === targetLanguage()) return false;
    if (twpConfig.get('dontShowIfPageLangIsUnknown') === 'yes' && originalLanguage === 'und') return false;
    return true;
  }

  async function onSelectionMade(clientX: number, clientY: number): Promise<void> {
    const text = getSelectionText().trim();
    if (!text) return;
    const { lang: detected } = await detectTextLanguage(text);

    if (twpConfig.get('dontShowIfSelectedTextIsTargetLang') === 'yes' && detected === targetLanguage()) return;
    if (twpConfig.get('dontShowIfSelectedTextIsUnknown') === 'yes' && detected !== 'und') return;
    // (the two checks above intentionally mirror the old code's slightly odd
    // De-Morgan'd gating — dontShowIf...Unknown only *requires* a non-"und"
    // detection, it doesn't skip on "und" by itself)
    if (twpConfig.get('dontShowIfIsNotValidText') === 'yes' && !isValidText(text)) return;

    selectionInfo = readSelection();
    if (!selectionInfo) return;

    if (platform.isMobile.any) {
      setButtonPos({ x: window.innerWidth - 45, y: clientY });
    } else {
      setButtonPos({ x: Math.min(window.innerWidth - 40, clientX + 25), y: Math.max(2, clientY - 35) });
    }
    setButtonVisible(true);
  }

  solidOnMount(() => {
    let showButtonTimer: ReturnType<typeof setTimeout> | null = null;
    let lastCtrlPress: number | null = null;
    let isTouchSelection = false;

    function onMouseup(e: MouseEvent): void {
      if (e.button !== 0) return;
      // e.target is retargeted to the shadow host (not the internal panelRef)
      // when observed from a document-level listener outside the shadow
      // tree — comparing against the host is the only way to detect "this
      // click landed somewhere inside our own UI" from out here.
      if ((e.target as Node) === props.shadowHost) return;
      if (!shouldShowButton()) return;
      if (showButtonTimer) clearTimeout(showButtonTimer);
      showButtonTimer = setTimeout(() => onSelectionMade(e.clientX, e.clientY), 150);
    }

    function onTouchend(e: TouchEvent): void {
      isTouchSelection = true;
      if (!shouldShowButton()) return;
      if (showButtonTimer) clearTimeout(showButtonTimer);
      const touch = e.changedTouches[0];
      showButtonTimer = setTimeout(() => onSelectionMade(touch?.clientX ?? 0, touch?.clientY ?? 0), 150);
    }

    function destroyIfButtonShowing(e: Event): void {
      if (buttonVisible() && (e.target as Node) !== props.shadowHost) {
        setButtonVisible(false);
      }
    }

    function onDocKeyup(e: KeyboardEvent): void {
      if (e.key === 'Escape') {
        closePanel();
        return;
      }
      if (twpConfig.get('translateSelectedWhenPressTwice') !== 'yes') return;
      if (e.key === 'Control') {
        if (lastCtrlPress && performance.now() - lastCtrlPress < 280 && isSelectingText()) {
          lastCtrlPress = performance.now();
          selectionInfo = readSelection();
          if (selectionInfo) openPanel();
        }
        lastCtrlPress = performance.now();
      }
    }

    document.addEventListener('mouseup', onMouseup);
    document.addEventListener('blur', destroyIfButtonShowing);
    document.addEventListener('visibilitychange', destroyIfButtonShowing);
    document.addEventListener('keydown', destroyIfButtonShowing);
    document.addEventListener('mousedown', destroyIfButtonShowing);
    document.addEventListener('wheel', destroyIfButtonShowing);
    document.addEventListener('keyup', onDocKeyup, true);
    if (platform.isMobile.any) {
      document.addEventListener('touchend', onTouchend);
    }

    const unsubOriginalLang = props.onOriginalLanguageChange(() => {
      // Re-evaluate nothing proactively — gating is read live on next
      // interaction, matching how config-driven gating already works.
    });

    let windowIsInFocus = true;
    function onWindowFocus(): void {
      windowIsInFocus = true;
      void sendMessage('thisFrameIsInFocus', undefined).catch(() => {});
    }
    function onWindowBlur(): void {
      windowIsInFocus = false;
    }
    window.addEventListener('focus', onWindowFocus);
    window.addEventListener('blur', onWindowBlur);
    const offAnotherFrameFocus = onMessage('anotherFrameIsInFocus', () => {
      if (!windowIsInFocus) closePanel();
    });

    // Triggered by the keyboard commands (background wiring lands in Phase 7).
    const offTranslateSelected = onMessage('TranslateSelectedText', () => {
      selectionInfo = readSelection();
      if (selectionInfo) openPanel();
    });
    const offHotTranslateSelected = onMessage('hotTranslateSelectedText', async () => {
      const info = readSelection();
      if (!info?.text) return;
      const el = info.element;
      const canFocus = el.nodeType === Node.TEXT_NODE ? !!(el.parentNode as HTMLElement | null)?.focus : !!(el as HTMLElement).focus;
      if (!canFocus) return;
      if (info.isInputElement && (info.element as HTMLInputElement).readOnly) return;
      const result = await sendMessage('translateSingleText', {
        serviceName: twpConfig.get('textTranslatorService'),
        sourceLanguage: 'auto',
        targetLanguage: twpConfig.get('targetLanguageTextTranslation') ?? 'en',
        text: info.text,
      }).catch(() => undefined);
      if (!result) return;
      closePanel();
      replaceSelectionText(info, result);
    });

    // Drag-to-move the panel.
    let dragging = false;
    let dragStartX = 0;
    let dragStartY = 0;
    let startTop = 0;
    let startLeft = 0;
    function onDragStart(e: MouseEvent): void {
      dragging = true;
      dragStartX = e.clientX;
      dragStartY = e.clientY;
      const pos = panelPos();
      startTop = pos?.top ?? 0;
      startLeft = pos?.left ?? 0;
      document.addEventListener('mousemove', onDragMove);
      document.addEventListener('mouseup', onDragEnd);
    }
    function onDragMove(e: MouseEvent): void {
      if (!dragging) return;
      const height = panelRef.offsetHeight;
      const top = Math.min(window.innerHeight - height, Math.max(0, startTop - (dragStartY - e.clientY)));
      const left = Math.max(0, startLeft - (dragStartX - e.clientX));
      setPanelPos({ top, left });
    }
    function onDragEnd(): void {
      dragging = false;
      document.removeEventListener('mousemove', onDragMove);
      document.removeEventListener('mouseup', onDragEnd);
    }
    dragHandleRef?.addEventListener('mousedown', onDragStart);

    onCleanup(() => {
      document.removeEventListener('mouseup', onMouseup);
      document.removeEventListener('blur', destroyIfButtonShowing);
      document.removeEventListener('visibilitychange', destroyIfButtonShowing);
      document.removeEventListener('keydown', destroyIfButtonShowing);
      document.removeEventListener('mousedown', destroyIfButtonShowing);
      document.removeEventListener('wheel', destroyIfButtonShowing);
      document.removeEventListener('keyup', onDocKeyup, true);
      if (platform.isMobile.any) document.removeEventListener('touchend', onTouchend);
      dragHandleRef?.removeEventListener('mousedown', onDragStart);
      window.removeEventListener('focus', onWindowFocus);
      window.removeEventListener('blur', onWindowBlur);
      unsubOriginalLang();
      offAnotherFrameFocus();
      offTranslateSelected();
      offHotTranslateSelected();
    });
  });

  let inputDebounce: ReturnType<typeof setTimeout> | null = null;
  function onOrigTextInput(): void {
    if (inputDebounce) clearTimeout(inputDebounce);
    inputDebounce = setTimeout(() => void translate(), 600);
  }

  return (
    <>
      <style>{`
        * { box-sizing: border-box; margin: 0; padding: 0;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif; }

        .btn {
          position: fixed; width: 30px; height: 30px; border-radius: 50%;
          cursor: pointer; z-index: 2147483647;
          background: linear-gradient(140deg, #2563eb, #1d4ed8);
          box-shadow: 0 4px 12px -3px rgba(0,0,0,.5);
          display: flex; align-items: center; justify-content: center;
          color: #fff; font-weight: 700; font-size: 13px;
        }
        .btn:hover { filter: brightness(1.08); }

        .panel {
          position: fixed; z-index: 2147483647;
          width: 340px; max-width: calc(100vw - 16px);
          border-radius: 14px; overflow: hidden;
          background: #fff; color: #0f172a;
          box-shadow: 0 12px 40px -10px rgba(15,23,42,.55), 0 0 0 1px rgba(15,23,42,.06);
        }
        @media (prefers-color-scheme: dark) {
          .panel { background: #1e293b; color: #e2e8f0; box-shadow: 0 12px 40px -10px rgba(0,0,0,.7), 0 0 0 1px rgba(255,255,255,.06); }
          .textbox { border-color: #334155 !important; }
          .chip { background: #273345 !important; border-color: #334155 !important; color: #e2e8f0 !important; }
          .chip.on { background: rgba(96,165,250,.14) !important; }
          .drag { background: #182234 !important; }
        }

        .drag { cursor: move; padding: 6px 10px; background: #f1f5f9; display: flex; align-items: center; justify-content: space-between; gap: 6px; }
        .langs { display: flex; gap: 4px; }
        .services { display: flex; gap: 4px; }
        .chip {
          border: 1px solid #e2e8f0; background: #f8fafc; color: #0f172a;
          border-radius: 8px; padding: 3px 7px; font-size: 11px; font-weight: 700;
          cursor: pointer;
        }
        .chip.on { border-color: #2563eb; color: #2563eb; background: rgba(37,99,235,.08); }
        .expandBtn { cursor: pointer; font-size: 11px; opacity: .6; padding: 2px 6px; }

        .textbox {
          padding: 12px; font-size: 14px; line-height: 1.4;
          max-height: 200px; overflow: auto; white-space: pre-wrap;
          border-top: 1px solid #e8edf3;
          position: relative;
        }
        #origText { outline: none; user-select: text; }
        .textbox.hidden { display: none; }

        .actions { display: flex; gap: 6px; padding: 6px 10px 10px; }
        .actionBtn {
          border: 1px solid #e2e8f0; background: #f8fafc; border-radius: 8px;
          font-size: 11px; font-weight: 600; padding: 5px 9px; cursor: pointer;
        }
        .actionBtn.on { border-color: #2563eb; color: #2563eb; }
        .spinner-row { padding: 8px 12px; font-size: 12px; opacity: .6; }
      `}</style>

      <Show when={buttonVisible()}>
        <div
          class="btn"
          ref={buttonRef}
          style={{ left: `${buttonPos().x}px`, top: `${buttonPos().y}px` }}
          on:click={(e) => {
            e.stopPropagation();
            openPanel();
          }}
        >
          文
        </div>
      </Show>

      <Show when={panelOpen()}>
        <div
          class="panel"
          ref={panelRef}
          style={panelPos() ? { top: `${panelPos()!.top}px`, left: `${panelPos()!.left}px` } : { visibility: 'hidden' }}
        >
          <div class="drag" ref={dragHandleRef}>
            <div class="langs">
              <For each={targetLanguageOptions()}>
                {(code) => (
                  <div
                    class="chip"
                    classList={{ on: code === targetLanguage() }}
                    title={codeToLanguage(code, twpConfig.get('uiLanguage') !== 'default' ? twpConfig.get('uiLanguage') : browser.i18n.getUILanguage())}
                    on:click={() => onTargetLanguageClick(code)}
                  >
                    {code}
                  </div>
                )}
              </For>
            </div>
            <div class="expandBtn" on:click={onToggleExpand}>
              {expanded() ? '▲' : '▼'}
            </div>
            <div class="services">
              <For each={serviceOptions()}>
                {(s) => (
                  <div class="chip" classList={{ on: s === service() }} title={s} on:click={() => onServiceClick(s)}>
                    {SERVICE_LABELS[s]}
                  </div>
                )}
              </For>
            </div>
          </div>

          <div class="textbox" classList={{ hidden: !expanded() }}>
            <div
              id="origText"
              ref={origTextRef}
              contentEditable
              spellcheck={false}
              dir="auto"
              on:input={onOrigTextInput}
              on:keydown={(e) => e.stopPropagation()}
              on:keyup={(e) => e.stopPropagation()}
            />
          </div>

          <div class="textbox" dir={isRtlLanguage(targetLanguage()) ? 'rtl' : 'ltr'}>
            <Show when={!busy()} fallback={<div class="spinner-row">…</div>}>
              {translatedText()}
            </Show>
          </div>

          <div class="actions">
            <div
              class="actionBtn"
              classList={{ on: listening() === 'original' }}
              on:click={() => onListenClick('original', origTextRef?.textContent ?? '', props.getOriginalLanguage())}
            >
              🔊 orig
            </div>
            <div
              class="actionBtn"
              classList={{ on: listening() === 'translated' }}
              on:click={() => onListenClick('translated', translatedText(), targetLanguage())}
            >
              🔊 tr
            </div>
            <div class="actionBtn" on:click={onCopy}>
              copy
            </div>
            <Show when={isEditable()}>
              <div class="actionBtn" on:click={onReplace}>
                replace
              </div>
            </Show>
          </div>
        </div>
      </Show>
    </>
  );
}

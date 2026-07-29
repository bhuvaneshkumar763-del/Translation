import { fixTLanguageCode } from '../languages';

/**
 * Shared helpers ported from the near-identical copies of these functions in
 * the old contentScript/translateSelected.js and showTranslated.js.
 */

export interface SelectionInfo {
  isInputElement: boolean;
  isContentEditable: boolean;
  element: Element | Node;
  selStart: number;
  selEnd: number;
  text: string;
  top: number;
  left: number;
  bottom: number;
  right: number;
  range?: Range;
}

function isTextInputElement(el: Element | null): el is HTMLInputElement | HTMLTextAreaElement {
  if (!el) return false;
  const tag = el.tagName.toLowerCase();
  if (tag === 'textarea') return true;
  return (
    tag === 'input' &&
    /^(?:text|search)$/i.test((el as HTMLInputElement).type) &&
    typeof (el as HTMLInputElement).selectionStart === 'number'
  );
}

export function getSelectionText(): string {
  const activeEl = document.activeElement;
  if (isTextInputElement(activeEl)) {
    return activeEl.value.slice(activeEl.selectionStart ?? 0, activeEl.selectionEnd ?? 0);
  }
  return window.getSelection()?.toString() ?? '';
}

export function readSelection(): SelectionInfo | null {
  const activeEl = document.activeElement;
  if (isTextInputElement(activeEl)) {
    const rect = activeEl.getBoundingClientRect();
    return {
      isInputElement: true,
      isContentEditable: false,
      element: activeEl,
      selStart: activeEl.selectionStart ?? 0,
      selEnd: activeEl.selectionEnd ?? 0,
      text: activeEl.value.slice(activeEl.selectionStart ?? 0, activeEl.selectionEnd ?? 0),
      top: rect.top,
      left: rect.left,
      bottom: rect.bottom,
      right: rect.right,
    };
  }

  const selection = window.getSelection();
  if (selection && selection.type === 'Range' && selection.rangeCount > 0) {
    const range = selection.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    const focusNode = selection.focusNode;
    const isContentEditable =
      focusNode?.nodeType === Node.TEXT_NODE
        ? !!(focusNode.parentNode as HTMLElement | null)?.isContentEditable
        : !!(focusNode as HTMLElement | null)?.isContentEditable;
    return {
      isInputElement: false,
      isContentEditable,
      element: focusNode ?? document.body,
      selStart: range.startOffset,
      selEnd: range.endOffset,
      text: selection.toString(),
      top: rect.top,
      left: rect.left,
      bottom: rect.bottom,
      right: rect.right,
      range,
    };
  }

  return null;
}

export function isSelectingText(): boolean {
  const activeEl = document.activeElement;
  if (isTextInputElement(activeEl)) {
    return !!activeEl.value.slice(activeEl.selectionStart ?? 0, activeEl.selectionEnd ?? 0);
  }
  const selection = window.getSelection();
  return !!(selection && selection.type === 'Range' && selection.toString());
}

const INVALID_TEXT_RE = /^[0-9!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?\s]*$/;

export function isValidText(text: string): boolean {
  if (text.length < 2) return false;
  if (INVALID_TEXT_RE.test(text)) return false;
  return true;
}

export async function detectTextLanguage(text: string): Promise<{ lang: string; isReliable: boolean }> {
  if (!browser.i18n.detectLanguage) return { lang: 'und', isReliable: false };
  const result = await browser.i18n.detectLanguage(text);
  for (const langInfo of result?.languages ?? []) {
    const langCode = fixTLanguageCode(langInfo.language);
    if (langCode) return { lang: langCode, isReliable: result.isReliable };
  }
  return { lang: 'und', isReliable: false };
}

/** Replace the current selection/input value with translated text, then restore the caret/selection range (ported from replaceText() in translateSelected.js). */
export function replaceSelectionText(info: SelectionInfo, replacement: string): void {
  const el = info.element;
  if (el.nodeType === Node.TEXT_NODE) {
    (el.parentNode as HTMLElement | null)?.focus();
  } else {
    (el as HTMLElement).focus?.();
  }
  document.execCommand('selectAll', false);
  if (info.isInputElement) {
    (el as HTMLInputElement).setSelectionRange(info.selStart, info.selEnd);
  } else if (info.isContentEditable && info.range) {
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(info.range);
  }
  document.execCommand('insertText', false, replacement);
}

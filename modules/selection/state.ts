/**
 * Tiny cross-feature coordination flag, ported from the old code's global
 * `window.isTranslatingSelected` — set while the selection-translate popup
 * is open so the hover tooltips (which also popup near the cursor) don't
 * fight with it for screen space.
 */
let translatingSelected = false;

export function getIsTranslatingSelected(): boolean {
  return translatingSelected;
}

export function setIsTranslatingSelected(value: boolean): void {
  translatingSelected = value;
}

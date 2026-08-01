// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../messaging/protocol', () => ({ sendMessage: vi.fn() }));

import { sendMessage } from '../messaging/protocol';
import { createTitleTranslator, type TitleTranslatorOptions } from './titleTranslator';

const sendMessageMock = vi.mocked(sendMessage);

function mockTranslateOnce(response: string[][]): void {
  sendMessageMock.mockResolvedValueOnce(response as never);
}

function setDocumentTitle(text: string): void {
  document.title = text;
}

// catchUp() is deliberately `void`-returning in production (every call site
// fires it and moves on — see translateLoop.ts) rather than something
// callers await, so awaiting it directly only waits one microtask tick, not
// the full async chain it kicks off underneath. A real macrotask boundary
// (unlike a chain of `await Promise.resolve()`, whose exact depth would
// depend on the module's internal implementation) guarantees every pending
// microtask — however many levels deep — has settled first.
function flushAsyncWork(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

// document.head is shared across every test in this file (happy-dom's
// document isn't recreated per test) — a translator whose start() was
// called leaves a live MutationObserver on <head> until restore() is
// called. Without tracking + tearing every one of them down, a later
// test's title mutation fires ALL previous tests' still-active observers
// too, each firing its own independent (and duplicate) translation
// request. newTranslator() below is the only way tests in this file
// should construct one, so cleanup can't be forgotten per-test.
const activeTranslators: ReturnType<typeof createTitleTranslator>[] = [];
function newTranslator(options: TitleTranslatorOptions) {
  const translator = createTitleTranslator(options);
  activeTranslators.push(translator);
  return translator;
}

beforeEach(() => {
  sendMessageMock.mockReset();
  document.title = '';
  // Ensure a clean <title> per test — happy-dom carries document state
  // across tests within the same file otherwise.
  document.querySelectorAll('title').forEach((el) => {
    el.remove();
  });
  const titleEl = document.createElement('title');
  document.head.appendChild(titleEl);
});

afterEach(() => {
  activeTranslators.splice(0).forEach((t) => {
    t.restore();
  });
  vi.restoreAllMocks();
});

describe('createTitleTranslator', () => {
  it('sends the title through the [[title, " "]] two-item batching workaround, not a bare single string', async () => {
    setDocumentTitle('Hello World');
    mockTranslateOnce([['Hola Mundo', ' ']]);
    const translator = newTranslator({
      getService: () => 'google',
      getSourceLanguage: () => 'en',
      isPageVisible: () => true,
    });

    await translator.start('es');

    expect(sendMessageMock).toHaveBeenCalledWith('translateHTML', {
      translationService: 'google',
      sourceLanguage: 'en',
      targetLanguage: 'es',
      sourceArray2d: [['Hello World', ' ']],
      dontSortResults: false,
    });
  });

  it('dual-writes the translated title to both document.title and the <title> element', async () => {
    setDocumentTitle('Hello World');
    mockTranslateOnce([['Hola Mundo', ' ']]);
    const translator = newTranslator({
      getService: () => 'google',
      getSourceLanguage: () => 'en',
      isPageVisible: () => true,
    });

    await translator.start('es');

    expect(document.title).toBe('Hola Mundo');
    expect(document.querySelector('title')?.textContent).toBe('Hola Mundo');
  });

  it('creates a <title> element if the page has none', async () => {
    document.querySelectorAll('title').forEach((el) => {
      el.remove();
    });
    setDocumentTitle('Hello World'); // document.title still works without a <title> element present
    mockTranslateOnce([['Hola Mundo', ' ']]);
    const translator = newTranslator({
      getService: () => 'google',
      getSourceLanguage: () => 'en',
      isPageVisible: () => true,
    });

    await translator.start('es');

    expect(document.querySelector('title')?.textContent).toBe('Hola Mundo');
  });

  it('does nothing when the page title is empty', async () => {
    setDocumentTitle('');
    const translator = newTranslator({
      getService: () => 'google',
      getSourceLanguage: () => 'en',
      isPageVisible: () => true,
    });

    await translator.start('es');

    expect(sendMessageMock).not.toHaveBeenCalled();
  });

  it('leaves the title untouched when the provider returns the same text back (no real translation)', async () => {
    setDocumentTitle('Hello World');
    mockTranslateOnce([['Hello World', ' ']]); // provider echoed it back untranslated
    const translator = newTranslator({
      getService: () => 'google',
      getSourceLanguage: () => 'en',
      isPageVisible: () => true,
    });

    await translator.start('es');

    expect(document.title).toBe('Hello World');
  });

  it('leaves the title untouched when the request fails', async () => {
    setDocumentTitle('Hello World');
    sendMessageMock.mockRejectedValueOnce(new Error('network down'));
    const translator = newTranslator({
      getService: () => 'google',
      getSourceLanguage: () => 'en',
      isPageVisible: () => true,
    });

    await translator.start('es');

    expect(document.title).toBe('Hello World');
  });

  it('restore() writes the original (pre-translation) title back', async () => {
    setDocumentTitle('Hello World');
    mockTranslateOnce([['Hola Mundo', ' ']]);
    const translator = newTranslator({
      getService: () => 'google',
      getSourceLanguage: () => 'en',
      isPageVisible: () => true,
    });
    await translator.start('es');
    expect(document.title).toBe('Hola Mundo');

    translator.restore();

    expect(document.title).toBe('Hello World');
    expect(document.querySelector('title')?.textContent).toBe('Hello World');
  });

  it('caches a translation result and does not re-request for the same source/target/text', async () => {
    setDocumentTitle('Hello World');
    mockTranslateOnce([['Hola Mundo', ' ']]);
    const translator = newTranslator({
      getService: () => 'google',
      getSourceLanguage: () => 'en',
      isPageVisible: () => true,
    });
    await translator.start('es');
    expect(sendMessageMock).toHaveBeenCalledTimes(1);

    // Restore, then translate the exact same title/language pair again —
    // should hit the cache, not send a second request.
    translator.restore();
    setDocumentTitle('Hello World');
    await translator.start('es');

    expect(sendMessageMock).toHaveBeenCalledTimes(1);
    expect(document.title).toBe('Hola Mundo');
  });

  it('catchUp() retranslates when the page JS changed the title since the last translation', async () => {
    setDocumentTitle('Hello World');
    mockTranslateOnce([['Hola Mundo', ' ']]);
    const translator = newTranslator({
      getService: () => 'google',
      getSourceLanguage: () => 'en',
      isPageVisible: () => true,
    });
    await translator.start('es');
    expect(document.title).toBe('Hola Mundo');

    // Simulate a site rewriting its own title (SPA chapter switch, a
    // notification counter, ...).
    setDocumentTitle('Chapter 2');
    mockTranslateOnce([['Capítulo 2', ' ']]);

    translator.catchUp();
    await flushAsyncWork();

    expect(sendMessageMock).toHaveBeenCalledTimes(2);
    expect(document.title).toBe('Capítulo 2');
  });

  it('catchUp() does nothing when the title has not changed since the last translation', async () => {
    setDocumentTitle('Hello World');
    mockTranslateOnce([['Hola Mundo', ' ']]);
    const translator = newTranslator({
      getService: () => 'google',
      getSourceLanguage: () => 'en',
      isPageVisible: () => true,
    });
    await translator.start('es');
    sendMessageMock.mockClear();

    await translator.catchUp();

    expect(sendMessageMock).not.toHaveBeenCalled();
  });

  it('catchUp() is a no-op before start() / after restore()', async () => {
    const translator = newTranslator({
      getService: () => 'google',
      getSourceLanguage: () => 'en',
      isPageVisible: () => true,
    });

    await translator.catchUp();

    expect(sendMessageMock).not.toHaveBeenCalled();
  });

  it('does not retranslate while the page is hidden', async () => {
    setDocumentTitle('Hello World');
    mockTranslateOnce([['Hola Mundo', ' ']]);
    let visible = true;
    const translator = newTranslator({
      getService: () => 'google',
      getSourceLanguage: () => 'en',
      isPageVisible: () => visible,
    });
    await translator.start('es');
    sendMessageMock.mockClear();

    visible = false;
    setDocumentTitle('Chapter 2');
    await translator.catchUp();

    expect(sendMessageMock).not.toHaveBeenCalled();
  });

  it('a MutationObserver on <head> triggers retranslation when the site rewrites <title> directly (not via document.title)', async () => {
    setDocumentTitle('Hello World');
    mockTranslateOnce([['Hola Mundo', ' ']]);
    const translator = newTranslator({
      getService: () => 'google',
      getSourceLanguage: () => 'en',
      isPageVisible: () => true,
    });
    await translator.start('es');
    sendMessageMock.mockClear();
    mockTranslateOnce([['Capítulo 2', ' ']]);

    const titleEl = document.querySelector('title');
    if (!titleEl) throw new Error('expected a <title> element');
    titleEl.textContent = 'Chapter 2';

    await flushAsyncWork();

    expect(sendMessageMock).toHaveBeenCalledTimes(1);
    expect(document.title).toBe('Capítulo 2');
  });

  it("the observer does not re-trigger on the module's own dual-write (no infinite loop)", async () => {
    setDocumentTitle('Hello World');
    mockTranslateOnce([['Hola Mundo', ' ']]);
    const translator = newTranslator({
      getService: () => 'google',
      getSourceLanguage: () => 'en',
      isPageVisible: () => true,
    });
    await translator.start('es');
    sendMessageMock.mockClear();

    // Let any pending async work from the module's own <title> write settle.
    await flushAsyncWork();

    expect(sendMessageMock).not.toHaveBeenCalled();
  });
});

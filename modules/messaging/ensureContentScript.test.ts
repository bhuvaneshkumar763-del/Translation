import { afterEach, describe, expect, it, vi } from 'vitest';
import { sendEnsuringContentScript } from './ensureContentScript';

function noReceiverError(): Error {
  return new Error('Could not establish connection. Receiving end does not exist.');
}

describe('sendEnsuringContentScript', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('returns the result directly when send() succeeds first try — no injection attempted', async () => {
    const executeScript = vi.fn();
    vi.stubGlobal('browser', { scripting: { executeScript } });
    const send = vi.fn().mockResolvedValue('ok');

    const result = await sendEnsuringContentScript(7, send);

    expect(result).toBe('ok');
    expect(send).toHaveBeenCalledTimes(1);
    expect(executeScript).not.toHaveBeenCalled();
  });

  it('does not attempt injection for a real (non-connection) error, and returns undefined', async () => {
    const executeScript = vi.fn();
    vi.stubGlobal('browser', { scripting: { executeScript } });
    const send = vi.fn().mockRejectedValue(new Error('translation service exploded'));

    const result = await sendEnsuringContentScript(7, send);

    expect(result).toBeUndefined();
    expect(executeScript).not.toHaveBeenCalled();
  });

  it('injects the content script and retries on a no-receiver error, succeeding once the retry connects', async () => {
    vi.useFakeTimers();
    const executeScript = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('browser', { scripting: { executeScript } });

    let call = 0;
    const send = vi.fn().mockImplementation(() => {
      call++;
      if (call <= 2) return Promise.reject(noReceiverError()); // first call + first retry still fail
      return Promise.resolve('translated');
    });

    const resultPromise = sendEnsuringContentScript(42, send);
    // Let the microtask queue + fake timers drain through the retry loop.
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result).toBe('translated');
    expect(executeScript).toHaveBeenCalledTimes(1);
    expect(executeScript).toHaveBeenCalledWith({
      target: { tabId: 42, allFrames: true },
      files: ['/content-scripts/content-main.js'],
    });
    expect(send).toHaveBeenCalledTimes(3); // initial + 1 failed retry + 1 succeeding retry
  });

  it('gives up after 6 retries and returns undefined if the content script never responds', async () => {
    vi.useFakeTimers();
    const executeScript = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('browser', { scripting: { executeScript } });
    const send = vi.fn().mockRejectedValue(noReceiverError());

    const resultPromise = sendEnsuringContentScript(1, send);
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result).toBeUndefined();
    expect(executeScript).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledTimes(7); // initial + 6 retries
  });

  it('returns undefined without retrying if injection itself fails (e.g. a chrome:// tab)', async () => {
    const executeScript = vi.fn().mockRejectedValue(new Error('Cannot access a chrome:// URL'));
    vi.stubGlobal('browser', { scripting: { executeScript } });
    const send = vi.fn().mockRejectedValue(noReceiverError());

    const result = await sendEnsuringContentScript(1, send);

    expect(result).toBeUndefined();
    expect(send).toHaveBeenCalledTimes(1); // only the initial attempt — no retries after a failed injection
  });
});

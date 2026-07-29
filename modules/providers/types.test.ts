import { afterEach, describe, expect, it, vi } from 'vitest';
import { Service, type ServiceSingleResult } from './types';

/** Minimal Service subclass for testing the shared retry/batching machinery without a real provider's prompt/parsing logic getting in the way. */
function makeTestService(name: string, parseResponse: (payload: unknown) => ServiceSingleResult[]) {
  return new (class extends Service {
    constructor() {
      super(name, 'https://example.test/translate', 'POST', {
        cbTransformRequest: (sourceArray) => sourceArray.join('|'),
        cbGetRequestBody: (_sl, _tl, requests) => JSON.stringify(requests.map((r) => r.originalText)),
        cbGetExtraHeaders: () => [{ name: 'Content-Type', value: 'application/json' }],
        cbParseResponse: (response) => parseResponse(response),
        cbTransformResponse: (result) => [result],
      });
    }
  })();
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
}

describe('Service — structural checking + per-piece retry', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('retries only the missing piece when a batch response is short one result, and both end up complete', async () => {
    let callCount = 0;
    const fetchMock = vi.fn(async () => {
      callCount++;
      if (callCount === 1) {
        // Simulates a truncated/malformed batch response: 2 pieces sent, 1 result back.
        return jsonResponse(['translated-a']);
      }
      // The individual retry for the missing piece.
      return jsonResponse(['translated-b']);
    });
    vi.stubGlobal('fetch', fetchMock);

    const service = makeTestService('retry-test', (payload) =>
      (payload as string[]).map((text) => ({ text, detectedLanguage: null })),
    );

    // translate() returns string[][] — one inner array per piece (2 pieces in, 2 out).
    const results = await service.translate('en', 'es', [['a'], ['b']], true);

    expect(results).toEqual([['translated-a'], ['translated-b']]);
    expect(callCount).toBe(2); // 1 batch call + 1 individual retry for the missing piece
  });

  it('marks a piece as an error (empty result) if it still comes back missing on the individual retry', async () => {
    let callCount = 0;
    const fetchMock = vi.fn(async () => {
      callCount++;
      if (callCount === 1) return jsonResponse(['only-one']); // batch: short by one
      return jsonResponse([]); // individual retry for the missing piece: still nothing back
    });
    vi.stubGlobal('fetch', fetchMock);

    const service = makeTestService('retry-fail-test', (payload) =>
      (payload as string[]).map((text) => ({ text, detectedLanguage: null })),
    );

    const results = await service.translate('en', 'es', [['a'], ['b']], true);

    // The first piece succeeds; the second was missing both times and ends
    // up with no translated text (Service falls back to '' for an error'd piece).
    expect(results).toEqual([['only-one'], ['']]);
    expect(callCount).toBe(2);
  });

  it('does not retry when the batch response already has a result for every piece', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(['a-out', 'b-out']));
    vi.stubGlobal('fetch', fetchMock);

    const service = makeTestService('no-retry-test', (payload) =>
      (payload as string[]).map((text) => ({ text, detectedLanguage: null })),
    );

    const results = await service.translate('en', 'es', [['a'], ['b']], true);

    expect(results).toEqual([['a-out'], ['b-out']]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

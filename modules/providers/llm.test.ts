import { afterEach, describe, expect, it, vi } from 'vitest';
import { createLlmService } from './llm';

function openAiResponse(translations: string[]): Response {
  const body = { choices: [{ message: { content: JSON.stringify(translations) } }] };
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
}

describe('createLlmService', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends an OpenAI-compatible chat-completions request with the configured model and Bearer key', async () => {
    const fetchMock = vi.fn(async () => openAiResponse(['hola']));
    vi.stubGlobal('fetch', fetchMock);

    const service = createLlmService('https://api.example.com/v1/chat/completions', 'sk-test-key', 'gpt-4o-mini');
    await service.translate('en', 'es', [['hello']], true);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const call = fetchMock.mock.calls[0];
    if (!call) throw new Error('fetch was not called');
    const [url, init] = call as unknown as [string, RequestInit];
    expect(url).toBe('https://api.example.com/v1/chat/completions');
    const headers = init.headers as Record<string, string>;
    expect(headers.authorization).toBe('Bearer sk-test-key');
    const sentBody = JSON.parse(init.body as string);
    expect(sentBody.model).toBe('gpt-4o-mini');
    expect(sentBody.messages[0].content).toContain('hello');
  });

  it('round-trips a multi-part piece (grouped DOM text nodes) through the separator', async () => {
    // "hello␟world" in, model returns the Spanish translation with the same
    // separator preserved — cbTransformResponse must split it back into 2.
    const fetchMock = vi.fn(async () => openAiResponse(['hola␟mundo']));
    vi.stubGlobal('fetch', fetchMock);

    const service = createLlmService('https://api.example.com/v1/chat/completions', 'key', 'gpt-4o-mini');
    const results = await service.translate('en', 'es', [['hello', 'world']], true);

    expect(results).toEqual([['hola', 'mundo']]);
  });

  it('strips markdown code-fence wrapping the model adds despite instructions not to', async () => {
    const fenced = '```json\n["hola"]\n```';
    const body = { choices: [{ message: { content: fenced } }] };
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const service = createLlmService('https://api.example.com/v1/chat/completions', 'key', 'gpt-4o-mini');
    const results = await service.translate('en', 'es', [['hello']], true);

    expect(results).toEqual([['hola']]);
  });

  it('falls back to an empty result (not a throw) when the model response is not valid JSON', async () => {
    const body = { choices: [{ message: { content: 'sorry, I cannot do that' } }] };
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const service = createLlmService('https://api.example.com/v1/chat/completions', 'key', 'gpt-4o-mini');
    const results = await service.translate('en', 'es', [['hello']], true);

    expect(results).toEqual([['']]);
  });
});

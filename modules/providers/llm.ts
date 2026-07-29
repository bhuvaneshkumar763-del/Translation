import { Service, type ServiceSingleResult } from './types';

/**
 * Provider-agnostic LLM translation engine: OpenAI-compatible chat-
 * completions shape (base URL + API key + model, all user-supplied — same
 * "bring your own key" pattern as `libre.ts`), so it works against OpenAI
 * itself, a local model server, or any compatible gateway.
 *
 * Reuses `Service`'s existing XHR/retry/concurrency/caching machinery
 * (`modules/providers/types.ts`) rather than a bespoke request loop — the
 * callback shape fits an OpenAI-style request/response well enough that a
 * custom implementation (like `deepl.ts`'s live-tab bridge) isn't needed.
 *
 * Piece-joining: a "piece" (one entry of `sourceArray2d`) can contain
 * multiple related strings when `translateLoop.ts` groups sibling DOM text
 * nodes for context (see `descriptors.ts`'s `batchingHint`). Those are
 * joined with UNIT_SEPARATOR below before sending, and split back apart
 * from the response the same way — mirrors what Google/Bing do with HTML
 * `<a i=N>` markers, just simpler since both the prompt and the parser are
 * ours to define instead of reverse-engineering a third-party format.
 */

// U+241F SYMBOL FOR UNIT SEPARATOR — a control-picture character with no
// legitimate reason to appear in translated prose, used to keep multiple
// related strings within one piece addressable after a round trip through
// the model.
const PIECE_PART_SEPARATOR = '␟';

function buildPrompt(sourceLanguage: string, targetLanguage: string, segments: string[]): string {
  const sourceClause = sourceLanguage && sourceLanguage !== 'auto' ? `from ${sourceLanguage} ` : '';
  const numbered = segments.map((s, i) => `[${i}]: ${s}`).join('\n');
  return (
    `Translate the following ${segments.length} numbered text segments ${sourceClause}into ${targetLanguage}. ` +
    `Some segments contain the character ${PIECE_PART_SEPARATOR} separating multiple independent parts — ` +
    `preserve that exact character and the same number of parts in your translation of that segment. ` +
    `Keep whitespace/line-break structure. Do not translate content inside segments that looks like code, ` +
    `a URL, or a placeholder token. Respond with ONLY a JSON array of exactly ${segments.length} strings, ` +
    `one per segment, in the same order — no markdown fencing, no explanation, nothing else.\n\n${numbered}`
  );
}

/** Strips common markdown code-fence wrapping models add despite instructions not to, before JSON.parse. */
function extractJsonArrayText(raw: string): string {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenced?.[1] ?? trimmed;
}

export function createLlmService(baseUrl: string, apiKey: string, model: string): Service {
  return new (class extends Service {
    constructor() {
      super('llm', baseUrl, 'POST', {
        cbTransformRequest: (sourceArray) => sourceArray.join(PIECE_PART_SEPARATOR),

        cbGetRequestBody: (sourceLanguage, targetLanguage, requests) => {
          const segments = requests.map((r) => r.originalText);
          const body = {
            model,
            temperature: 0,
            messages: [
              {
                role: 'user',
                content: buildPrompt(sourceLanguage, targetLanguage, segments),
              },
            ],
          };
          return JSON.stringify(body);
        },

        cbGetExtraHeaders: () => [
          { name: 'Content-Type', value: 'application/json' },
          { name: 'Authorization', value: `Bearer ${apiKey}` },
        ],

        cbParseResponse: (response: { choices?: Array<{ message?: { content?: string } }> }): ServiceSingleResult[] => {
          const content = response.choices?.[0]?.message?.content;
          if (!content) return [];
          let parsed: unknown;
          try {
            parsed = JSON.parse(extractJsonArrayText(content));
          } catch (e) {
            console.error('llm provider: failed to parse model response as JSON', e, content);
            return [];
          }
          if (!Array.isArray(parsed)) return [];
          // Any entry that isn't a string (malformed model output) becomes an
          // empty-string result rather than throwing — Service's existing
          // per-index handling in types.ts already treats a missing/empty
          // result as an error for that specific piece and retries it, so
          // one bad entry doesn't need to fail the whole batch here.
          return parsed.map((text) => ({
            text: typeof text === 'string' ? text : '',
            detectedLanguage: null,
          }));
        },

        cbTransformResponse: (result, _dontSortResults) => result.split(PIECE_PART_SEPARATOR),
      });
    }
  })();
}

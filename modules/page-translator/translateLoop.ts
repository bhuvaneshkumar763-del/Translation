import { sendMessage } from '../messaging/protocol';
import { createDedupeTracker } from './dedupe';
import { createMutationWatcher } from './mutationWatcher';
import { createResweepScheduler } from './resweep';

/**
 * The page-translation engine: collect text nodes, batch-translate them,
 * splice results back in, and keep watching for new/changed content. Ties
 * together dedupe.ts (O(1) identity tracking), mutationWatcher.ts (childList
 * + characterData observation), and resweep.ts (the adaptive backstop) —
 * see those files for what each piece is doing and why.
 *
 * Fidelity note: the old pageTranslator.js groups text into paragraph-level
 * "pieces" spanning multiple DOM nodes (for translation context and fewer
 * requests) and separately translates attributes (placeholder/title/alt/
 * aria-label) and the custom dictionary. This port works on individual Text
 * nodes only, with no attribute/dictionary translation yet — a deliberate
 * phase-2 scope cut (every text node still gets found and translated
 * correctly; it's a quality/efficiency gap, not a correctness one), not
 * something to silently forget about for a later pass.
 */

const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA']);
const MAX_PIECES_PER_TICK = 100;
const HAS_LETTER = /\p{L}/u;

export type PageLanguageState = 'original' | 'translated';

export interface PageTranslatorOptions {
  getService(): string;
  getSourceLanguage(): string;
  getDontSortResults(): boolean;
}

export function createPageTranslator(options: PageTranslatorOptions) {
  const dedupe = createDedupeTracker();

  let pageLanguageState: PageLanguageState = 'original';
  let queue: Text[] = [];
  let nodesToRestore: Array<{ node: Text; original: string }> = [];
  let currentTargetLanguage = '';
  let translationRoutineHandle: ReturnType<typeof setTimeout> | null = null;

  const requeueAt = new WeakMap<Text, number>();
  const missingResultAttempts = new WeakMap<Text, number>();

  const stateListeners = new Set<(state: PageLanguageState) => void>();

  function isNoTranslateNode(node: Node): boolean {
    if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as Element;
      if (SKIP_TAGS.has(el.tagName)) return true;
      if ((el as HTMLElement).isContentEditable) return true;
    }
    return false;
  }

  function collectTextNodes(root: Node): Text[] {
    const nodes: Text[] = [];
    const walk = (node: Node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        if (node.textContent && node.textContent.trim() && !isNoTranslateNode(node.parentNode!)) {
          nodes.push(node as Text);
        }
        return;
      }
      if (isNoTranslateNode(node)) return;
      node.childNodes.forEach(walk);
    };
    walk(root);
    return nodes;
  }

  function wakeRoutine(delayMs = 0): void {
    if (translationRoutineHandle) clearTimeout(translationRoutineHandle);
    translationRoutineHandle = setTimeout(translationRoutine, delayMs);
  }

  function queueNode(node: Text): boolean {
    if (dedupe.isTracked(node)) return false;
    dedupe.track([node]);
    queue.push(node);
    // Nodes discovered after the initial translatePage() sweep (new DOM from
    // the mutation watcher/resweep) need their pre-translation text recorded
    // too, or restorePage() silently leaves them translated forever — the
    // initial batch records this in bulk in translatePage() itself, this
    // covers everything found afterwards.
    nodesToRestore.push({ node, original: node.data });
    return true;
  }

  function requeueChangedTextNode(node: Text): void {
    requeueAt.set(node, Date.now());
    dedupe.track([node]);
    queue.push(node);
    wakeRoutine();
  }

  function noteMissingResult(node: Text): void {
    if (!node.isConnected) return;
    const text = (node.textContent ?? '').trim();
    if (!text || !HAS_LETTER.test(text)) return;
    const last = requeueAt.get(node);
    if (last !== undefined && Date.now() - last < 1500) return;
    const attempts = (missingResultAttempts.get(node) ?? 0) + 1;
    if (attempts > 3) return; // give up after 3 tries — a genuinely untranslatable fragment
    missingResultAttempts.set(node, attempts);
    requeueChangedTextNode(node);
  }

  async function translationRoutine(): Promise<void> {
    if (translationRoutineHandle) clearTimeout(translationRoutineHandle);

    if (pageLanguageState === 'translated' && queue.length > 0) {
      const batch = queue.splice(0, MAX_PIECES_PER_TICK);
      try {
        const results = await sendMessage('translateHTML', {
          translationService: options.getService(),
          sourceLanguage: options.getSourceLanguage(),
          targetLanguage: currentTargetLanguage,
          sourceArray2d: batch.map((node) => [node.data]),
          dontSortResults: options.getDontSortResults(),
        });
        batch.forEach((node, idx) => {
          if (!node.isConnected) return;
          const translated = results[idx]?.[0];
          if (translated) {
            mutationWatcher.noteOwnWrite(node, translated);
            node.data = translated;
          } else {
            noteMissingResult(node);
          }
        });
      } catch (e) {
        console.error(e);
        // Transient failure (network blip, background restart) — retry next tick.
        queue.unshift(...batch.filter((n) => n.isConnected));
      }
    }

    const nextDelay = queue.length > 0 ? 150 : 2000;
    translationRoutineHandle = setTimeout(translationRoutine, nextDelay);
  }

  const mutationWatcher = createMutationWatcher({
    isTranslated: () => pageLanguageState === 'translated',
    isNoTranslateNode,
    onNewRoot(root) {
      const added = collectTextNodes(root).filter((n) => queueNode(n)).length;
      if (added > 0) wakeRoutine();
    },
    onChangedTextNode(node) {
      requeueChangedTextNode(node);
    },
  });

  const resweep = createResweepScheduler({
    isTranslated: () => pageLanguageState === 'translated',
    isPageVisible: () => document.visibilityState === 'visible',
    onResweep() {
      const added = collectTextNodes(document.body).filter((n) => queueNode(n)).length;
      if (added > 0) wakeRoutine();
      return added > 0;
    },
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && pageLanguageState === 'translated') {
      mutationWatcher.enable(500, () => resweep.bump());
      resweep.bump();
    } else if (document.visibilityState !== 'visible') {
      mutationWatcher.disable();
    }
  });

  function setState(next: PageLanguageState): void {
    pageLanguageState = next;
    stateListeners.forEach((cb) => cb(next));
  }

  async function translatePage(targetLanguage: string): Promise<void> {
    // Ported from the old pageTranslator.translatePage: always restore first,
    // so re-translating (new target language, new service, new source
    // language) while already translated collects the true original text
    // instead of mistaking the current translation for it.
    if (pageLanguageState === 'translated') {
      restorePage();
    }

    currentTargetLanguage = targetLanguage;

    const nodes = collectTextNodes(document.body);
    nodesToRestore = nodes.map((node) => ({ node, original: node.data }));
    dedupe.reset();
    dedupe.track(nodes);
    queue = [...nodes];

    setState('translated');
    mutationWatcher.enable(500, () => resweep.bump());
    resweep.start();
    wakeRoutine();
  }

  function restorePage(): void {
    nodesToRestore.forEach(({ node, original }) => {
      if (node.isConnected && node.data !== original) {
        mutationWatcher.noteOwnWrite(node, original);
        node.data = original;
      }
    });
    nodesToRestore = [];
    queue = [];
    if (translationRoutineHandle) clearTimeout(translationRoutineHandle);
    translationRoutineHandle = null;
    mutationWatcher.disable();
    resweep.stop();
    setState('original');
  }

  return {
    translatePage,
    restorePage,
    getState: () => pageLanguageState,
    onStateChange(cb: (state: PageLanguageState) => void): () => void {
      stateListeners.add(cb);
      return () => stateListeners.delete(cb);
    },
    /** Currently-translated text nodes and their pre-translation text — used by the "hover to see original" tooltip. */
    getTranslatedNodes: (): ReadonlyArray<{ node: Text; original: string }> => nodesToRestore,
  };
}

export type PageTranslator = ReturnType<typeof createPageTranslator>;

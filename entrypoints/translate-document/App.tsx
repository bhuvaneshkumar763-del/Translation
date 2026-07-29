import { onMount, createSignal, Show } from 'solid-js';
import { twpConfig } from '@/modules/config/store';
import './App.css';

/**
 * Standalone "translate a document" window, ported from
 * popup/popup-translate-document.js + popup-translate-document.html —
 * scoped down to the general third-party document-translation services
 * (Google Translate's document upload, DeepL's file translator,
 * OnlineDocTranslator). The old version's other two options
 * (pdf.translatewebpages.org and pdftohtml.translatewebpages.org, plus the
 * download-and-repost flow built around them) are the upstream project's
 * own hosted services, not general functionality — same reasoning as the
 * PDF-related context-menu item and auto-translate carve-outs dropped in
 * earlier phases of this rewrite.
 */

interface DocService {
  name: string;
  url(targetLanguage: string): string;
}

const SERVICES: DocService[] = [
  { name: 'Google Translate', url: (tl) => `https://translate.google.com/?sl=auto&tl=${tl}&op=docs` },
  { name: 'DeepL', url: () => 'https://www.deepl.com/translator/files' },
  { name: 'OnlineDocTranslator', url: () => 'https://www.onlinedoctranslator.com/translationform' },
];

function App() {
  const [ready, setReady] = createSignal(false);

  onMount(async () => {
    await twpConfig.onReady();
    setReady(true);
  });

  function openService(service: DocService): void {
    const targetLanguage = twpConfig.get('targetLanguage') ?? 'en';
    window.open(service.url(targetLanguage), '_blank');
    window.close();
  }

  return (
    <Show when={ready()} fallback={<div class="loading">Loading…</div>}>
      <div class="page">
        <div class="title">Translate a document</div>
        <div class="hint">Choose a service to upload your document to for translation.</div>
        <div class="list">
          {SERVICES.map((service) => (
            <button class="serviceBtn" on:click={() => openService(service)}>
              {service.name}
            </button>
          ))}
        </div>
      </div>
    </Show>
  );
}

export default App;

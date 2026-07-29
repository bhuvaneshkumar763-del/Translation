import { createSignal, For, onMount, Show } from 'solid-js';
import { twpConfig } from '@/modules/config/store';
import { uiLanguages, codeToLanguage, fixTLanguageCode } from '@/modules/languages';
import type { Config } from '@/modules/config/schema';

/**
 * The options page, ported from options/options.js + options.html.
 * Deliberately scoped down from the ~1550-line original to the settings
 * that are actually wired up to real behavior in this rewrite so far —
 * exposing a toggle for something that doesn't do anything yet would be
 * worse than not having it. No w3.css (hand-rolled instead, same call as
 * the rest of this rewrite); no dedicated "release notes"/donation
 * sections, since those are upstream-project-specific, not functional
 * settings.
 */

function effectiveUiLanguage(): string {
  const configured = twpConfig.get('uiLanguage');
  return configured !== 'default' ? configured : browser.i18n.getUILanguage();
}

function Section(props: { title: string; children: unknown }) {
  return (
    <section class="section">
      <h2>{props.title}</h2>
      <div class="sectionBody">{props.children as never}</div>
    </section>
  );
}

function StringListEditor(props: {
  values: string[];
  onAdd(value: string): void;
  onRemove(value: string): void;
  formatLabel?(value: string): string;
  placeholder?: string;
}) {
  const [input, setInput] = createSignal('');
  function add(): void {
    const value = input().trim();
    if (!value) return;
    props.onAdd(value);
    setInput('');
  }
  return (
    <div class="listEditor">
      <div class="listRow addRow">
        <input
          type="text"
          value={input()}
          placeholder={props.placeholder ?? 'value'}
          on:input={(e) => setInput((e.currentTarget as HTMLInputElement).value)}
          on:keydown={(e) => {
            if (e.key === 'Enter') add();
          }}
        />
        <button on:click={add}>Add</button>
      </div>
      <For each={props.values}>
        {(value) => (
          <div class="listRow">
            <span>{props.formatLabel ? props.formatLabel(value) : value}</span>
            <button class="removeBtn" on:click={() => props.onRemove(value)}>
              ✕
            </button>
          </div>
        )}
      </For>
      <Show when={props.values.length === 0}>
        <div class="emptyHint">None</div>
      </Show>
    </div>
  );
}

function App() {
  const [ready, setReady] = createSignal(false);
  const [, forceUpdate] = createSignal(0);
  function bump(): void {
    forceUpdate((n) => n + 1);
  }

  onMount(async () => {
    await twpConfig.onReady();
    setReady(true);
    twpConfig.onChanged(() => bump());
  });

  async function set<K extends keyof Config>(name: K, value: Config[K]): Promise<void> {
    await twpConfig.set(name, value);
    bump();
  }

  function addInArray(name: keyof Pick<Config, 'alwaysTranslateSites' | 'neverTranslateSites' | 'alwaysTranslateLangs' | 'neverTranslateLangs' | 'sitesToTranslateWhenHovering' | 'langsToTranslateWhenHovering'>, value: string): void {
    const current = twpConfig.get(name) as string[];
    if (!current.includes(value)) void set(name, [...current, value] as never);
  }
  function removeFromArray(name: keyof Pick<Config, 'alwaysTranslateSites' | 'neverTranslateSites' | 'alwaysTranslateLangs' | 'neverTranslateLangs' | 'sitesToTranslateWhenHovering' | 'langsToTranslateWhenHovering'>, value: string): void {
    const current = twpConfig.get(name) as string[];
    void set(name, current.filter((v) => v !== value) as never);
  }

  function addTargetLanguage(code: string): void {
    const fixed = fixTLanguageCode(code);
    if (!fixed) return;
    const current = twpConfig.get('targetLanguages');
    if (!current.includes(fixed)) void set('targetLanguages', [fixed, ...current].slice(0, 10));
  }
  function removeTargetLanguage(code: string): void {
    void set('targetLanguages', twpConfig.get('targetLanguages').filter((c) => c !== code));
  }

  function addCustomDictEntry(key: string, value: string): void {
    if (!key || !value) return;
    void twpConfig.addKeyWordToCustomDictionary(key, value).then(bump);
  }
  function removeCustomDictEntry(key: string): void {
    void twpConfig.removeKeyWordFromCustomDictionary(key).then(bump);
  }

  const [dictKey, setDictKey] = createSignal('');
  const [dictValue, setDictValue] = createSignal('');

  const [libreUrl, setLibreUrl] = createSignal('');
  const [libreKey, setLibreKey] = createSignal('');
  const [deeplKey, setDeeplKey] = createSignal('');
  const [googleProxy, setGoogleProxy] = createSignal('');

  onMount(() => {
    const libre = twpConfig.get('customServices').find((cs) => cs.name === 'libre');
    if (libre && 'url' in libre) {
      setLibreUrl(libre.url);
      setLibreKey(libre.apiKey);
    }
    const deepl = twpConfig.get('customServices').find((cs) => cs.name === 'deepl_freeapi');
    if (deepl) setDeeplKey(deepl.apiKey);
    setGoogleProxy(twpConfig.get('proxyServers')?.google?.translateServer ?? '');
  });

  function saveLibre(): void {
    const others = twpConfig.get('customServices').filter((cs) => cs.name !== 'libre');
    const next = libreUrl().trim()
      ? [...others, { name: 'libre' as const, url: libreUrl().trim(), apiKey: libreKey().trim() }]
      : others;
    void set('customServices', next);
  }
  function saveDeepl(): void {
    const others = twpConfig.get('customServices').filter((cs) => cs.name !== 'deepl_freeapi');
    const next = deeplKey().trim() ? [...others, { name: 'deepl_freeapi' as const, apiKey: deeplKey().trim() }] : others;
    void set('customServices', next);
  }
  function saveGoogleProxy(): void {
    const proxyServers = { ...twpConfig.get('proxyServers') };
    proxyServers.google = { ...proxyServers.google, translateServer: googleProxy().trim() || undefined };
    void set('proxyServers', proxyServers);
  }

  async function exportConfig(): Promise<void> {
    const json = await twpConfig.export();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'twp-config.json';
    a.click();
    URL.revokeObjectURL(url);
  }
  function importConfig(e: Event): void {
    const file = (e.currentTarget as HTMLInputElement).files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => void twpConfig.import(String(reader.result));
    reader.readAsText(file);
  }
  function restoreDefaults(): void {
    if (confirm('Reset all settings to their defaults? This reloads the extension.')) {
      void twpConfig.restoreToDefault();
    }
  }

  return (
    <Show when={ready()} fallback={<div class="loading">Loading…</div>}>
      <div class="page">
        <h1>TWP · FullPage — Options</h1>

        <Section title="General">
          <label class="row">
            <span>Interface language</span>
            <select value={twpConfig.get('uiLanguage')} on:change={(e) => void set('uiLanguage', (e.currentTarget as HTMLSelectElement).value)}>
              <option value="default">Match browser</option>
              <For each={uiLanguages}>{(code) => <option value={code}>{codeToLanguage(code, code)}</option>}</For>
            </select>
          </label>
          <label class="row">
            <span>Dark mode</span>
            <select value={twpConfig.get('darkMode')} on:change={(e) => void set('darkMode', (e.currentTarget as HTMLSelectElement).value as Config['darkMode'])}>
              <option value="auto">Match system</option>
              <option value="yes">Always on</option>
              <option value="no">Always off</option>
            </select>
          </label>
          <div class="fieldGroup">
            <span>Preferred target languages (most recent first, up to 10)</span>
            <StringListEditor
              values={twpConfig.get('targetLanguages')}
              formatLabel={(c) => codeToLanguage(c, effectiveUiLanguage())}
              placeholder="language code, e.g. es"
              onAdd={addTargetLanguage}
              onRemove={removeTargetLanguage}
            />
          </div>
        </Section>

        <Section title="Page translation">
          <label class="row">
            <span>Service</span>
            <select
              value={twpConfig.get('pageTranslatorService')}
              on:change={(e) => void set('pageTranslatorService', (e.currentTarget as HTMLSelectElement).value as Config['pageTranslatorService'])}
            >
              <option value="google">Google</option>
              <option value="bing">Bing</option>
              <option value="yandex">Yandex</option>
            </select>
          </label>
          <div class="fieldGroup">
            <span>Enabled services</span>
            <For each={['google', 'bing', 'yandex', 'deepl'] as const}>
              {(s) => (
                <label class="check">
                  <input
                    type="checkbox"
                    checked={twpConfig.get('enabledServices').includes(s)}
                    on:change={() => {
                      const current = twpConfig.get('enabledServices');
                      void set('enabledServices', current.includes(s) ? current.filter((x) => x !== s) : [...current, s]);
                    }}
                  />
                  {s}
                </label>
              )}
            </For>
          </div>
          <div class="fieldGroup">
            <span>Always translate these sites</span>
            <StringListEditor
              values={twpConfig.get('alwaysTranslateSites')}
              placeholder="example.com"
              onAdd={(v) => addInArray('alwaysTranslateSites', v)}
              onRemove={(v) => removeFromArray('alwaysTranslateSites', v)}
            />
          </div>
          <div class="fieldGroup">
            <span>Never translate these sites</span>
            <StringListEditor
              values={twpConfig.get('neverTranslateSites')}
              placeholder="example.com"
              onAdd={(v) => addInArray('neverTranslateSites', v)}
              onRemove={(v) => removeFromArray('neverTranslateSites', v)}
            />
          </div>
          <div class="fieldGroup">
            <span>Always translate these languages</span>
            <StringListEditor
              values={twpConfig.get('alwaysTranslateLangs')}
              formatLabel={(c) => codeToLanguage(c, effectiveUiLanguage())}
              placeholder="language code, e.g. fr"
              onAdd={(v) => addInArray('alwaysTranslateLangs', fixTLanguageCode(v) ?? v)}
              onRemove={(v) => removeFromArray('alwaysTranslateLangs', v)}
            />
          </div>
          <div class="fieldGroup">
            <span>Never translate these languages</span>
            <StringListEditor
              values={twpConfig.get('neverTranslateLangs')}
              formatLabel={(c) => codeToLanguage(c, effectiveUiLanguage())}
              placeholder="language code, e.g. en"
              onAdd={(v) => addInArray('neverTranslateLangs', fixTLanguageCode(v) ?? v)}
              onRemove={(v) => removeFromArray('neverTranslateLangs', v)}
            />
          </div>
        </Section>

        <Section title="Selected-text translation">
          <label class="row">
            <span>Service</span>
            <select
              value={twpConfig.get('textTranslatorService')}
              on:change={(e) => void set('textTranslatorService', (e.currentTarget as HTMLSelectElement).value as Config['textTranslatorService'])}
            >
              <option value="google">Google</option>
              <option value="bing">Bing</option>
              <option value="yandex">Yandex</option>
              <option value="deepl">DeepL</option>
              <option value="libre">LibreTranslate</option>
            </select>
          </label>
          <label class="check">
            <input
              type="checkbox"
              checked={twpConfig.get('showTranslateSelectedButton') === 'yes'}
              on:change={(e) => void set('showTranslateSelectedButton', (e.currentTarget as HTMLInputElement).checked ? 'yes' : 'no')}
            />
            Show a button to translate selected text
          </label>
          <label class="check">
            <input
              type="checkbox"
              checked={twpConfig.get('translateSelectedWhenPressTwice') === 'yes'}
              on:change={(e) => void set('translateSelectedWhenPressTwice', (e.currentTarget as HTMLInputElement).checked ? 'yes' : 'no')}
            />
            Translate selected text by pressing Ctrl twice
          </label>
          <label class="check">
            <input
              type="checkbox"
              checked={twpConfig.get('translateTextOverMouseWhenPressTwice') === 'yes'}
              on:change={(e) => void set('translateTextOverMouseWhenPressTwice', (e.currentTarget as HTMLInputElement).checked ? 'yes' : 'no')}
            />
            Translate text under the cursor by pressing Ctrl twice
          </label>
        </Section>

        <Section title="Hover translation">
          <label class="check">
            <input
              type="checkbox"
              checked={twpConfig.get('showOriginalTextWhenHovering') === 'yes'}
              on:change={(e) => void set('showOriginalTextWhenHovering', (e.currentTarget as HTMLInputElement).checked ? 'yes' : 'no')}
            />
            Show original text when hovering over translated text
          </label>
          <div class="fieldGroup">
            <span>Show translations when hovering on these sites</span>
            <StringListEditor
              values={twpConfig.get('sitesToTranslateWhenHovering')}
              placeholder="example.com"
              onAdd={(v) => addInArray('sitesToTranslateWhenHovering', v)}
              onRemove={(v) => removeFromArray('sitesToTranslateWhenHovering', v)}
            />
          </div>
          <div class="fieldGroup">
            <span>Show translations when hovering on pages in these languages</span>
            <StringListEditor
              values={twpConfig.get('langsToTranslateWhenHovering')}
              formatLabel={(c) => codeToLanguage(c, effectiveUiLanguage())}
              placeholder="language code"
              onAdd={(v) => addInArray('langsToTranslateWhenHovering', fixTLanguageCode(v) ?? v)}
              onRemove={(v) => removeFromArray('langsToTranslateWhenHovering', v)}
            />
          </div>
        </Section>

        <Section title="Floating bubble">
          <label class="check">
            <input
              type="checkbox"
              checked={twpConfig.get('fpShowFloatingBubble') === 'yes'}
              on:change={(e) => void set('fpShowFloatingBubble', (e.currentTarget as HTMLInputElement).checked ? 'yes' : 'no')}
            />
            Show the floating translate bubble by default
          </label>
          <div class="fieldGroup">
            <span>Per-site overrides</span>
            <For each={Object.entries(twpConfig.get('fpBubbleByHost'))}>
              {([host, value]) => (
                <div class="listRow">
                  <span>
                    {host}: {value === 'no' ? 'hidden' : 'shown'}
                  </span>
                  <button
                    class="removeBtn"
                    on:click={() => {
                      const map = { ...twpConfig.get('fpBubbleByHost') };
                      delete map[host];
                      void set('fpBubbleByHost', map);
                    }}
                  >
                    ✕
                  </button>
                </div>
              )}
            </For>
            <Show when={Object.keys(twpConfig.get('fpBubbleByHost')).length === 0}>
              <div class="emptyHint">None</div>
            </Show>
          </div>
        </Section>

        <Section title="Text-to-speech">
          <label class="row">
            <span>Service</span>
            <select
              value={twpConfig.get('textToSpeechService')}
              on:change={(e) => void set('textToSpeechService', (e.currentTarget as HTMLSelectElement).value as Config['textToSpeechService'])}
            >
              <option value="google">Google</option>
              <option value="bing">Bing</option>
            </select>
          </label>
          <label class="row">
            <span>Speed ({twpConfig.get('ttsSpeed')})</span>
            <input
              type="range"
              min="0.5"
              max="2"
              step="0.1"
              value={twpConfig.get('ttsSpeed')}
              on:input={(e) => void set('ttsSpeed', Number((e.currentTarget as HTMLInputElement).value))}
            />
          </label>
          <label class="row">
            <span>Volume ({twpConfig.get('ttsVolume')})</span>
            <input
              type="range"
              min="0"
              max="1"
              step="0.1"
              value={twpConfig.get('ttsVolume')}
              on:input={(e) => void set('ttsVolume', Number((e.currentTarget as HTMLInputElement).value))}
            />
          </label>
        </Section>

        <Section title="Custom dictionary">
          <div class="listRow addRow">
            <input type="text" placeholder="word" value={dictKey()} on:input={(e) => setDictKey((e.currentTarget as HTMLInputElement).value)} />
            <input
              type="text"
              placeholder="replacement"
              value={dictValue()}
              on:input={(e) => setDictValue((e.currentTarget as HTMLInputElement).value)}
            />
            <button
              on:click={() => {
                addCustomDictEntry(dictKey().trim(), dictValue().trim());
                setDictKey('');
                setDictValue('');
              }}
            >
              Add
            </button>
          </div>
          <For each={Object.entries(twpConfig.get('customDictionary'))}>
            {([key, value]) => (
              <div class="listRow">
                <span>
                  {key} → {value}
                </span>
                <button class="removeBtn" on:click={() => removeCustomDictEntry(key)}>
                  ✕
                </button>
              </div>
            )}
          </For>
          <Show when={Object.keys(twpConfig.get('customDictionary')).length === 0}>
            <div class="emptyHint">None</div>
          </Show>
        </Section>

        <Section title="Translation services (advanced)">
          <div class="fieldGroup">
            <span>LibreTranslate (self-hosted)</span>
            <div class="row">
              <input type="text" placeholder="Server URL" value={libreUrl()} on:input={(e) => setLibreUrl((e.currentTarget as HTMLInputElement).value)} />
              <input type="text" placeholder="API key (optional)" value={libreKey()} on:input={(e) => setLibreKey((e.currentTarget as HTMLInputElement).value)} />
              <button on:click={saveLibre}>Save</button>
            </div>
          </div>
          <div class="fieldGroup">
            <span>DeepL API (free tier key)</span>
            <div class="row">
              <input type="text" placeholder="API key" value={deeplKey()} on:input={(e) => setDeeplKey((e.currentTarget as HTMLInputElement).value)} />
              <button on:click={saveDeepl}>Save</button>
            </div>
          </div>
          <div class="fieldGroup">
            <span>Google translate proxy host (advanced)</span>
            <div class="row">
              <input
                type="text"
                placeholder="translate-pa.googleapis.com"
                value={googleProxy()}
                on:input={(e) => setGoogleProxy((e.currentTarget as HTMLInputElement).value)}
              />
              <button on:click={saveGoogleProxy}>Save</button>
            </div>
          </div>
        </Section>

        <Section title="Backup">
          <div class="row">
            <button on:click={exportConfig}>Export settings</button>
            <label class="fileBtn">
              Import settings
              <input type="file" accept="application/json" on:change={importConfig} style={{ display: 'none' }} />
            </label>
            <button class="dangerBtn" on:click={restoreDefaults}>
              Restore defaults
            </button>
          </div>
        </Section>
      </div>
    </Show>
  );
}

export default App;

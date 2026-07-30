import { createSignal, For, onMount, Show } from 'solid-js';
import { createStore } from 'solid-js/store';
import { type Config, type ConfigKey, defaultConfig } from '@/modules/config/schema';
import { twpConfig } from '@/modules/config/store';
import { codeToLanguage, fixTLanguageCode, getLanguageList, uiLanguages } from '@/modules/languages';
import { sendMessage } from '@/modules/messaging/protocol';
import { isProviderAvailable } from '@/modules/providers/descriptors';

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

function effectiveUiLanguage(uiLanguage: string): string {
  return uiLanguage !== 'default' ? uiLanguage : browser.i18n.getUILanguage();
}

/** Sorted [code, displayName] pairs for a language-picker <select>, per user request — free-text ISO codes ("fr", "pt-BR") aren't friendly for anyone who doesn't already know them. */
function languageOptions(uiLanguage: string): Array<[string, string]> {
  return Object.entries(getLanguageList(effectiveUiLanguage(uiLanguage))).sort((a, b) => a[1].localeCompare(b[1]));
}

function Section(props: { title: string; children: unknown }) {
  return (
    <section class="section">
      <h2>{props.title}</h2>
      <div class="sectionBody">{props.children as never}</div>
    </section>
  );
}

/**
 * Gen 2 Session 3: the options page moved from one long scroll (10 sections)
 * to a tabbed layout — same `<Section>`s, just grouped and shown one group
 * at a time. Tabs use the ARIA APG "automatic activation" pattern: arrow
 * keys move focus AND selection together (not just focus, which would need
 * a separate activation key) — Home/End jump to the first/last tab.
 */
const TABS = [
  { id: 'general', label: 'General' },
  { id: 'page', label: 'Page' },
  { id: 'selection', label: 'Selection & hover' },
  { id: 'voice', label: 'Voice' },
  { id: 'dictionary', label: 'Dictionary' },
  { id: 'advanced', label: 'Advanced' },
] as const;
type TabId = (typeof TABS)[number]['id'];

function TabSwitcher(props: { active: TabId; onChange: (id: TabId) => void }) {
  const tabRefs = new Map<TabId, HTMLButtonElement>();

  function onKeydown(e: KeyboardEvent, index: number): void {
    let nextIndex: number;
    if (e.key === 'ArrowRight') nextIndex = (index + 1) % TABS.length;
    else if (e.key === 'ArrowLeft') nextIndex = (index - 1 + TABS.length) % TABS.length;
    else if (e.key === 'Home') nextIndex = 0;
    else if (e.key === 'End') nextIndex = TABS.length - 1;
    else return;
    e.preventDefault();
    const next = TABS[nextIndex];
    if (!next) return;
    props.onChange(next.id);
    tabRefs.get(next.id)?.focus();
  }

  return (
    <div class="tabList" role="tablist" aria-label="Settings sections">
      <For each={TABS}>
        {(tab, i) => (
          <button
            type="button"
            ref={(el) => tabRefs.set(tab.id, el)}
            role="tab"
            id={`tab-${tab.id}`}
            aria-selected={props.active === tab.id}
            aria-controls={`panel-${tab.id}`}
            tabindex={props.active === tab.id ? 0 : -1}
            class="tabBtn"
            classList={{ active: props.active === tab.id }}
            on:click={() => props.onChange(tab.id)}
            on:keydown={(e) => onKeydown(e, i())}
          >
            {tab.label}
          </button>
        )}
      </For>
    </div>
  );
}

function TabPanel(props: { id: TabId; active: TabId; children: unknown }) {
  return (
    <div
      id={`panel-${props.id}`}
      role="tabpanel"
      aria-labelledby={`tab-${props.id}`}
      tabindex="0"
      hidden={props.active !== props.id}
    >
      {props.children as never}
    </div>
  );
}

function StringListEditor(props: {
  values: string[];
  onAdd(value: string): void;
  onRemove(value: string): void;
  formatLabel?(value: string): string;
  placeholder?: string;
  // When provided, the add control is a <select> of these code/label pairs
  // instead of a free-text <input> — used for language pickers, where
  // free-text (raw ISO codes like "fr"/"pt-BR") is unfriendly for anyone
  // who doesn't already know the code. Site-hostname lists keep the
  // free-text input, since hostnames aren't from a fixed set.
  languageOptions?: Array<[code: string, label: string]>;
}) {
  const [input, setInput] = createSignal('');
  function add(value?: string): void {
    const v = (value ?? input()).trim();
    if (!v) return;
    props.onAdd(v);
    setInput('');
  }
  return (
    <div class="listEditor">
      <div class="listRow addRow">
        <Show
          when={props.languageOptions}
          fallback={
            <input
              type="text"
              value={input()}
              placeholder={props.placeholder ?? 'value'}
              on:input={(e) => setInput((e.currentTarget as HTMLInputElement).value)}
              on:keydown={(e) => {
                if (e.key === 'Enter') add();
              }}
            />
          }
        >
          <select value={input()} on:change={(e) => setInput((e.currentTarget as HTMLSelectElement).value)}>
            <option value="" disabled>
              Choose a language…
            </option>
            <For each={props.languageOptions}>{([code, label]) => <option value={code}>{label}</option>}</For>
          </select>
        </Show>
        <button on:click={() => add()}>Add</button>
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
  const [activeTab, setActiveTab] = createSignal<TabId>('general');

  // `cfg` is a genuine Solid store mirroring twpConfig's state — every JSX
  // read below goes through this, not twpConfig.get() directly. Reading
  // twpConfig.get() straight from JSX is NOT reactive: it's a plain mutable
  // object property, not a Solid signal/store, so Solid has nothing to
  // subscribe to and the expression only ever evaluates once, at mount.
  // This file previously "solved" that with a bump()/forceUpdate() counter
  // whose signal *getter* was destructured away and never read anywhere —
  // meaning bump() updated a signal with zero subscribers, a complete no-op
  // for rendering. The result: adding/removing a site or language in any
  // of the list editors below correctly persisted to storage (confirmed via
  // a real Playwright check: the item was there after a full page reload)
  // but never appeared or disappeared on screen until the page was
  // reloaded — a real, user-reported regression, not a hypothetical one.
  const [cfg, setCfg] = createStore<Config>({ ...defaultConfig });

  onMount(async () => {
    await twpConfig.onReady();
    setCfg(Object.fromEntries((Object.keys(defaultConfig) as ConfigKey[]).map((k) => [k, twpConfig.get(k)])) as Config);
    setReady(true);
    // Covers changes from OTHER contexts (another tab/window). This file's
    // own writes below also call setCfg directly for an immediate update,
    // since the storage.onChanged round trip this listener relies on isn't
    // guaranteed to resolve before this file's own set() promise does.
    twpConfig.onChanged((name, value) => setCfg(name, value as never));
  });

  async function set<K extends keyof Config>(name: K, value: Config[K]): Promise<void> {
    await twpConfig.set(name, value);
    setCfg(name, value as never);
  }

  function addInArray(
    name: keyof Pick<
      Config,
      | 'alwaysTranslateSites'
      | 'neverTranslateSites'
      | 'alwaysTranslateLangs'
      | 'neverTranslateLangs'
      | 'sitesToTranslateWhenHovering'
      | 'langsToTranslateWhenHovering'
    >,
    value: string,
  ): void {
    const current = twpConfig.get(name) as string[];
    if (!current.includes(value)) void set(name, [...current, value] as never);
  }
  function removeFromArray(
    name: keyof Pick<
      Config,
      | 'alwaysTranslateSites'
      | 'neverTranslateSites'
      | 'alwaysTranslateLangs'
      | 'neverTranslateLangs'
      | 'sitesToTranslateWhenHovering'
      | 'langsToTranslateWhenHovering'
    >,
    value: string,
  ): void {
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
    void set(
      'targetLanguages',
      twpConfig.get('targetLanguages').filter((c) => c !== code),
    );
  }

  function addCustomDictEntry(key: string, value: string): void {
    if (!key || !value) return;
    void twpConfig
      .addKeyWordToCustomDictionary(key, value)
      .then(() => setCfg('customDictionary', twpConfig.get('customDictionary')));
  }
  function removeCustomDictEntry(key: string): void {
    void twpConfig
      .removeKeyWordFromCustomDictionary(key)
      .then(() => setCfg('customDictionary', twpConfig.get('customDictionary')));
  }

  const [dictKey, setDictKey] = createSignal('');
  const [dictValue, setDictValue] = createSignal('');

  const [libreUrl, setLibreUrl] = createSignal('');
  const [libreKey, setLibreKey] = createSignal('');
  const [deeplKey, setDeeplKey] = createSignal('');
  const [googleProxy, setGoogleProxy] = createSignal('');
  const [llmBaseUrl, setLlmBaseUrl] = createSignal('');
  const [llmApiKey, setLlmApiKey] = createSignal('');
  const [llmModel, setLlmModel] = createSignal('');

  onMount(() => {
    const libre = twpConfig.get('customServices').find((cs) => cs.name === 'libre');
    if (libre && 'url' in libre) {
      setLibreUrl(libre.url);
      setLibreKey(libre.apiKey);
    }
    const deepl = twpConfig.get('customServices').find((cs) => cs.name === 'deepl_freeapi');
    if (deepl) setDeeplKey(deepl.apiKey);
    const llm = twpConfig.get('customServices').find((cs) => cs.name === 'llm');
    if (llm && 'baseUrl' in llm) {
      setLlmBaseUrl(llm.baseUrl);
      setLlmApiKey(llm.apiKey);
      setLlmModel(llm.model);
    }
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
    const next = deeplKey().trim()
      ? [...others, { name: 'deepl_freeapi' as const, apiKey: deeplKey().trim() }]
      : others;
    void set('customServices', next);
  }
  function saveLlm(): void {
    const others = twpConfig.get('customServices').filter((cs) => cs.name !== 'llm');
    const next =
      llmBaseUrl().trim() && llmModel().trim()
        ? [
            ...others,
            {
              name: 'llm' as const,
              baseUrl: llmBaseUrl().trim(),
              apiKey: llmApiKey().trim(),
              model: llmModel().trim(),
            },
          ]
        : others;
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

  const [cacheSize, setCacheSize] = createSignal<string | null>(null);
  function refreshCacheSize(): void {
    setCacheSize('Calculating…');
    void sendMessage('getCacheSize', undefined).then(setCacheSize);
  }
  function clearCache(): void {
    if (!confirm('Delete all cached translations?')) return;
    void sendMessage('deleteTranslationCache', undefined).then(() => setCacheSize('0 B'));
  }

  return (
    <Show when={ready()} fallback={<div class="loading">Loading…</div>}>
      <div class="page">
        <header class="pageHeader">
          <svg class="pageIcon" viewBox="0 0 128 128" aria-hidden="true">
            <polygon points="56.3,29.2 32.6,72 80,72" fill="currentColor" />
            <circle cx="87" cy="65" r="5.6" fill="var(--prism-accent-amber)" />
            <circle cx="97" cy="72" r="4.1" fill="var(--prism-accent-rose)" />
            <circle cx="106" cy="79" r="2.7" fill="var(--prism-accent-teal)" />
          </svg>
          <h1>Prism settings</h1>
        </header>

        <TabSwitcher active={activeTab()} onChange={setActiveTab} />

        <TabPanel id="general" active={activeTab()}>
          <Section title="General">
            <label class="row">
              <span>Interface language</span>
              <select
                value={cfg.uiLanguage}
                on:change={(e) => void set('uiLanguage', (e.currentTarget as HTMLSelectElement).value)}
              >
                <option value="default">Match browser</option>
                <For each={uiLanguages}>{(code) => <option value={code}>{codeToLanguage(code, code)}</option>}</For>
              </select>
            </label>
            <label class="row">
              <span>Dark mode</span>
              <select
                value={cfg.darkMode}
                on:change={(e) =>
                  void set('darkMode', (e.currentTarget as HTMLSelectElement).value as Config['darkMode'])
                }
              >
                <option value="auto">Match system</option>
                <option value="yes">Always on</option>
                <option value="no">Always off</option>
              </select>
            </label>
            <div class="fieldGroup">
              <span>Preferred target languages (most recent first, up to 10)</span>
              <StringListEditor
                values={cfg.targetLanguages}
                formatLabel={(c) => codeToLanguage(c, effectiveUiLanguage(cfg.uiLanguage))}
                languageOptions={languageOptions(cfg.uiLanguage)}
                onAdd={addTargetLanguage}
                onRemove={removeTargetLanguage}
              />
            </div>
          </Section>

          <Section title="Backup">
            <p class="hint">
              Most preferences (languages, always/never-translate lists, and behavior toggles) already follow you across
              devices automatically via your browser's own sync, when it's turned on. API keys and custom services stay
              local to each device. Use export/import below for a full manual copy, or to move settings to a device
              without sync enabled.
            </p>
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
        </TabPanel>

        <TabPanel id="page" active={activeTab()}>
          <Section title="Page translation">
            <label class="row">
              <span>Service</span>
              <select
                value={cfg.pageTranslatorService}
                on:change={(e) =>
                  void set(
                    'pageTranslatorService',
                    (e.currentTarget as HTMLSelectElement).value as Config['pageTranslatorService'],
                  )
                }
              >
                <option value="google">Google</option>
                <option value="bing">Bing</option>
                <option value="yandex">Yandex</option>
                <option value="llm">AI (OpenAI-compatible — configure in Advanced)</option>
                <Show when={isProviderAvailable('builtin')}>
                  <option value="builtin">Built-in AI (on-device, this browser)</option>
                </Show>
              </select>
            </label>
            <div class="fieldGroup">
              <span>Enabled services</span>
              <For each={['google', 'bing', 'yandex', 'deepl'] as const}>
                {(s) => (
                  <label class="check">
                    <input
                      type="checkbox"
                      checked={cfg.enabledServices.includes(s)}
                      on:change={() => {
                        const current = twpConfig.get('enabledServices');
                        void set(
                          'enabledServices',
                          current.includes(s) ? current.filter((x) => x !== s) : [...current, s],
                        );
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
                values={cfg.alwaysTranslateSites}
                placeholder="example.com"
                onAdd={(v) => addInArray('alwaysTranslateSites', v)}
                onRemove={(v) => removeFromArray('alwaysTranslateSites', v)}
              />
            </div>
            <div class="fieldGroup">
              <span>Never translate these sites</span>
              <StringListEditor
                values={cfg.neverTranslateSites}
                placeholder="example.com"
                onAdd={(v) => addInArray('neverTranslateSites', v)}
                onRemove={(v) => removeFromArray('neverTranslateSites', v)}
              />
            </div>
            <div class="fieldGroup">
              <span>Always translate these languages</span>
              <StringListEditor
                values={cfg.alwaysTranslateLangs}
                formatLabel={(c) => codeToLanguage(c, effectiveUiLanguage(cfg.uiLanguage))}
                languageOptions={languageOptions(cfg.uiLanguage)}
                onAdd={(v) => addInArray('alwaysTranslateLangs', fixTLanguageCode(v) ?? v)}
                onRemove={(v) => removeFromArray('alwaysTranslateLangs', v)}
              />
            </div>
            <div class="fieldGroup">
              <span>Never translate these languages</span>
              <StringListEditor
                values={cfg.neverTranslateLangs}
                formatLabel={(c) => codeToLanguage(c, effectiveUiLanguage(cfg.uiLanguage))}
                languageOptions={languageOptions(cfg.uiLanguage)}
                onAdd={(v) => addInArray('neverTranslateLangs', fixTLanguageCode(v) ?? v)}
                onRemove={(v) => removeFromArray('neverTranslateLangs', v)}
              />
            </div>
          </Section>

          <Section title="Floating bubble">
            <label class="check">
              <input
                type="checkbox"
                checked={cfg.fpShowFloatingBubble === 'yes'}
                on:change={(e) =>
                  void set('fpShowFloatingBubble', (e.currentTarget as HTMLInputElement).checked ? 'yes' : 'no')
                }
              />
              Show the floating translate bubble by default
            </label>
            <div class="fieldGroup">
              <span>Per-site overrides</span>
              <For each={Object.entries(cfg.fpBubbleByHost)}>
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
              <Show when={Object.keys(cfg.fpBubbleByHost).length === 0}>
                <div class="emptyHint">None</div>
              </Show>
            </div>
          </Section>
        </TabPanel>

        <TabPanel id="selection" active={activeTab()}>
          <Section title="Selected-text translation">
            <label class="row">
              <span>Service</span>
              <select
                value={cfg.textTranslatorService}
                on:change={(e) =>
                  void set(
                    'textTranslatorService',
                    (e.currentTarget as HTMLSelectElement).value as Config['textTranslatorService'],
                  )
                }
              >
                <option value="google">Google</option>
                <option value="bing">Bing</option>
                <option value="yandex">Yandex</option>
                <option value="deepl">DeepL</option>
                <option value="libre">LibreTranslate</option>
                <option value="llm">AI (OpenAI-compatible — configure in Advanced)</option>
                <Show when={isProviderAvailable('builtin')}>
                  <option value="builtin">Built-in AI (on-device, this browser)</option>
                </Show>
              </select>
            </label>
            <label class="check">
              <input
                type="checkbox"
                checked={cfg.showTranslateSelectedButton === 'yes'}
                on:change={(e) =>
                  void set('showTranslateSelectedButton', (e.currentTarget as HTMLInputElement).checked ? 'yes' : 'no')
                }
              />
              Show a button to translate selected text
            </label>
            <label class="check">
              <input
                type="checkbox"
                checked={cfg.translateSelectedWhenPressTwice === 'yes'}
                on:change={(e) =>
                  void set(
                    'translateSelectedWhenPressTwice',
                    (e.currentTarget as HTMLInputElement).checked ? 'yes' : 'no',
                  )
                }
              />
              Translate selected text by pressing Ctrl twice
            </label>
            <label class="check">
              <input
                type="checkbox"
                checked={cfg.translateTextOverMouseWhenPressTwice === 'yes'}
                on:change={(e) =>
                  void set(
                    'translateTextOverMouseWhenPressTwice',
                    (e.currentTarget as HTMLInputElement).checked ? 'yes' : 'no',
                  )
                }
              />
              Translate text under the cursor by pressing Ctrl twice
            </label>
          </Section>

          <Section title="Hover translation">
            <label class="check">
              <input
                type="checkbox"
                checked={cfg.showOriginalTextWhenHovering === 'yes'}
                on:change={(e) =>
                  void set('showOriginalTextWhenHovering', (e.currentTarget as HTMLInputElement).checked ? 'yes' : 'no')
                }
              />
              Show original text when hovering over translated text
            </label>
            <div class="fieldGroup">
              <span>Show translations when hovering on these sites</span>
              <StringListEditor
                values={cfg.sitesToTranslateWhenHovering}
                placeholder="example.com"
                onAdd={(v) => addInArray('sitesToTranslateWhenHovering', v)}
                onRemove={(v) => removeFromArray('sitesToTranslateWhenHovering', v)}
              />
            </div>
            <div class="fieldGroup">
              <span>Show translations when hovering on pages in these languages</span>
              <StringListEditor
                values={cfg.langsToTranslateWhenHovering}
                formatLabel={(c) => codeToLanguage(c, effectiveUiLanguage(cfg.uiLanguage))}
                languageOptions={languageOptions(cfg.uiLanguage)}
                onAdd={(v) => addInArray('langsToTranslateWhenHovering', fixTLanguageCode(v) ?? v)}
                onRemove={(v) => removeFromArray('langsToTranslateWhenHovering', v)}
              />
            </div>
          </Section>
        </TabPanel>

        <TabPanel id="voice" active={activeTab()}>
          <Section title="Text-to-speech">
            <label class="row">
              <span>Service</span>
              <select
                value={cfg.textToSpeechService}
                on:change={(e) =>
                  void set(
                    'textToSpeechService',
                    (e.currentTarget as HTMLSelectElement).value as Config['textToSpeechService'],
                  )
                }
              >
                <option value="google">Google</option>
                <option value="bing">Bing</option>
              </select>
            </label>
            <label class="row">
              <span>Speed ({cfg.ttsSpeed})</span>
              <input
                type="range"
                min="0.5"
                max="2"
                step="0.1"
                value={cfg.ttsSpeed}
                on:input={(e) => void set('ttsSpeed', Number((e.currentTarget as HTMLInputElement).value))}
              />
            </label>
            <label class="row">
              <span>Volume ({cfg.ttsVolume})</span>
              <input
                type="range"
                min="0"
                max="1"
                step="0.1"
                value={cfg.ttsVolume}
                on:input={(e) => void set('ttsVolume', Number((e.currentTarget as HTMLInputElement).value))}
              />
            </label>
          </Section>
        </TabPanel>

        <TabPanel id="dictionary" active={activeTab()}>
          <Section title="Custom dictionary">
            <div class="listRow addRow">
              <input
                type="text"
                placeholder="word"
                value={dictKey()}
                on:input={(e) => setDictKey((e.currentTarget as HTMLInputElement).value)}
              />
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
            <For each={Object.entries(cfg.customDictionary)}>
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
            <Show when={Object.keys(cfg.customDictionary).length === 0}>
              <div class="emptyHint">None</div>
            </Show>
          </Section>
        </TabPanel>

        <TabPanel id="advanced" active={activeTab()}>
          <Section title="Translation services">
            <div class="fieldGroup aiHighlight">
              <span>AI (OpenAI-compatible)</span>
              <p class="hint">Works with OpenAI, a local model server, or any compatible gateway.</p>
              <div class="row">
                <input
                  type="text"
                  placeholder="Base URL, e.g. https://api.openai.com/v1/chat/completions"
                  value={llmBaseUrl()}
                  on:input={(e) => setLlmBaseUrl((e.currentTarget as HTMLInputElement).value)}
                />
                <input
                  type="text"
                  placeholder="API key"
                  value={llmApiKey()}
                  on:input={(e) => setLlmApiKey((e.currentTarget as HTMLInputElement).value)}
                />
                <input
                  type="text"
                  placeholder="Model, e.g. gpt-4o-mini"
                  value={llmModel()}
                  on:input={(e) => setLlmModel((e.currentTarget as HTMLInputElement).value)}
                />
                <button on:click={saveLlm}>Save</button>
              </div>
            </div>
            <div class="fieldGroup aiHighlight">
              <span>Built-in AI (on-device)</span>
              <div class="row">
                <Show
                  when={isProviderAvailable('builtin')}
                  fallback={<span class="emptyHint">Not available in this browser — needs Chrome 138+.</span>}
                >
                  <span class="emptyHint">Detected — no setup needed, translates locally with no network call.</span>
                </Show>
              </div>
            </div>
            <div class="fieldGroup">
              <span>LibreTranslate (self-hosted)</span>
              <div class="row">
                <input
                  type="text"
                  placeholder="Server URL"
                  value={libreUrl()}
                  on:input={(e) => setLibreUrl((e.currentTarget as HTMLInputElement).value)}
                />
                <input
                  type="text"
                  placeholder="API key (optional)"
                  value={libreKey()}
                  on:input={(e) => setLibreKey((e.currentTarget as HTMLInputElement).value)}
                />
                <button on:click={saveLibre}>Save</button>
              </div>
            </div>
            <div class="fieldGroup">
              <span>DeepL API (free tier key)</span>
              <div class="row">
                <input
                  type="text"
                  placeholder="API key"
                  value={deeplKey()}
                  on:input={(e) => setDeeplKey((e.currentTarget as HTMLInputElement).value)}
                />
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

          <Section title="Disk cache">
            <label class="check">
              <input
                type="checkbox"
                checked={cfg.enableDiskCache === 'yes'}
                on:change={(e) =>
                  void set('enableDiskCache', (e.currentTarget as HTMLInputElement).checked ? 'yes' : 'no')
                }
              />
              Cache translations on disk (persists across restarts, reduces repeat requests)
            </label>
            <div class="row">
              <span>{cacheSize() ?? 'Size unknown'}</span>
              <button on:click={refreshCacheSize}>Check size</button>
              <button class="dangerBtn" on:click={clearCache}>
                Clear cache
              </button>
            </div>
          </Section>
        </TabPanel>
      </div>
    </Show>
  );
}

export default App;

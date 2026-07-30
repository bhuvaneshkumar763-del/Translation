import { createSignal, Show } from 'solid-js';
import { ALL_SITES_PERMISSION } from '@/modules/messaging/contentMainRegistration';

/**
 * Gen 2 follow-up: a real user (on Orion for iOS, a WebKit-based browser)
 * asked for the always-on permission to be offered up front at install
 * time, instead of only living inside Settings where it's easy to miss.
 * Opened once via background.ts's `runtime.onInstalled` listener (reason
 * === 'install' only — existing users updating never see this).
 *
 * The permission request itself must happen synchronously inside this
 * page's own click handler (no `await` before it) — same rule as the
 * options page's equivalent toggle, see contentMainRegistration.ts.
 */
function App() {
  const [decision, setDecision] = createSignal<'pending' | 'granted' | 'declined' | 'skipped'>('pending');

  function enableEverywhere(): void {
    void browser.permissions.request(ALL_SITES_PERMISSION).then((granted) => {
      setDecision(granted ? 'granted' : 'declined');
    });
  }

  function skip(): void {
    setDecision('skipped');
  }

  function openOptions(): void {
    void browser.runtime.openOptionsPage().catch(() => {});
  }

  return (
    <div class="page">
      <header class="header">
        <svg class="brandIcon" viewBox="0 0 128 128" aria-hidden="true">
          <polygon points="56.3,29.2 32.6,72 80,72" fill="currentColor" />
          <circle cx="87" cy="65" r="5.6" fill="var(--prism-accent-amber)" />
          <circle cx="97" cy="72" r="4.1" fill="var(--prism-accent-rose)" />
          <circle cx="106" cy="79" r="2.7" fill="var(--prism-accent-teal)" />
        </svg>
        <h1>Welcome to Prism</h1>
      </header>

      <Show
        when={decision() === 'pending'}
        fallback={
          <div class="result">
            <Show when={decision() === 'granted'}>
              <p>Automatic translation is on. Prism will translate pages on every site from now on.</p>
            </Show>
            <Show when={decision() === 'declined'}>
              <p>No problem — Prism will only translate when you ask it to (toolbar click, hotkey, or right-click).</p>
            </Show>
            <Show when={decision() === 'skipped'}>
              <p>All set. Prism will only translate when you ask it to (toolbar click, hotkey, or right-click).</p>
            </Show>
            <p class="hint">You can change this anytime in Settings → Page.</p>
            <button type="button" class="secondaryBtn" on:click={openOptions}>
              Open Settings
            </button>
          </div>
        }
      >
        <p>
          By default, Prism only reads a page when you ask it to — no standing access to the sites you visit. That's the
          more private option, and it's what we recommend.
        </p>
        <p>
          If you'd rather have the classic "always ready" experience instead — automatic translation, the floating
          bubble, and hover-translate on every site, with no need to click first — you can turn that on now. It's a
          one-time browser permission, and you can always change your mind later in Settings.
        </p>
        <div class="actions">
          <button type="button" class="primaryBtn" on:click={enableEverywhere}>
            Enable automatic translation on all sites
          </button>
          <button type="button" class="secondaryBtn" on:click={skip}>
            Not now, I'll decide later
          </button>
        </div>
      </Show>
    </div>
  );
}

export default App;

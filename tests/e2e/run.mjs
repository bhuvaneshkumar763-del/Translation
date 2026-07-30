// Headless-Chromium smoke test for the built extension.
//
// Formalizes the ad-hoc Playwright pattern this repo's rewrite has used
// since Phase 6 (previously re-typed into a scratchpad script each session
// — see CLAUDE.md's "Testing" section for the history). Loads the real
// unpacked build from .output/chrome-mv3, opens every entrypoint HTML file
// as a tab, and asserts each one renders without a page error.
//
// Requires `npm run build` to have been run first (or run it below).
//
// Known limitation (inherited from the prior ad-hoc version): opening an
// entrypoint HTML file as a plain tab rather than as a real toolbar popup
// means chrome.tabs.query({active:true}) resolves to that tab itself, not
// a page under test — fine for structural/no-exception checks, not for a
// true content-script round trip. See CLAUDE.md for the local-static-page
// pattern used for real round-trip testing.

import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
const extensionPath = join(repoRoot, '.output/chrome-mv3');

if (!existsSync(extensionPath)) {
  console.error(`No build found at ${extensionPath} — run "npm run build" first.`);
  process.exit(1);
}

// Every entrypoint HTML that should render standalone as a plain tab.
// (offscreen.html is excluded — it's only ever loaded by chrome.offscreen,
// not as a navigable page. old-popup.html was deleted in Gen 2 Session 3 —
// one popup now, not two — so it's no longer in this list; if it ever
// reappears in a build, that's a regression, not something to re-add here.
// welcome.html existed briefly as an install-time onboarding page for an
// optional permission that no longer exists — see CLAUDE.md's "Permission
// model: reverted to unconditional access" section — and was deleted along
// with it; same "regression if it reappears" rule applies.)
//
// `check` is an optional extra assertion run against the page after the
// generic "rendered without error" check passes — used for the Gen 2
// Session 3 UI rewrite to catch a structurally-broken rebuild (e.g. the
// options page silently losing its tabs) that a bare "no exception" check
// wouldn't.
const candidateEntrypoints = [
  {
    file: 'popup.html',
    async check(page) {
      const hasPrimaryBtn = (await page.locator('.primaryBtn').count()) > 0;
      if (!hasPrimaryBtn) return "expected the rebuilt popup's .primaryBtn to be present";
    },
  },
  {
    file: 'options.html',
    async check(page) {
      const tabs = await page.locator('[role="tab"]').count();
      if (tabs !== 6) return `expected 6 tabs (role="tab"), found ${tabs}`;
      const panels = await page.locator('[role="tabpanel"]').count();
      if (panels !== 6) return `expected 6 tabpanels, found ${panels}`;
    },
  },
  { file: 'improve-translation.html' },
  { file: 'translate-text.html' },
  { file: 'translate-document.html' },
];

const userDataDir = mkdtempSync(join(tmpdir(), 'prism-e2e-'));
let failures = 0;

try {
  // headless:true would make Playwright launch chrome-headless-shell, which
  // has no extension support at all. The standard workaround: request the
  // full Chrome binary (headless:false) but pass --headless=new as an arg
  // so Chrome itself still runs headless.
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    args: [
      '--headless=new',
      '--no-sandbox',
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
    ],
  });

  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker', { timeout: 10_000 }));
  const extId = worker.url().split('/')[2];
  console.log(`Loaded extension ${extId}`);

  for (const { file: entry, check } of candidateEntrypoints) {
    if (!existsSync(join(extensionPath, entry))) {
      console.log(`skip ${entry} (not present in this build)`);
      continue;
    }
    const page = await context.newPage();
    const pageErrors = [];
    page.on('pageerror', (err) => pageErrors.push(err.message));
    page.on('console', (msg) => {
      if (msg.type() !== 'error') return;
      // Expected noise, not a real failure: these pages message the active
      // tab's content script (e.g. to read page-translation state), and in
      // this harness the "active tab" is the entrypoint's own about:blank
      // opener with no content script listening. See the "Known limitation"
      // note at the top of this file.
      if (/Could not establish connection|Receiving end does not exist/.test(msg.text())) return;
      pageErrors.push(msg.text());
    });

    try {
      await page.goto(`chrome-extension://${extId}/${entry}`, { waitUntil: 'load', timeout: 10_000 });
      await page.waitForTimeout(300); // let Solid's initial render/effects settle
      const bodyText = await page.locator('body').innerText();
      if (!bodyText.trim()) {
        pageErrors.push('body rendered empty');
      }
      if (check) {
        const checkError = await check(page);
        if (checkError) pageErrors.push(checkError);
      }
    } catch (err) {
      pageErrors.push(String(err));
    }

    if (pageErrors.length > 0) {
      console.error(`FAIL ${entry}:\n  ${pageErrors.join('\n  ')}`);
      failures++;
    } else {
      console.log(`pass ${entry}`);
    }
    await page.close();
  }

  // Toolbar-icon/popup-assignment check: confirm removing old-popup and its
  // useOldPopup swap logic (Gen 2 Session 3) left resetBrowserAction()
  // correctly pointing the toolbar action at the one remaining popup.
  const assignedPopup = await worker.evaluate(() => chrome.action.getPopup({}));
  if (!assignedPopup.endsWith('/popup.html')) {
    console.error(`FAIL toolbar-icon popup assignment: expected .../popup.html, got "${assignedPopup}"`);
    failures++;
  } else {
    console.log('pass toolbar-icon popup assignment');
  }

  await context.close();
} finally {
  rmSync(userDataDir, { recursive: true, force: true });
}

if (failures > 0) {
  console.error(`\n${failures} surface(s) failed.`);
  process.exit(1);
}
console.log('\nAll surfaces passed.');

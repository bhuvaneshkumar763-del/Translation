/**
 * Gen 2 Session 4: since `host_permissions` no longer unconditionally
 * covers every site (see wxt.config.ts's header comment), content-main's
 * static `<all_urls>` match only actually runs on origins where the user
 * has granted the optional broad permission. Everywhere else, the first
 * message to a tab's content script fails with "no receiver" — this
 * catches that specific case, injects the content script on demand via
 * the calling context's `activeTab` grant, and retries.
 *
 * Every call site using this must run directly inside a user-gesture
 * handler — `action.onClicked`/`contextMenus.onClicked`/`commands.onCommand`
 * in the background, or a click handler in the popup/a standalone window —
 * since that's what `chrome.scripting.executeScript` needs `activeTab`
 * access for an otherwise-unpermissioned tab. Shared by background.ts and
 * every entrypoint that messages a tab's content script directly
 * (popup, improve-translation) rather than relying on background.ts to
 * relay — see modules/messaging/tabTarget.ts for the target-shape helpers
 * this is meant to be used alongside.
 */

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** True for the specific "no listener in that tab/frame" errors sendMessage throws — as opposed to a real failure worth surfacing as-is. */
function isNoReceiverError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  return /Could not establish connection|Receiving end does not exist/.test(msg);
}

/**
 * Runs `send()`; if it fails because content-main isn't present in that
 * tab, injects it on demand and retries a few times (main() does
 * `await twpConfig.onReady()` before registering any onMessage listener,
 * so "injected" and "ready to receive messages" aren't the same instant).
 * Returns the resolved value on success, or `undefined` if every attempt
 * (including the fallback) fails.
 */
export async function sendEnsuringContentScript<T>(tabId: number, send: () => Promise<T>): Promise<T | undefined> {
  try {
    return await send();
  } catch (e) {
    if (!isNoReceiverError(e)) {
      console.error(e);
      return undefined;
    }
  }

  try {
    await browser.scripting.executeScript({
      target: { tabId, allFrames: true },
      files: ['/content-scripts/content-main.js'],
    });
  } catch (injectErr) {
    // Expected on tabs scripting can never reach (chrome://, the Web
    // Store, etc.) — nothing more to try there.
    console.error('On-demand content script injection failed', injectErr);
    return undefined;
  }

  for (let attempt = 0; attempt < 6; attempt++) {
    await sleep(150);
    try {
      return await send();
    } catch {
      // keep retrying briefly — see the module doc comment above
    }
  }
  console.error(`Gave up reaching the content script in tab ${tabId} after on-demand injection`);
  return undefined;
}

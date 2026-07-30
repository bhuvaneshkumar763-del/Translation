/**
 * Gen 2 Session 4: the load-bearing half of the permission scope-down —
 * see content-main.content.ts's `registration: 'runtime'` doc comment for
 * why this exists at all (a *static* manifest content_scripts entry grants
 * itself broad injection rights independent of host_permissions; this is
 * what actually makes the scope-down real). content-main is registered
 * with `browser.scripting` only while the optional `<all_urls>`
 * permission is actually granted.
 */

export const ALL_SITES_PERMISSION = { origins: ['<all_urls>'] };
export const CONTENT_MAIN_REGISTRATION_ID = 'content-main-runtime';

/**
 * Called on every background startup (permissions can change between
 * browser restarts) and whenever the grant itself changes (via
 * browser.permissions.onAdded/onRemoved), so a user flipping the
 * options-page "automatic translation" toggle takes effect without
 * needing to reload the extension.
 */
export async function syncContentMainRegistration(): Promise<void> {
  if (!browser.scripting?.registerContentScripts) {
    // Feature-detected, not assumed: some WebExtension implementations —
    // notably WebKit-based browsers like Orion on iOS, reported not to
    // work by a real user — support the older, more fundamental
    // scripting.executeScript (what ensureContentScript.ts uses for the
    // core on-demand "click to translate" gesture path) without
    // supporting the newer registerContentScripts/getRegisteredContentScripts/
    // unregisterContentScripts trio this function needs for "always
    // translate"/"automatic translation" to keep working across future
    // page loads with no fresh gesture. Returning early here means that
    // gap degrades to "always translate only takes effect right after you
    // click," not an unhandled rejection out of this fire-and-forget
    // background call (this function is invoked as `void
    // syncContentMainRegistration()` in background.ts). See CLAUDE.md's
    // known-gaps section — this hasn't been verified against a real
    // WebKit-based browser, only reasoned about from the reported symptom.
    return;
  }
  const granted = await browser.permissions.contains(ALL_SITES_PERMISSION);
  const registered = await browser.scripting.getRegisteredContentScripts({ ids: [CONTENT_MAIN_REGISTRATION_ID] });
  const isRegistered = registered.length > 0;

  if (granted && !isRegistered) {
    await browser.scripting.registerContentScripts([
      {
        id: CONTENT_MAIN_REGISTRATION_ID,
        matches: ['<all_urls>'],
        js: ['/content-scripts/content-main.js'],
        allFrames: true,
        matchOriginAsFallback: true,
        runAt: 'document_end',
      },
    ]);
  } else if (!granted && isRegistered) {
    await browser.scripting.unregisterContentScripts({ ids: [CONTENT_MAIN_REGISTRATION_ID] });
  }
}

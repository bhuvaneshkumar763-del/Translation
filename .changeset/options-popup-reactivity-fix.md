---
"prism-translate": minor
---

Fix a real bug reported by a user: adding or removing a site/language in the options page's list editors (always/never-translate sites and languages, hover-translate lists) — and toggling settings in the popup — silently didn't update on screen, even though the change was correctly saved. Both files were reading config values directly in JSX instead of through a reactive store, so Solid never re-rendered after the initial mount. Fixed with a genuine reactive store mirroring config state in both files.

Also: language pickers in the options page (always/never-translate languages, hover-translate languages, preferred target languages) are now a dropdown of language names instead of a free-text field requiring a raw ISO code.

And: `syncContentMainRegistration()` now feature-detects `scripting.registerContentScripts` before using it, so browsers whose WebExtension implementation doesn't support it (reported with Orion on iOS) degrade gracefully instead of throwing — "always translate" on such a browser now just requires a fresh click rather than silently breaking background registration.

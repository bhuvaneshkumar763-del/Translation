---
"prism-translate": major
---

Reverted the activeTab-by-default permission model back to unconditional `<all_urls>` access, matching the extension's original (pre-Gen-2) behavior.

A real user reported "always translate this site" only ever worked immediately after a fresh click — never automatically on a later visit — specifically on Orion for iOS (a WebKit-based browser). Root cause, confirmed against the user's own previously-working pre-rewrite fork: the scoped model's "automatic translation" opt-in depended on `scripting.registerContentScripts`, a newer MV3 API that browser doesn't support, with no native fallback to grant the equivalent access another way. Presented as an explicit choice, the user chose to revert rather than accept automatic translation being permanently broken there.

What changed: `host_permissions` is `['<all_urls>']` again; `content-main` is a static `content_scripts` entry again (not runtime-registered); the now-pointless dynamic-registration module, its install-time onboarding page, and the "Enable automatic translation on all sites" toggle are all removed. The on-demand injection fallback for tabs that predate an install/reload is unchanged.

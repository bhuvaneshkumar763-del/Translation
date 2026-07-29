# What is this thing? (plain-English version)

> This file is kept up to date on purpose — whenever the extension gains,
> loses, or changes a feature that a regular user would notice, this file
> gets updated too. If you're reading this, it should reflect what the
> extension actually does *today*, not what it used to do.
>
> **Heads up if you're reading this mid-2026:** the extension has been
> rebuilt into "Prism" — new name, a new indigo/violet look across every
> screen, and an AI-powered translation engine alongside the classic
> Google/Bing/etc. options. The visual redesign and the permission/privacy
> rework described below are both done now, not upcoming — see
> `/Users/jb/.claude/plans/so-whats-the-plan-polished-elephant.md` for
> exactly what's landed vs. still planned (mainly release-engineering polish
> at this point). This file describes today's build, not a destination.

## The one-sentence version

**Prism** is a browser add-on (an "extension") that translates webpages for
you, right there on the page, without you having to copy-paste anything into
Google Translate.

## Who is this for

Anyone who visits websites in a language they don't fully understand, and
wants the page translated automatically or with one click — students,
travelers, people reading foreign news sites, shoppers on foreign stores,
etc.

## What it actually does, in plain terms

**1. Translate a whole page with one click.**
Click the little icon in your toolbar, or press a keyboard shortcut, and
the whole page gets translated in place — the layout stays the same, just
the text changes to your language. Click again (or the same shortcut) to
flip it back to the original.

**2. Choose which translation service does the work.**
It can use Google Translate, Bing Translator, Yandex Translate, DeepL, or
LibreTranslate (a free, privacy-friendly option) under the hood. You can
switch between them with one click if you don't like a particular
translation. Two newer, AI-based options exist too (set up in the advanced
settings for now — a proper front-and-center spot for them is coming):
  - **Your own AI** — plug in an API key for OpenAI or a compatible service,
    and it translates with a language model instead of a plain translator,
    which tends to handle context, tone, and tricky phrasing better.
  - **Built-in AI** — on newer versions of Chrome, the browser itself has a
    translator built in. If your Chrome supports it, this option needs no
    setup, no API key, and doesn't send your text anywhere over the
    internet at all — it all happens on your own computer.

**3. A little floating "bubble" button.**
While you're browsing, a small draggable bubble can float on the page,
giving you quick access to translate/undo without hunting for the toolbar
icon. You can drag it wherever you like on the page, and it remembers.

**4. Translate just a bit of text.**
Select (highlight) any text on a page, and a small button pops up letting
you translate just that selection — handy for a single sentence or word
instead of the whole page.

**5. Hover to peek at a translation.**
On sites you've set up for it, just hovering your mouse over text can show
you a quick translation without clicking anything.

**6. Works on your phone/tablet too.**
There's a version of the popup adapted for touchscreens/mobile browsers.

**7. Remembers your preferences per website.**
You can tell it "always translate this site" or "never translate this
site," and "always translate from this language," and it remembers that
per-website — so you don't have to keep re-telling it.

**8. A few extra helper windows:**
   - **"Improve translation"** — lets you manually correct which language a
     site is in, or which translation service/settings are used for it,
     if the automatic detection guessed wrong.
   - **"Translate text"** — a standalone little window where you can type
     or paste text and get it translated, with a "listen" button to hear it
     read aloud.
   - **"Translate document"** — quick links to open Google Translate, DeepL,
     or OnlineDocTranslator for translating whole documents/files (this one
     doesn't do the translating itself — it just sends you to the right
     external tool).

**9. A custom dictionary.**
You can teach it to always translate certain words or phrases your own way
(useful for names, brands, or jargon that automatic translation gets
wrong).

**10. It reads translations out loud (text-to-speech).**
Selected text or a translated page can be read aloud, in several of the
helper windows.

**11. It saves translations so re-visiting a page is instant.**
Previously-translated text is cached on your own device, so if you come
back to a page you already translated, it doesn't have to ask the
translation service again — it's instant, and it also means slightly less
data sent out over the network. There's a size cap so this cache doesn't
grow forever.

**12. It only reads a page when you ask it to.**
By default, Prism doesn't have standing access to every website you
visit — it only looks at a page's text at the moment you click the toolbar
icon, use a keyboard shortcut, or pick "translate" from the right-click
menu, on whichever page you're currently on. If you'd rather have the old
"always ready" experience — the floating bubble and automatic/hover
translation showing up on every site without you asking first — there's a
one-time toggle for that in Settings → Page ("Enable automatic translation
on all sites"), which asks your browser for that broader permission
up front.

**13. Most of your settings follow you to your other devices.**
If you're signed into your browser's sync (the same feature that syncs
your bookmarks and passwords across computers), Prism's language
preferences, always/never-translate lists, and behavior toggles sync along
with it automatically — no setup needed. Anything sensitive, like a
plugged-in AI API key, stays on that one device only. You can also still
export/import settings by hand from the Backup section, which is useful
for moving things to a device without browser sync turned on.

## What it does NOT do (on purpose)

- It doesn't translate PDF files or Word documents by itself — for those,
  the "Translate document" window just points you to other tools that do.
- It doesn't have a "donate to the developer" button or link anymore — that
  was tied to the original project's own creator and didn't make sense to
  carry over here.

## The technical side, in one paragraph (for the curious, still non-scary)

Under the hood, this used to be written in older-style, plain JavaScript
with no real structure. It has since been rebuilt using more modern web
developer tools — TypeScript (a stricter version of JavaScript that catches
mistakes earlier) and Solid (a small toolkit for building the on-screen
buttons/menus/popups). None of that changes what the extension does for
you day-to-day — your settings, your saved preferences, and how it behaves
are all the same or better, just built on sturdier foundations.

## Current state

Every feature described above is built and working. The toolbar popup, the
floating bubble, the selection/hover translation, mobile support, and all
three helper windows ("Improve translation", "Translate text", "Translate
document") are all in place. Nothing user-facing is currently missing
compared to the original extension this is based on, aside from the two
intentionally-dropped items listed above.

One thing that *is* a deliberate change, not a gap: the classic/old-style
popup skin mentioned in earlier versions of this file has been retired —
Prism now ships one toolbar popup, redesigned, instead of two competing
looks. Every screen — the popup, the floating bubble, the settings page,
the hover tooltips, the mobile bar, the selection popup, and all three
helper windows — now shares the same indigo "Prism" visual identity,
replacing the old blue TWP styling. Same features throughout, new coat of
paint everywhere.

Also new: the privacy/permission model described in item 12 above (ask
first, by default, instead of standing access to every site) and the
cross-device settings sync described in item 13.

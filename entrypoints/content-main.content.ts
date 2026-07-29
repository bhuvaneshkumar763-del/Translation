// Placeholder — ported from contentScript/pageTranslator.js + showOriginal.js
// + showTranslated.js + translateSelected.js in later phases (see plan Phase
// 2/4/5). Deliberately trivial for now; Phase 0's goal is just a buildable,
// loadable MV3 shell.
export default defineContentScript({
  matches: ['<all_urls>'],
  runAt: 'document_end',
  allFrames: true,
  matchAboutBlank: true,
  main() {
    console.log('[TWP] content-main placeholder loaded');
  },
});

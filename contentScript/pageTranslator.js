"use strict";

/**
 * This mark cannot contain words, like <customskipword>12</customskipword>34
 *
 * Google will reorder as <customskipword>1234</customskipword>
 *
 * Under certain circumstances，Google broken the translation, returned startMark0 in some cases
 * */
const startMark = "@%";
const endMark = "#$";
const startMark0 = "@ %";
const endMark0 = "# $";

const bingMarkFrontPart = '<mstrans:dictionary translation="';
const bingMarkSecondPart = '"></mstrans:dictionary>';

let currentIndex;
let compressionMap;

/**
 * ## custom dictionary functional preprocessing
 *
 * ### How to achieve:
 * 1. For Google and Yandex, this feature is not officially supported,
 *    we convert matching keywords to a string of special signs to skip translation,
 *    before sending to the translation engine,
 *    and after the results come back, call `handleCustomWords` to restore the words.
 * 2. For Bing, this feature is officially supported,
 *    we don't need to call `handleCustomWords`, Bing absorb these marks.
 *    And bing does not have the language restrictions in the third point below.
 *
 *  ### Notes:
 *  1. For English words, ignore case when matching.
 *  2. CustomDictionary must be sorted , we want to match the keyword "Spring Boot" first then the keyword "Spring"
 *  3. For the word "app" , We don't want to "Happy" also matched.
 *     So we match only isolated words, by checking the two characters before and after the keyword.
 *     But this will also cause this method to not work for Chinese, Burmese and other languages without spaces.
 * */
function filterKeywordsInText(
  textContext,
  sortedCustomDictionary,
  currentPageTranslatorService
) {
  if (sortedCustomDictionary.size > 0) {
    for (let keyWord of sortedCustomDictionary.keys()) {
      while (true) {
        let index = textContext.toLowerCase().indexOf(keyWord);
        if (index === -1) {
          break;
        } else {
          textContext = removeExtraDelimiter(textContext);
          let previousIndex = index - 1;
          let nextIndex = index + keyWord.length;
          let previousChar =
            previousIndex === -1 ? "\n" : textContext.charAt(previousIndex);
          let nextChar =
            nextIndex === textContext.length
              ? "\n"
              : textContext.charAt(nextIndex);
          let placeholderText = "";
          let keyWordWithCase = textContext.substring(
            index,
            index + keyWord.length
          );
          if (
            isPunctuationOrDelimiter(previousChar) &&
            isPunctuationOrDelimiter(nextChar)
          ) {
            /**
             * Bing's translation engine, officially provides custom dictionary function,
             * so it has its own separate tags.
             * At the same time we add a space before and after the word to make it look a little more comfortable.
             * */
            if (currentPageTranslatorService === "bing") {
              let customValue = sortedCustomDictionary.get(keyWord);
              if (customValue === "") customValue = keyWordWithCase;
              customValue =
                " " +
                customValue.substring(0, 1) +
                "#n%o#" +
                customValue.substring(1) +
                " ";
              placeholderText =
                bingMarkFrontPart + customValue + bingMarkSecondPart;
            } else {
              placeholderText =
                startMark + handleHitKeywords(keyWordWithCase, true) + endMark;
            }
          } else {
            placeholderText = "#n%o#";
            for (let c of Array.from(keyWordWithCase)) {
              placeholderText += c;
              placeholderText += "#n%o#";
            }
          }
          let frontPart = textContext.substring(0, index);
          let backPart = textContext.substring(index + keyWord.length);
          textContext = frontPart + placeholderText + backPart;
        }
      }
      textContext = textContext.replaceAll("#n%o#", "");
    }
  }
  return textContext;
}

/**
 *  handle the keywords in translatedText, replace it if there is a custom replacement value.
 *  When encountering Google Translate reordering, the original text contains our mark, etc.
 *  we will catch these exceptions and call the text translation method to retranslate this section.
 *
 * Note:
 *  1. Bing's translation engine has its own separate tags,and the engine digests these tags internally,
 *  we don't need to call the method below.
 **/
async function handleCustomWords(
  translated,
  originalText,
  customDictionary,
  currentPageTranslatorService,
  currentSourceLanguage,
  currentTargetLanguage
) {
  try {
    if (customDictionary.size > 0 && currentPageTranslatorService !== "bing") {
      // If the translation is a single word and exists in the dictionary, return it directly
      let customValue = customDictionary.get(originalText.trim());
      if (customValue) return customValue;

      translated = removeExtraDelimiter(translated);
      translated = translated.replaceAll(startMark0, startMark);
      translated = translated.replaceAll(endMark0, endMark);

      while (true) {
        let startIndex = translated.indexOf(startMark);
        let endIndex = translated.indexOf(endMark);
        if (startIndex === -1 && endIndex === -1) {
          break;
        } else {
          let placeholderText = translated.substring(
            startIndex + startMark.length,
            endIndex
          );
          // At this point placeholderText is actually currentIndex , the real value is in compressionMap
          let keyWord = handleHitKeywords(placeholderText, false);
          if (keyWord === "undefined") {
            throw new Error("undefined");
          }
          let frontPart = translated.substring(0, startIndex);
          let backPart = translated.substring(endIndex + endMark.length);
          let customValue = customDictionary.get(keyWord.toLowerCase());
          customValue = customValue === "" ? keyWord : customValue;
          // Highlight custom words, make it have a space before and after it
          frontPart = isPunctuationOrDelimiter(
            frontPart.charAt(frontPart.length - 1)
          )
            ? frontPart
            : frontPart + " ";
          backPart = isPunctuationOrDelimiter(backPart.charAt(0))
            ? backPart
            : " " + backPart;
          translated = frontPart + customValue + backPart;
        }
      }
    }
  } catch (e) {
    return await backgroundTranslateSingleText(
      currentPageTranslatorService,
      currentSourceLanguage,
      currentTargetLanguage,
      originalText
    );
  }

  return translated;
}

/**
 *
 * True : Store the keyword in the Map and return the index
 *
 * False : Extract keywords by index
 * */
function handleHitKeywords(value, mode) {
  if (mode) {
    if (currentIndex === undefined) {
      currentIndex = 1;
      compressionMap = new Map();
      compressionMap.set(currentIndex, value);
    } else {
      compressionMap.set(++currentIndex, value);
    }
    return String(currentIndex);
  } else {
    return String(compressionMap.get(Number(value)));
  }
}

/**
 * any kind of punctuation character (including international e.g. Chinese and Spanish punctuation), and spaces, newlines
 *
 * source: https://github.com/slevithan/xregexp/blob/41f4cd3fc0a8540c3c71969a0f81d1f00e9056a9/src/addons/unicode/unicode-categories.js#L142
 *
 * note: XRegExp unicode output taken from http://jsbin.com/uFiNeDOn/3/edit?js,console (see chrome console.log), then converted back to JS escaped unicode here http://rishida.net/tools/conversion/, then tested on http://regexpal.com/
 *
 * suggested by: https://stackoverflow.com/a/7578937
 *
 * added: extra characters like "$", "\uFFE5" [yen symbol], "^", "+", "=" which are not consider punctuation in the XRegExp regex (they are currency or mathmatical characters)
 *
 * added: Chinese Punctuation: \u3002|\uff1f|\uff01|\uff0c|\u3001|\uff1b|\uff1a|\u201c|\u201d|\u2018|\u2019|\uff08|\uff09|\u300a|\u300b|\u3010|\u3011|\u007e
 *
 * added: special html space symbol: &nbsp; &ensp; &emsp; &thinsp; &zwnj; &zwj; -> \u00A0|\u2002|\u2003|\u2009|\u200C|\u200D
 * @see https://stackoverflow.com/a/21396529/19616126
 * */
function isPunctuationOrDelimiter(str) {
  if (typeof str !== "string") return false;
  if (str === "\n" || str === " ") return true;
  const regex =
    /[\$\uFFE5\^\+=`~<>{}\[\]|\u00A0|\u2002|\u2003|\u2009|\u200C|\u200D|\u3002|\uff1f|\uff01|\uff0c|\u3001|\uff1b|\uff1a|\u201c|\u201d|\u2018|\u2019|\uff08|\uff09|\u300a|\u300b|\u3010|\u3011|\u007e!-#%-\x2A,-/:;\x3F@\x5B-\x5D_\x7B}\u00A1\u00A7\u00AB\u00B6\u00B7\u00BB\u00BF\u037E\u0387\u055A-\u055F\u0589\u058A\u05BE\u05C0\u05C3\u05C6\u05F3\u05F4\u0609\u060A\u060C\u060D\u061B\u061E\u061F\u066A-\u066D\u06D4\u0700-\u070D\u07F7-\u07F9\u0830-\u083E\u085E\u0964\u0965\u0970\u0AF0\u0DF4\u0E4F\u0E5A\u0E5B\u0F04-\u0F12\u0F14\u0F3A-\u0F3D\u0F85\u0FD0-\u0FD4\u0FD9\u0FDA\u104A-\u104F\u10FB\u1360-\u1368\u1400\u166D\u166E\u169B\u169C\u16EB-\u16ED\u1735\u1736\u17D4-\u17D6\u17D8-\u17DA\u1800-\u180A\u1944\u1945\u1A1E\u1A1F\u1AA0-\u1AA6\u1AA8-\u1AAD\u1B5A-\u1B60\u1BFC-\u1BFF\u1C3B-\u1C3F\u1C7E\u1C7F\u1CC0-\u1CC7\u1CD3\u2010-\u2027\u2030-\u2043\u2045-\u2051\u2053-\u205E\u207D\u207E\u208D\u208E\u2329\u232A\u2768-\u2775\u27C5\u27C6\u27E6-\u27EF\u2983-\u2998\u29D8-\u29DB\u29FC\u29FD\u2CF9-\u2CFC\u2CFE\u2CFF\u2D70\u2E00-\u2E2E\u2E30-\u2E3B\u3001-\u3003\u3008-\u3011\u3014-\u301F\u3030\u303D\u30A0\u30FB\uA4FE\uA4FF\uA60D-\uA60F\uA673\uA67E\uA6F2-\uA6F7\uA874-\uA877\uA8CE\uA8CF\uA8F8-\uA8FA\uA92E\uA92F\uA95F\uA9C1-\uA9CD\uA9DE\uA9DF\uAA5C-\uAA5F\uAADE\uAADF\uAAF0\uAAF1\uABEB\uFD3E\uFD3F\uFE10-\uFE19\uFE30-\uFE52\uFE54-\uFE61\uFE63\uFE68\uFE6A\uFE6B\uFF01-\uFF03\uFF05-\uFF0A\uFF0C-\uFF0F\uFF1A\uFF1B\uFF1F\uFF20\uFF3B-\uFF3D\uFF3F\uFF5B\uFF5D\uFF5F-\uFF65]+/g;
  return regex.test(str);
}

/**
 * get a sorted dictionary
 * */
function sortDictionary(customDictionary) {
  return new Map(
    [...customDictionary.entries()].sort(
      (a, b) => String(b[0]).length - String(a[0]).length
    )
  );
}

/**
 * Remove useless newlines, spaces inside, which may affect our semantics
 * */
function removeExtraDelimiter(textContext) {
  textContext = textContext.replaceAll("\n", " ");
  textContext = textContext.replace(/  +/g, " ");
  return textContext;
}

function backgroundTranslateHTML(
  translationService,
  sourceLanguage,
  targetLanguage,
  sourceArray2d,
  dontSortResults
) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(
      {
        action: "translateHTML",
        translationService,
        sourceLanguage,
        targetLanguage,
        sourceArray2d,
        dontSortResults,
      },
      (response) => {
        checkedLastError();
        resolve(response);
      }
    );
  });
}

function backgroundTranslateText(
  translationService,
  sourceLanguage,
  targetLanguage,
  sourceArray
) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(
      {
        action: "translateText",
        translationService,
        sourceLanguage,
        targetLanguage,
        sourceArray,
      },
      (response) => {
        checkedLastError();
        resolve(response);
      }
    );
  });
}

function backgroundTranslateSingleText(
  translationService,
  sourceLanguage,
  targetLanguage,
  source
) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(
      {
        action: "translateSingleText",
        translationService,
        sourceLanguage,
        targetLanguage,
        source,
      },
      (response) => {
        checkedLastError();
        resolve(response);
      }
    );
  });
}

var pageTranslator = {};

function getTabHostName() {
  return new Promise((resolve) =>
    chrome.runtime.sendMessage({ action: "getTabHostName" }, (result) => {
      checkedLastError();
      resolve(result);
    })
  );
}

Promise.all([twpConfig.onReady(), getTabHostName()]).then(function (_) {
  const tabHostName = _[1];
  // "sup" não será traduzido https://github.com/FilipePS/Traduzir-paginas-web/issues/647
  /* prettier-ignore */
  const htmlTagsInlineText = ["#text", "a", "abbr", "acronym", "b", "bdo", "big", "cite", "dfn", "em", "i", "label", "q", "s", "small", "span", "strong", "sub", /*"sup",*/ "u", "tt", "var"];
  /* prettier-ignore */
  const htmlTagsInlineIgnore = ["br", "code", "kbd", "wbr"]; // and input if type is submit or button, and <pre> depending on settings
  /* prettier-ignore */
  const htmlTagsNoTranslate = ["title", "script", "style", "textarea", "svg", "template",
  "math", "mjx-container", "tex-math" // https://github.com/FilipePS/Traduzir-paginas-web/issues/704
  ];

  if (location.hostname === "pdf.translatewebpages.org") {
    const index = htmlTagsInlineText.indexOf("span");
    if (index !== -1) {
      htmlTagsInlineText.splice(index, 1);
    }
  }

  // https://github.com/FilipePS/Traduzir-paginas-web/issues/609
  if (
    twpConfig.get("translateTag_pre") !== "yes" &&
    !(
      document.body.childElementCount === 1 &&
      document.body.firstChild.nodeName.toLocaleLowerCase() === "pre"
    )
  ) {
    htmlTagsInlineIgnore.push("pre");
  }
  twpConfig.onChanged((name, newvalue) => {
    switch (name) {
      case "translateTag_pre":
        const index = htmlTagsInlineIgnore.indexOf("pre");
        if (index !== -1) {
          htmlTagsInlineIgnore.splice(index, 1);
        }
        if (
          newvalue !== "yes" &&
          !(
            document.body.childElementCount === 1 &&
            document.body.firstChild.nodeName.toLocaleLowerCase() === "pre"
          )
        ) {
          htmlTagsInlineIgnore.push("pre");
        }
        break;
      case "dontSortResults":
        dontSortResults = newvalue == "yes" ? true : false;
        break;
    }
  });

  //TODO FOO
  if (
    twpConfig.get("useOldPopup") == "yes" ||
    twpConfig.get("popupPanelSection") <= 1
  ) {
    twpConfig.set("targetLanguage", twpConfig.get("targetLanguages")[0]);
  }

  // Pieces are a set of nodes separated by inline tags that form a sentence or paragraph.
  let piecesToTranslate = [];
  let originalTabLanguage = "und";
  let currentPageLanguage = "und";
  let pageLanguageState = "original";
  let currentSourceLanguage = "auto";
  // TWP-FullPage patch: if the user previously picked a source language for
  // this hostname via "Improve translation", restore it instead of defaulting
  // to auto-detect.
  try {
    const savedMap = twpConfig.get("fpSourceLangByHost") || {};
    const host = location.hostname;
    if (host && savedMap[host]) {
      currentSourceLanguage = savedMap[host];
    }
  } catch (e) { console.debug(e); }
  let currentTargetLanguage = twpConfig.get("targetLanguage");
  let currentPageTranslatorService = twpConfig.get("pageTranslatorService");
  let customDictionary = sortDictionary(twpConfig.get("customDictionary"));
  let dontSortResults =
    twpConfig.get("dontSortResults") == "yes" ? true : false;

  let fooCount = 0;

  let originalPageTitle;
  let translatedPageTitle = null;
  let titleMutationObserver = null;

  let attributesToTranslate = [];

  let translateNewNodesTimerHandler;
  let newNodes = [];
  let removedNodes = [];

  let nodesToRestore = [];

  // --- TWP-FullPage: O(1) dedupe tracking ------------------------------------
  // translateNewNodes used to check "is this node already in a piece?" by
  // scanning every existing piece for every candidate (and never broke out
  // early on a match). With the body-wide adaptive re-sweep running every few
  // seconds, that nested scan became the hottest loop in the extension on long
  // pages. These WeakSets/WeakMaps make membership O(1); they are rebuilt at
  // the start of each translate cycle in translatePage.
  let fpTrackedNodes = new WeakSet(); // text nodes already in a piece
  let fpTrackedAttrs = new WeakMap(); // Element -> Set(attrName) already queued
  function fpTrackNodes(nodes) {
    for (const n of nodes) fpTrackedNodes.add(n);
  }
  // Attributes (placeholder / title / alt / aria-label…) were only collected
  // ONCE per translate cycle, so dynamically-added controls (SPA "Next
  // chapter" buttons, lazy-loaded toolbars) never got theirs translated. The
  // re-sweep now re-collects with WeakMap dedupe so each element+attribute is
  // queued at most once.
  function fpCollectNewAttributes(root) {
    let added = 0;
    try {
      const found = getAttributesToTranslate(root);
      for (const at of found) {
        let set = fpTrackedAttrs.get(at.node);
        if (set && set.has(at.attrName)) continue;
        if (!set) {
          set = new Set();
          fpTrackedAttrs.set(at.node, set);
        }
        set.add(at.attrName);
        attributesToTranslate.push(at);
        added++;
      }
    } catch (e) {
      console.debug(e);
    }
    return added;
  }

  function translateNewNodes() {
    try {
      const sizeBefore = piecesToTranslate.length;
      newNodes.forEach((nn) => {
        if (removedNodes.indexOf(nn) != -1) return;

        let newPiecesToTranslate = getPiecesToTranslate(nn);

        for (const i in newPiecesToTranslate) {
          const candidateNodes = newPiecesToTranslate[i].nodes;
          // O(1) per node via WeakSet — was a full nested scan of every
          // existing piece per candidate, with no early break on a match.
          const alreadyTracked = candidateNodes.some((n) =>
            fpTrackedNodes.has(n)
          );
          if (!alreadyTracked) {
            fpTrackNodes(candidateNodes);
            piecesToTranslate.push(newPiecesToTranslate[i]);
          }
        }
      });
      // TWP-FullPage patch: if we just queued new work, wake up the
      // translation routine immediately instead of waiting for the next tick.
      // Helps SPA navigations and dynamically-injected chapter titles.
      if (piecesToTranslate.length > sizeBefore && translationRoutine_handler) {
        clearTimeout(translationRoutine_handler);
        translationRoutine_handler = setTimeout(translationRoutine, 0);
      }
    } catch (e) {
      console.error(e);
    } finally {
      newNodes = [];
      removedNodes = [];
    }
  }

  // --- TWP-FullPage: in-place text-swap detection ---------------------------
  // Several CJK reader sites swap chapter text by writing into EXISTING text
  // nodes (node.data = "...") instead of inserting new nodes. That fires no
  // childList mutation, so such swaps were invisible and stayed untranslated.
  // We now observe characterData too, with a loop guard: every text write WE
  // make (translation apply + restore) is recorded in fpLastWritten first, and
  // characterData records whose current value matches that are ignored.
  // Anything else means the SITE changed the text under us → re-queue just
  // that node as its own single-node piece, which flows through the normal
  // batching / apply / restore pipeline (so restore semantics stay correct:
  // restore already only rewrites nodes still holding our translation).
  const fpLastWritten = new WeakMap(); // text node -> last text we wrote
  const fpRequeueAt = new WeakMap(); // text node -> last requeue timestamp
  function fpNoteWrite(node, text) {
    try {
      fpLastWritten.set(node, text);
    } catch (e) { console.debug(e); }
  }
  function fpRequeueChangedTextNode(t) {
    if (!piecesToTranslate) return;
    const parent = t.parentElement;
    if (!parent) return;
    fpRequeueAt.set(t, Date.now());
    fpTrackedNodes.add(t);
    piecesToTranslate.push({
      isTranslated: false,
      parentElement: parent,
      topElement: parent,
      bottomElement: parent,
      nodes: [t],
    });
    // wake the routine so the swapped text translates promptly
    clearTimeout(translationRoutine_handler);
    translationRoutine_handler = setTimeout(translationRoutine, 0);
  }

  // TWP-FullPage patch: requeue a node whose translated result was silently
  // missing from Google's response for its batch (a documented quirk — the
  // response can reorder/merge/reuse <a i=N> markers, dropping an index with
  // no error, since the HTTP request itself succeeded). Shares fpRequeueAt's
  // cooldown with the characterData path so a node that keeps tripping the
  // same response quirk doesn't hot-loop, and caps attempts so a genuinely
  // untranslatable fragment (stray punctuation, etc.) gives up cleanly
  // instead of retrying forever.
  const fpMissingResultAttempts = new WeakMap();
  function fpNoteMissingResult(node) {
    if (!node || !node.isConnected) return;
    const text = (node.textContent || "").trim();
    // nothing worth translating (whitespace, pure punctuation/symbols)
    if (!text || !/\p{L}/u.test(text)) return;
    const last = fpRequeueAt.get(node);
    if (last !== undefined && Date.now() - last < 1500) return;
    const attempts = (fpMissingResultAttempts.get(node) || 0) + 1;
    if (attempts > 3) return; // give up after 3 tries — avoid an infinite loop
    fpMissingResultAttempts.set(node, attempts);
    fpRequeueChangedTextNode(node);
  }

  const mutationObserver = new MutationObserver(function (mutations) {
    const piecesToTranslate = [];
    const changedTextNodes = [];

    mutations.forEach((mutation) => {
      mutation.addedNodes.forEach((addedNode) => {
        const nodeName = addedNode.nodeName.toLowerCase();
        if (!isNoTranslateNode(addedNode)) {
          if (htmlTagsInlineText.indexOf(nodeName) == -1) {
            if (htmlTagsInlineIgnore.indexOf(nodeName) == -1) {
              piecesToTranslate.push(addedNode);
            }
          }
        }
      });

      mutation.removedNodes.forEach((removedNode) => {
        removedNodes.push(removedNode);
      });

      if (
        mutation.type === "characterData" &&
        pageLanguageState === "translated"
      ) {
        const t = mutation.target;
        if (
          t &&
          t.isConnected &&
          fpLastWritten.get(t) !== t.data &&
          /\p{L}/u.test(t.data || "") &&
          !isNoTranslateNode(t.parentNode) &&
          (fpRequeueAt.get(t) === undefined ||
            Date.now() - fpRequeueAt.get(t) > 1500) &&
          changedTextNodes.indexOf(t) === -1 &&
          changedTextNodes.length < 25
        ) {
          changedTextNodes.push(t);
        }
      }
    });

    piecesToTranslate.forEach((ptt) => {
      if (newNodes.indexOf(ptt) == -1) {
        newNodes.push(ptt);
      }
    });

    changedTextNodes.forEach(fpRequeueChangedTextNode);
  });

  function enableMutatinObserver() {
    disableMutatinObserver();

    if (twpConfig.get("translateDynamicallyCreatedContent") == "yes") {
      // TWP-FullPage patch: 2000ms felt sluggish on SPAs and infinite-scroll
      // feeds. 500ms is much more responsive without meaningfully more cost.
      translateNewNodesTimerHandler = setInterval(translateNewNodes, 500);
      mutationObserver.observe(document.body, {
        childList: true,
        subtree: true,
        characterData: true,
      });
    }
  }

  function disableMutatinObserver() {
    clearInterval(translateNewNodesTimerHandler);
    newNodes = [];
    removedNodes = [];
    mutationObserver.disconnect();
    mutationObserver.takeRecords();
  }

  let pageIsVisible = document.visibilityState == "visible";
  // isto faz com que partes do youtube não sejam traduzidas
  // new IntersectionObserver(entries => {
  //         if (entries[0].isIntersecting && document.visibilityState == "visible") {
  //             pageIsVisible = true
  //         } else {
  //             pageIsVisible = false
  //         }

  //         if (pageIsVisible && pageLanguageState === "translated") {
  //             enableMutatinObserver()
  //         } else {
  //             disableMutatinObserver()
  //         }
  //     }, {
  //         root: null
  //     })
  //     .observe(document.body)

  const handleVisibilityChange = function () {
    const wasInvisible = !pageIsVisible;
    if (document.visibilityState == "visible") {
      pageIsVisible = true;
    } else {
      pageIsVisible = false;
    }

    if (pageIsVisible && pageLanguageState === "translated") {
      enableMutatinObserver();
      // TWP-FullPage patch: while the tab was hidden the mutation observer
      // was off, so any content added during that time was never queued for
      // translation. Re-scan the body to catch new headings, chapter titles,
      // etc. before re-engaging.
      if (wasInvisible) {
        try {
          newNodes.push(document.body);
          translateNewNodes();
          // Wake up the routine immediately
          clearTimeout(translationRoutine_handler);
          translationRoutine_handler = setTimeout(translationRoutine, 0);
          // Title may have changed while hidden (the poll was skipping work)
          maybeRetranslateTitle();
          // Reset the safety re-sweep cadence so anything added while hidden
          // (and any slow render now resuming) is caught promptly.
          bumpResweep();
        } catch (e) {
          console.error(e);
        }
      }
    } else {
      disableMutatinObserver();
    }
  };
  document.addEventListener("visibilitychange", handleVisibilityChange, false);

  // --- TWP-FullPage: adaptive safety re-sweep -------------------------------
  // The MutationObserver on document.body cannot see mutations made *inside*
  // shadow roots after load, subtrees that are built detached and re-attached,
  // or very slow client-side renders. To guarantee nothing stays untranslated,
  // this periodically re-walks document.body through the SAME identity-deduped
  // pipeline (translateNewNodes), so already-translated nodes are never re-sent.
  // It runs often right after load and then backs off on a static page; a
  // scroll or a return to the tab resets the cadence so freshly revealed
  // content (lazy-load / infinite scroll) is picked up promptly.
  let _resweepTimer = null;
  let _resweepDelay = 1500;
  let _adaptiveResweepStarted = false;
  let _lastHref = location.href;
  const _RESWEEP_MIN = 1500;
  const _RESWEEP_MAX = 10000;
  function _runResweep() {
    // SPA chapter navigation (history.pushState) changes the URL without a
    // reload. A content script can't intercept the page's pushState directly,
    // but this zero-cost href check inside the existing tick — combined with
    // the popstate listener below — means a new chapter snaps the cadence
    // back to fast instead of waiting out the backoff.
    if (location.href !== _lastHref) {
      _lastHref = location.href;
      _resweepDelay = _RESWEEP_MIN;
      if (pageLanguageState === "translated") maybeRetranslateTitle();
    }
    if (pageLanguageState === "translated" && pageIsVisible) {
      // Marathon-session compaction: translated pieces whose every node has
      // left the DOM (old chapters in infinite scroll) can never be restored
      // visibly — drop them so the routine's per-tick scan and memory stay
      // bounded. The tracking WeakSet keeps re-attached nodes deduped, so a
      // virtual scroller re-adding an old node won't get re-translated.
      if (piecesToTranslate.length > 3000) {
        piecesToTranslate = piecesToTranslate.filter(
          (p) => !p.isTranslated || p.nodes.some((n) => n.isConnected)
        );
      }
      if (attributesToTranslate.length > 3000) {
        attributesToTranslate = attributesToTranslate.filter(
          (a) => !a.isTranslated || (a.node && a.node.isConnected)
        );
      }
      if (nodesToRestore.length > 8000) {
        nodesToRestore = nodesToRestore.filter(
          (ntr) =>
            (ntr.node && ntr.node.isConnected) ||
            (ntr.original && ntr.original.isConnected)
        );
      }

      const before = piecesToTranslate.length;
      try {
        newNodes.push(document.body);
        translateNewNodes();
      } catch (e) {
        console.error(e);
      }
      // Attributes (placeholder/title/aria-label…) on dynamically-added
      // controls — collected with per-element dedupe, so this is cheap when
      // nothing new appeared.
      let attrsAdded = 0;
      try {
        attrsAdded = fpCollectNewAttributes(document.body);
        if (attrsAdded > 0 && translationRoutine_handler) {
          clearTimeout(translationRoutine_handler);
          translationRoutine_handler = setTimeout(translationRoutine, 0);
        }
      } catch (e) {
        console.debug(e);
      }
      const grew = piecesToTranslate.length > before || attrsAdded > 0;
      // found new work → keep checking fast; nothing new → slow down
      _resweepDelay = grew
        ? _RESWEEP_MIN
        : Math.min(_RESWEEP_MAX, Math.round(_resweepDelay * 1.6));
    } else {
      // original view or hidden tab: don't walk, just poll back cheaply
      _resweepDelay = _RESWEEP_MAX;
    }
    _resweepTimer = setTimeout(_runResweep, _resweepDelay);
  }
  function bumpResweep() {
    if (!_adaptiveResweepStarted) return;
    _resweepDelay = _RESWEEP_MIN;
    if (_resweepTimer) clearTimeout(_resweepTimer);
    _resweepTimer = setTimeout(_runResweep, 250);
  }
  function startAdaptiveResweep() {
    if (_adaptiveResweepStarted) {
      bumpResweep();
      return;
    }
    _adaptiveResweepStarted = true;
    let scrollDebounce = null;
    window.addEventListener(
      "scroll",
      () => {
        if (pageLanguageState !== "translated") return;
        clearTimeout(scrollDebounce);
        scrollDebounce = setTimeout(bumpResweep, 400);
      },
      { passive: true }
    );
    // back/forward SPA navigation
    window.addEventListener("popstate", () => {
      if (pageLanguageState === "translated") bumpResweep();
    });
    // re-translate after a restore → catch anything added while original
    pageTranslator.onPageLanguageStateChange((state) => {
      if (state === "translated") bumpResweep();
    });
    _resweepTimer = setTimeout(_runResweep, _resweepDelay);
  }

  /**
   *
   * @param {HTMLElement} node
   * @returns
   */
  function isNoTranslateNode(node) {
    const nodeName = node.nodeName.toLowerCase();
    const index = htmlTagsNoTranslate.indexOf(nodeName);

    //https://github.com/FilipePS/Traduzir-paginas-web/issues/704
    if (nodeName === "span" && node.classList.contains("mjx-chtml")) {
      return true;
    } else if (index === -1) {
      return false;
    } else {
      // https://github.com/FilipePS/Traduzir-paginas-web/issues/654
      if (
        nodeName === "script" &&
        node.getAttribute("data-spotim-module") === "spotim-launcher" &&
        [...node.childNodes].find((node) => node.nodeType === 1)
      ) {
        return false;
      } else {
        return true;
      }
    }
  }

  function getPiecesToTranslate(root = document.documentElement) {
    // TWP-FullPage patch: detect tag-like <a> elements that should each be
    // translated in isolation. When several short links sit next to each other
    // (tag clouds, chip rows, hashtags), Google's translate-pa endpoint
    // translates them as one running phrase and scrambles which translated
    // fragment maps back to which link — producing stray commas, merged words,
    // and mislabeled tags. Isolating each one fixes the mapping.
    // A "tag token" = #foo / @bar in any language. The charset is deliberately
    // broad so real-world tags survive the boundary test: hyphens, underscores,
    // dots, plus/hash/ampersand/apostrophe/slash ("#sci-fi", "#C++",
    // "#anime_2024", "#动作片", "@user"). PURE_TAGS_RE matches text that is
    // ENTIRELY tag tokens — one OR several — separated by spaces, commas
    // (incl. CJK ，、), middots, pipes or slashes, with optional trailing
    // punctuation ("#A #B #C", "#动作, #冒险", "#tag·").
    const TAG_TOKEN = "[#@][\\p{L}\\p{N}_+#'&./\\-]+";
    const PURE_TAGS_RE = new RegExp(
      "^" + TAG_TOKEN + "(?:[\\s,，、・·|/]+" + TAG_TOKEN + ")*[\\s,，、・·|/.]*$",
      "u"
    );
    const isHashtagText = (t) => t.length > 0 && PURE_TAGS_RE.test(t);

    function isStandaloneTagAnchor(node) {
      if (!node || node.nodeType !== 1) return false;
      const tag = node.nodeName.toLowerCase();
      // Only inline wrappers are candidates here; block/structural elements
      // already force a piece break on their own.
      if (htmlTagsInlineText.indexOf(tag) === -1) return false;
      const txt = (node.textContent || "").trim();
      if (txt.length < 1 || txt.length > 140) return false;

      // A tag chip (pure hashtag/mention content) is isolated in ANY inline
      // element — <a>, <span>, <b>… — so each tag translates on its own and is
      // never clumped with its neighbours. This is the common cause of tags
      // running together: sites that wrap each tag in its own <span> rather
      // than an <a>. A standalone LINK (any short text) is isolated too, but
      // only when it is an <a>.
      const isTags = isHashtagText(txt);
      const isStandaloneLink = tag === "a" && txt.length <= 120;
      if (!isTags && !isStandaloneLink) return false;

      // Never pull a tag/link out of running prose. For tag clouds, nav rows
      // and chapter lists the neighbours are other tags/links, separators
      // (",", "·", "|", ">") or whitespace — never sentence text. A footnote
      // marker like "#1" sitting inside a sentence DOES have prose neighbours,
      // so it correctly stays in context instead of being split out.
      function sibIsProse(s) {
        if (!s) return false;
        if (s.nodeType === 3) return /\p{L}/u.test(s.textContent || "");
        if (s.nodeType === 1) {
          const tn = s.nodeName.toLowerCase();
          if (htmlTagsInlineText.indexOf(tn) !== -1) {
            const stxt = (s.textContent || "").trim();
            // a neighbouring tag chip or link is NOT prose
            if (isHashtagText(stxt)) return false;
            if (tn === "a") return false;
            return /\p{L}/u.test(stxt);
          }
        }
        return false;
      }
      if (sibIsProse(node.previousSibling)) return false;
      if (sibIsProse(node.nextSibling)) return false;
      return true;
    }

    const piecesToTranslate = [
      {
        isTranslated: false,
        parentElement: null,
        topElement: null,
        bottomElement: null,
        nodes: [],
      },
    ];
    let index = 0;
    let currentParagraphSize = 0;

    const getAllNodes = function (
      node,
      lastHTMLElement = null,
      lastSelectOrDataListElement = null
    ) {
      if (node.nodeType == 1 || node.nodeType == 11) {
        if (node.nodeType == 11) {
          lastHTMLElement = node.host;
          lastSelectOrDataListElement = null;
        } else if (node.nodeType == 1) {
          lastHTMLElement = node;
          const nodeName = node.nodeName.toLowerCase();

          if (nodeName === "select" || nodeName === "datalist")
            lastSelectOrDataListElement = node;

          if (
            htmlTagsInlineIgnore.indexOf(nodeName) !== -1 ||
            isNoTranslateNode(node) ||
            // TWP-FullPage patch: `translate="no"` / class="notranslate" are
            // normally honored as "site author opted this out" — correct for
            // a general-purpose page translator. But for this reading tool
            // the goal is maximum coverage, and some CMS templates apply
            // these to whole chapter wrappers (inherited from a template, or
            // to stop the browser's built-in translate from mangling inline
            // formatting) — which permanently blanked out real content, not
            // just delayed it, so a manual retry could never fix it either.
            // Deliberately NOT honored here. isContentEditable is still
            // honored below — that protects actual input widgets (comment
            // boxes) you'd want to type into, which is a different case.
            node.isContentEditable ||
            node.classList.contains("CodeMirror") || // https://www.w3schools.com/html/tryit.asp
            node.classList.contains("material-icons") || // https://github.com/FilipePS/Traduzir-paginas-web/issues/481
            node.classList.contains("material-symbols-outlined") ||
            nodeName.startsWith("br-") || // https://github.com/FilipePS/Traduzir-paginas-web/issues/627
            node.getAttribute("id") === "branch-select-menu" || // https://github.com/FilipePS/Traduzir-paginas-web/issues/570
            (location.hostname === "twitter.com" &&
              nodeName === "a" &&
              (node.matches ? node.matches("article a") : true)) // https://github.com/FilipePS/Traduzir-paginas-web/issues/449
          ) {
            if (piecesToTranslate[index].nodes.length > 0) {
              currentParagraphSize = 0;
              piecesToTranslate[index].bottomElement = lastHTMLElement;
              piecesToTranslate.push({
                isTranslated: false,
                parentElement: null,
                topElement: null,
                bottomElement: null,
                nodes: [],
              });
              index++;
            }
            return;
          }
        }

        function getAllChilds(childNodes) {
          Array.from(childNodes).forEach((_node) => {
            const nodeName = _node.nodeName.toLowerCase();

            if (_node.nodeType == 1) {
              lastHTMLElement = _node;
              if (nodeName === "select" || nodeName === "datalist")
                lastSelectOrDataListElement = _node;
            }

            if (
              htmlTagsInlineText.indexOf(nodeName) == -1 ||
              isStandaloneTagAnchor(_node)
            ) {
              if (piecesToTranslate[index].nodes.length > 0) {
                currentParagraphSize = 0;
                piecesToTranslate[index].bottomElement = lastHTMLElement;
                piecesToTranslate.push({
                  isTranslated: false,
                  parentElement: null,
                  topElement: null,
                  bottomElement: null,
                  nodes: [],
                });
                index++;
              }

              getAllNodes(_node, lastHTMLElement, lastSelectOrDataListElement);

              if (piecesToTranslate[index].nodes.length > 0) {
                currentParagraphSize = 0;
                piecesToTranslate[index].bottomElement = lastHTMLElement;
                piecesToTranslate.push({
                  isTranslated: false,
                  parentElement: null,
                  topElement: null,
                  bottomElement: null,
                  nodes: [],
                });
                index++;
              }
            } else {
              getAllNodes(_node, lastHTMLElement, lastSelectOrDataListElement);
            }
          });
        }

        getAllChilds(node.childNodes);
        if (!piecesToTranslate[index].bottomElement) {
          piecesToTranslate[index].bottomElement = node;
        }
        if (node.shadowRoot) {
          getAllChilds(node.shadowRoot.childNodes);
          if (!piecesToTranslate[index].bottomElement) {
            piecesToTranslate[index].bottomElement = node;
          }
        }
      } else if (node.nodeType == 3) {
        if (node.textContent.trim().length > 0) {
          if (!piecesToTranslate[index].parentElement) {
            if (
              node &&
              node.parentNode &&
              node.parentNode.nodeName.toLowerCase() === "option" &&
              lastSelectOrDataListElement
            ) {
              piecesToTranslate[index].parentElement =
                lastSelectOrDataListElement;
              piecesToTranslate[index].bottomElement =
                lastSelectOrDataListElement;
              piecesToTranslate[index].topElement = lastSelectOrDataListElement;
            } else {
              let temp = node.parentNode;
              const nodeName = temp.nodeName.toLowerCase();
              while (
                temp &&
                temp != root &&
                (htmlTagsInlineText.indexOf(nodeName) != -1 ||
                  htmlTagsInlineIgnore.indexOf(nodeName) != -1)
              ) {
                temp = temp.parentNode;
              }
              if (temp && temp.nodeType === 11) {
                temp = temp.host;
              }
              piecesToTranslate[index].parentElement = temp;
            }
          }
          if (!piecesToTranslate[index].topElement) {
            piecesToTranslate[index].topElement = lastHTMLElement;
          }
          if (currentParagraphSize > 1000) {
            currentParagraphSize = 0;
            piecesToTranslate[index].bottomElement = lastHTMLElement;
            const pieceInfo = {
              isTranslated: false,
              parentElement: null,
              topElement: lastHTMLElement,
              bottomElement: null,
              nodes: [],
            };
            pieceInfo.parentElement = piecesToTranslate[index].parentElement;
            piecesToTranslate.push(pieceInfo);
            index++;
          }
          currentParagraphSize += node.textContent.length;
          piecesToTranslate[index].nodes.push(node);
          piecesToTranslate[index].bottomElement = null;
        }
      }
    };
    getAllNodes(root);

    if (
      piecesToTranslate.length > 0 &&
      piecesToTranslate[piecesToTranslate.length - 1].nodes.length == 0
    ) {
      piecesToTranslate.pop();
    }

    return piecesToTranslate;
  }

  function getAttributesToTranslate(root = document.body) {
    const attributesToTranslate = [];

    const placeholdersElements = root.querySelectorAll(
      "input[placeholder], textarea[placeholder]"
    );
    const altElements = root.querySelectorAll(
      'area[alt], img[alt], input[type="image"][alt]'
    );
    const valueElements = root.querySelectorAll(
      'input[type="button"], input[type="submit"], input[type="reset"]'
    );
    const titleElements = root.querySelectorAll("body [title]");

    function hasNoTranslate(elem) {
      // TWP-FullPage patch: translate="no" / notranslate no longer honored
      // here either, for the same max-coverage reason as the main text walk
      // — see the comment at the piece-building exclusion above.
      return false;
    }

    placeholdersElements.forEach((e) => {
      if (hasNoTranslate(e)) return;

      const txt = e.getAttribute("placeholder");
      if (txt && txt.trim()) {
        attributesToTranslate.push({
          node: e,
          original: txt,
          attrName: "placeholder",
        });
      }
    });

    altElements.forEach((e) => {
      if (hasNoTranslate(e)) return;

      const txt = e.getAttribute("alt");
      if (txt && txt.trim()) {
        attributesToTranslate.push({
          node: e,
          original: txt,
          attrName: "alt",
        });
      }
    });

    valueElements.forEach((e) => {
      if (hasNoTranslate(e)) return;

      const txt = e.getAttribute("value");
      if (e.type == "submit" && !txt) {
        attributesToTranslate.push({
          node: e,
          original: "Submit Query",
          attrName: "value",
        });
      } else if (e.type == "reset" && !txt) {
        attributesToTranslate.push({
          node: e,
          original: "Reset",
          attrName: "value",
        });
      } else if (txt && txt.trim()) {
        attributesToTranslate.push({
          node: e,
          original: txt,
          attrName: "value",
        });
      }
    });

    titleElements.forEach((e) => {
      if (hasNoTranslate(e)) return;

      const txt = e.getAttribute("title");
      if (txt && txt.trim()) {
        attributesToTranslate.push({
          node: e,
          original: txt,
          attrName: "title",
        });
      }
    });

    // TWP-FullPage patch: aria-label often holds visible-ish control text
    // (icon buttons like "Next chapter", "Bookmark", "Add to library") that
    // the original code left untranslated.
    const ariaLabelElements = root.querySelectorAll("body [aria-label]");
    ariaLabelElements.forEach((e) => {
      if (hasNoTranslate(e)) return;
      const txt = e.getAttribute("aria-label");
      if (txt && txt.trim()) {
        attributesToTranslate.push({
          node: e,
          original: txt,
          attrName: "aria-label",
        });
      }
    });

    return attributesToTranslate;
  }

  // encapsular o texto faz com que do video suma
  // ao utilizar função como Pai.removeChild(filho)
  // pode ser gerado um erro ao encapsular
  function encapsulateTextNode(node) {
    const fontNode = document.createElement("font");
    fontNode.setAttribute("style", "vertical-align: inherit;");
    fontNode.textContent = node.textContent;

    node.replaceWith(fontNode);

    return fontNode;
  }

  function translateTextContent(node, parentNode, text, toRestore) {
    toRestore.translatedText = text;
    // Loop guard for characterData observation: record what WE are writing so
    // the mutation observer can tell our writes apart from the site's.
    fpNoteWrite(node, text);

    if (location.hostname === "pdf.translatewebpages.org") {
      if (
        parentNode &&
        parentNode.nodeName.toLowerCase() === "span" &&
        parentNode.getAttribute("role") === "presentation"
      ) {
        const oldClientWidth = node.parentNode.clientWidth;
        node.textContent = text;
        const newClientWidth = node.parentNode.clientWidth;
        const transformMatch = parentNode.style.transform.match(
          /[0-9]+[\.]{1,1}[0-9]*/
        );
        const currentScaleX = transformMatch
          ? parseFloat(transformMatch[0])
          : 1.0;
        toRestore.originalScale = currentScaleX;
        parentNode.style.transform = `scaleX(${
          currentScaleX *
          Math.min(currentScaleX, oldClientWidth / newClientWidth)
        })`;
      } else {
        node.textContent = text;
      }
    } else {
      node.textContent = text;
    }
  }

  function translateResults(piecesToTranslateNow, results) {
    if (dontSortResults) {
      for (let i = 0; i < results.length; i++) {
        for (let j = 0; j < results[i].length; j++) {
          if (piecesToTranslateNow[i].nodes[j] && results[i][j]) {
            const nodes = piecesToTranslateNow[i].nodes;
            let translated = results[i][j] + " ";
            // In some case, results items count is over original node count
            // Rest results append to last node
            if (
              piecesToTranslateNow[i].nodes.length - 1 === j &&
              results[i].length > j
            ) {
              const restResults = results[i].slice(j + 1);
              translated += restResults.join(" ");
            }

            const originalTextNode = nodes[j];
            const parentNode = nodes[j].parentNode;
            if (showOriginal.isEnabled) {
              nodes[j] = encapsulateTextNode(nodes[j]);
              showOriginal.add(nodes[j]);
            }

            const toRestore = {
              node: nodes[j],
              original: originalTextNode,
              originalText: originalTextNode.textContent,
              translatedText: translated,
              originalScale: null,
              parentNode,
            };
            nodesToRestore.push(toRestore);

            const originalText = originalTextNode.textContent;
            handleCustomWords(
              translated,
              nodes[j].textContent,
              customDictionary,
              currentPageTranslatorService,
              currentSourceLanguage,
              currentTargetLanguage
            ).then((results) => {
              // results = `${originalText.match(/^\s*/)[0]}${results.trim()}${
              //   originalText.match(/\s*$/)[0]
              // }`;
              translateTextContent(nodes[j], parentNode, results, toRestore);
            });
          } else if (piecesToTranslateNow[i].nodes[j] && !results[i][j]) {
            // TWP-FullPage patch: same silently-dropped-index issue as the
            // sorted branch below — requeue instead of leaving it untranslated
            // (this branch previously had no guard at all, so a missing
            // result would render the literal string "undefined" on the page).
            fpNoteMissingResult(piecesToTranslateNow[i].nodes[j]);
          }
        }
      }
    } else {
      for (const i in piecesToTranslateNow) {
        for (const j in piecesToTranslateNow[i].nodes) {
          if (results[i][j]) {
            const nodes = piecesToTranslateNow[i].nodes;
            const translated = results[i][j] + " ";

            const originalTextNode = nodes[j];
            const parentNode = nodes[j].parentNode;
            if (showOriginal.isEnabled) {
              nodes[j] = encapsulateTextNode(nodes[j]);
              showOriginal.add(nodes[j]);
            }

            const toRestore = {
              node: nodes[j],
              original: originalTextNode,
              originalText: originalTextNode.textContent,
              translatedText: translated,
              parentNode,
            };
            nodesToRestore.push(toRestore);

            const originalText = originalTextNode.textContent;
            handleCustomWords(
              translated,
              nodes[j].textContent,
              customDictionary,
              currentPageTranslatorService,
              currentSourceLanguage,
              currentTargetLanguage
            ).then((results) => {
              // results = `${originalText.match(/^\s*/)[0]}${results.trim()}${
              //   originalText.match(/\s*$/)[0]
              // }`;
              translateTextContent(nodes[j], parentNode, results, toRestore);
            });
          } else {
            // TWP-FullPage patch: Google's response can reorder, merge, or
            // reuse <a i=N> markers within a batch (documented above), which
            // silently drops the result for that index — a genuine HTTP 200,
            // so none of the retry/backoff logic ever sees a failure. Left
            // as-is, that paragraph stays untranslated forever with zero
            // trace. Requeue the node for another attempt instead of losing
            // it silently. fpRequeueAt's cooldown (shared with the
            // characterData path) prevents a hot retry loop if this
            // particular text keeps tripping the same response quirk.
            fpNoteMissingResult(piecesToTranslateNow[i].nodes[j]);
          }
        }
      }
    }

    mutationObserver.takeRecords();
  }

  function translateAttributes(attributesToTranslateNow, results) {
    for (const i in attributesToTranslateNow) {
      const ati = attributesToTranslateNow[i];
      // TWP-FullPage patch: same dropped-index issue as translateResults —
      // without this guard, a missing result would literally set the
      // attribute to the string "undefined" (setAttribute coerces to string).
      if (results[i]) {
        ati.node.setAttribute(ati.attrName, results[i]);
      }
    }
  }

  function translationRoutine() {
    try {
      if (piecesToTranslate && pageIsVisible) {
        (function () {
          if (piecesToTranslate.length < 1) return;
          const innerHeight = window.innerHeight;

          function isInScreen(element) {
            const rect = element.getBoundingClientRect();
            if (
              (rect.top > 0 && rect.top <= innerHeight) ||
              (rect.bottom > 0 && rect.bottom <= innerHeight)
            ) {
              return true;
            }
            return false;
          }

          function topIsInScreen(element) {
            if (!element) {
              // debugger;
              return false;
            }
            const rect = element.getBoundingClientRect();
            if (rect.top > 0 && rect.top <= innerHeight) {
              return true;
            }
            return false;
          }

          function bottomIsInScreen(element) {
            if (!element) {
              // debugger;
              return false;
            }
            const rect = element.getBoundingClientRect();
            if (rect.bottom > 0 && rect.bottom <= innerHeight) {
              return true;
            }
            return false;
          }

          const currentFooCount = fooCount;

          // TWP-FullPage patch: queue every untranslated piece, regardless of
          // viewport. Higher per-tick caps mean long pages finish in far fewer
          // ticks; the background concurrency limiter keeps this from tripping
          // rate limits.
          const MAX_PIECES_PER_TICK = 100;
          const MAX_ATTRS_PER_TICK = 100;

          const piecesToTranslateNow = [];
          for (const ptt of piecesToTranslate) {
            if (piecesToTranslateNow.length >= MAX_PIECES_PER_TICK) break;
            if (!ptt.isTranslated) {
              ptt.isTranslated = true;
              piecesToTranslateNow.push(ptt);
            }
          }

          const attributesToTranslateNow = [];
          for (const ati of attributesToTranslate) {
            if (attributesToTranslateNow.length >= MAX_ATTRS_PER_TICK) break;
            if (!ati.isTranslated) {
              ati.isTranslated = true;
              attributesToTranslateNow.push(ati);
            }
          }

          if (piecesToTranslateNow.length > 0) {
            backgroundTranslateHTML(
              currentPageTranslatorService,
              currentSourceLanguage,
              currentTargetLanguage,
              piecesToTranslateNow.map((ptt) =>
                ptt.nodes.map((node) =>
                  filterKeywordsInText(
                    node.textContent,
                    customDictionary,
                    currentPageTranslatorService
                  )
                )
              ),
              dontSortResults
            ).then((results) => {
              if (
                pageLanguageState === "translated" &&
                currentFooCount === fooCount
              ) {
                translateResults(piecesToTranslateNow, results);
              }
            });
          }

          if (attributesToTranslateNow.length > 0) {
            backgroundTranslateText(
              currentPageTranslatorService,
              currentSourceLanguage,
              currentTargetLanguage,
              attributesToTranslateNow.map((ati) => ati.original)
            ).then((results) => {
              if (
                pageLanguageState === "translated" &&
                currentFooCount === fooCount
              ) {
                translateAttributes(attributesToTranslateNow, results);
              }
            });
          }
        })();
      }
    } catch (e) {
      console.error(e);
    }

    // TWP-FullPage patch: adaptive interval. Run fast (150ms) when there's
    // untranslated work so long pages drain quickly, slow (2000ms) when idle.
    clearTimeout(translationRoutine_handler);
    let nextDelay = 2000;
    if (piecesToTranslate && piecesToTranslate.length > 0) {
      for (const ptt of piecesToTranslate) {
        if (!ptt.isTranslated) {
          nextDelay = 150;
          break;
        }
      }
    }
    translationRoutine_handler = setTimeout(translationRoutine, nextDelay);
  }

  translationRoutine();

  // TWP-FullPage patch: small in-memory cache of title translations. Sites
  // that cycle their title (notification counts, chapter switchers) would
  // otherwise trigger a background round-trip on every change. Caps at 50
  // entries so it can't grow unbounded.
  const titleTranslationCache = new Map();

  function translateTitleString(textToTranslate) {
    const cacheKey =
      currentSourceLanguage + ">" + currentTargetLanguage + ":" + textToTranslate;
    const cached = titleTranslationCache.get(cacheKey);
    if (cached) return Promise.resolve(cached);
    return backgroundTranslateHTML(
      currentPageTranslatorService,
      currentSourceLanguage,
      currentTargetLanguage,
      [[textToTranslate, " "]],
      false
    ).then((results) => {
      if (!results || !results[0]) return null;
      const out = results[0][0];
      if (out && out !== textToTranslate) {
        if (titleTranslationCache.size > 50) {
          titleTranslationCache.clear();
        }
        titleTranslationCache.set(cacheKey, out);
      }
      return out;
    });
  }

  // TWP-FullPage patch: write the tab title via both methods. Chrome watches
  // the <title> element for mutations; setting document.title updates that
  // element's text, but writing the element's textContent directly as well
  // increases the odds the tab actually updates on sites that fight back.
  function applyTabTitle(text) {
    try {
      document.title = text;
    } catch (e) { console.debug(e); }
    try {
      let titleEl = document.querySelector("title");
      if (!titleEl) {
        titleEl = document.createElement("title");
        (document.head || document.documentElement).prepend(titleEl);
      }
      if (titleEl.textContent !== text) {
        titleEl.textContent = text;
      }
    } catch (e) { console.debug(e); }
  }

  function translatePageTitle() {
    const title = document.querySelector("title");
    // TWP-FullPage patch: translate="no" / notranslate no longer honored on
    // the title either — same max-coverage reasoning as the main walk above.
    if (!title) {
      return;
    }
    if (document.title.trim().length < 1) return;
    originalPageTitle = document.title;

    translateTitleString(originalPageTitle)
      .then((result) => {
        if (result && result !== originalPageTitle) {
          translatedPageTitle = result;
          applyTabTitle(result);
        }
      })
      .catch(() => {});
  }

  // TWP-FullPage patch: many sites (sangtacviet, SPAs, anything with
  // notification counts) rewrite document.title via JS after load, which
  // overwrites our translated title. Watch for that and re-translate. Uses a
  // MutationObserver plus a 1.5s polling fallback for sites whose title writes
  // don't reliably trigger observers.
  let titlePollHandle = null;

  function maybeRetranslateTitle() {
    if (pageLanguageState !== "translated") return;
    if (!pageIsVisible) return;
    const current = document.title;
    if (!current || current.trim().length < 1) return;
    if (current === translatedPageTitle) return;
    originalPageTitle = current;
    translateTitleString(current)
      .then((result) => {
        if (!result) return;
        if (pageLanguageState !== "translated") return;
        if (result === current) return;
        translatedPageTitle = result;
        if (document.title !== result) {
          applyTabTitle(result);
        }
      })
      .catch(() => {});
  }

  function setupTitleObserver() {
    if (titleMutationObserver) return;
    titleMutationObserver = new MutationObserver(maybeRetranslateTitle);
    const head = document.head || document.querySelector("head");
    if (head) {
      titleMutationObserver.observe(head, {
        childList: true,
        subtree: true,
        characterData: true,
      });
    }
    if (titlePollHandle) clearInterval(titlePollHandle);
    titlePollHandle = setInterval(maybeRetranslateTitle, 1500);
  }

  function teardownTitleObserver() {
    if (titleMutationObserver) {
      titleMutationObserver.disconnect();
      titleMutationObserver = null;
    }
    if (titlePollHandle) {
      clearInterval(titlePollHandle);
      titlePollHandle = null;
    }
    translatedPageTitle = null;
  }

  const pageLanguageStateObservers = [];

  pageTranslator.onPageLanguageStateChange = function (callback) {
    pageLanguageStateObservers.push(callback);
  };

  var translationRoutine_handler = null;

  pageTranslator.translatePage = function (targetLanguage) {
    fooCount++;
    pageTranslator.restorePage();
    showOriginal.enable();

    // TWP-FullPage patch: mirror how Chrome/Arc's native translate works —
    // it detects the page's language ONCE (browser-level CLD) and locks the
    // whole page's translation to that single language, rather than asking
    // per request. This extension already detects once (originalTabLanguage,
    // via detectTabLanguage, resolved before translatePage runs) — but was
    // still sending sl="auto" on every batch by default, letting Google's
    // server re-guess the language independently for each small chunk. On
    // mixed-content pages (a loanword, a romanized name, a quoted line) that
    // let some batches get silently mis-detected and skipped/mistranslated
    // while the rest of the page translated fine. Only kicks in when nothing
    // was explicitly chosen — an explicit pick (via Improve translation or
    // the bubble's From selector, saved per-host) is never overridden.
    if (
      currentSourceLanguage === "auto" &&
      originalTabLanguage &&
      originalTabLanguage !== "und"
    ) {
      currentSourceLanguage = originalTabLanguage;
    }

    chrome.runtime.sendMessage(
      { action: "removeTranslationsWithError" },
      checkedLastError
    );

    if (targetLanguage) {
      currentTargetLanguage = targetLanguage;
    }

    customDictionary = sortDictionary(twpConfig.get("customDictionary"));

    // https://github.com/FilipePS/Traduzir-paginas-web/issues/619
    if (
      location.hostname === "sberbank.com" ||
      location.hostname === "www.sberbank.com"
    ) {
      document.body.classList.remove("notranslate");
    }

    if (location.hostname === "pdf.translatewebpages.org") {
      document.getElementById("scaleSelect").value = "1.5";
      document.getElementById("scaleSelect").dispatchEvent(new Event("change"));
    }

    piecesToTranslate = getPiecesToTranslate();
    attributesToTranslate = getAttributesToTranslate();
    // Rebuild dedupe tracking for the new translate cycle (a fresh WeakSet so
    // nodes from a previous cycle that left and re-entered the DOM aren't
    // wrongly considered tracked).
    fpTrackedNodes = new WeakSet();
    for (const p of piecesToTranslate) fpTrackNodes(p.nodes);
    fpTrackedAttrs = new WeakMap();
    for (const at of attributesToTranslate) {
      let s = fpTrackedAttrs.get(at.node);
      if (!s) {
        s = new Set();
        fpTrackedAttrs.set(at.node, s);
      }
      s.add(at.attrName);
    }

    pageLanguageState = "translated";
    chrome.runtime.sendMessage(
      {
        action: "setPageLanguageState",
        pageLanguageState,
      },
      checkedLastError
    );
    pageLanguageStateObservers.forEach((callback) =>
      callback(pageLanguageState)
    );
    currentPageLanguage = currentTargetLanguage;

    translatePageTitle();
    setupTitleObserver();

    enableMutatinObserver();

    translationRoutine();

    // TWP-FullPage patch: auto-translate fires very early in the page
    // lifecycle (150ms after content-script load). React/Vue/Angular and
    // similar frameworks often haven't finished rendering yet, so the
    // initial getPiecesToTranslate() walk misses chunks of the eventual
    // page. The mutation observer is supposed to catch later additions but
    // has timing gaps. Do a couple of deliberate re-sweeps of document.body
    // to catch what was missed: one when window 'load' fires (all subresources
    // done) and another 2s later (catches slow client-side rendering).
    const scheduleReSweep = (delay) => {
      setTimeout(() => {
        if (pageLanguageState !== "translated") return;
        try {
          newNodes.push(document.body);
          translateNewNodes();
        } catch (e) {
          console.error(e);
        }
      }, delay);
    };
    if (document.readyState === "complete") {
      scheduleReSweep(0);
    } else {
      window.addEventListener("load", () => scheduleReSweep(0), { once: true });
    }
    scheduleReSweep(2000);

    // Ongoing safety net for shadow-DOM / re-attached / slow-render content.
    startAdaptiveResweep();
  };

  pageTranslator.restorePage = function () {
    fooCount++;
    piecesToTranslate = [];

    showOriginal.disable();
    disableMutatinObserver();

    pageLanguageState = "original";
    chrome.runtime.sendMessage(
      {
        action: "setPageLanguageState",
        pageLanguageState,
      },
      checkedLastError
    );
    pageLanguageStateObservers.forEach((callback) =>
      callback(pageLanguageState)
    );
    currentPageLanguage = originalTabLanguage;

    if (originalPageTitle) {
      document.title = originalPageTitle;
    }
    originalPageTitle = null;
    teardownTitleObserver();

    for (const ntr of nodesToRestore) {
      if (ntr.node === ntr.original) {
        if (ntr.node.textContent === ntr.translatedText) {
          fpNoteWrite(ntr.node, ntr.originalText);
          ntr.node.textContent = ntr.originalText;
        }
      } else {
        ntr.node.replaceWith(ntr.original);
      }
      if (ntr.originalScale) {
        ntr.parentNode.style.transform = `scaleX(${ntr.originalScale}`;
      }
    }
    nodesToRestore = [];

    //TODO não restaurar atributos que foram modificados
    for (const ati of attributesToTranslate) {
      if (ati.isTranslated) {
        ati.node.setAttribute(ati.attrName, ati.original);
      }
    }
    attributesToTranslate = [];
  };

  pageTranslator.swapTranslationService = function (newServiceName) {
    currentPageTranslatorService = newServiceName;
    if (pageLanguageState === "translated") {
      pageTranslator.translatePage();
    }
  };

  pageTranslator.improveTranslation = function (info) {
    currentPageTranslatorService = info.pageTranslatorService;
    dontSortResults = info.dontSortResults === "yes" ? true : false;
    currentSourceLanguage = info.sourceLanguage;
    // TWP-FullPage patch: remember this source language for this hostname so
    // the next page load on the same site doesn't fall back to auto-detect.
    try {
      const host = location.hostname;
      if (host) {
        const savedMap = Object.assign(
          {},
          twpConfig.get("fpSourceLangByHost") || {}
        );
        if (info.sourceLanguage && info.sourceLanguage !== "auto") {
          savedMap[host] = info.sourceLanguage;
        } else {
          delete savedMap[host];
        }
        twpConfig.set("fpSourceLangByHost", savedMap);
      }
    } catch (e) { console.debug(e); }
    if (pageLanguageState === "translated") {
      pageTranslator.translatePage(info.targetLanguage);
    }
  };

  let alreadyGotTheLanguage = false;
  const observers = [];

  pageTranslator.onGetOriginalTabLanguage = function (callback) {
    if (alreadyGotTheLanguage) {
      callback(originalTabLanguage);
    } else {
      observers.push(callback);
    }
  };

  let textContentLanguageDetectionPromise = null;

  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "translatePage") {
      if (request.targetLanguage === "original") {
        pageTranslator.restorePage();
      } else {
        pageTranslator.translatePage(request.targetLanguage);
      }
    } else if (request.action === "restorePage") {
      pageTranslator.restorePage();
    } else if (request.action === "getOriginalTabLanguage") {
      pageTranslator.onGetOriginalTabLanguage(function () {
        sendResponse(originalTabLanguage);
      });
      return true;
    } else if (request.action === "getCurrentPageLanguage") {
      sendResponse(currentPageLanguage);
    } else if (request.action === "getCurrentPageLanguageState") {
      sendResponse(pageLanguageState);
    } else if (request.action === "getCurrentPageTranslatorService") {
      sendResponse(currentPageTranslatorService);
    } else if (request.action === "swapTranslationService") {
      pageTranslator.swapTranslationService(request.newServiceName);
    } else if (request.action === "toggle-translation") {
      if (pageLanguageState === "translated") {
        pageTranslator.restorePage();
      } else {
        pageTranslator.translatePage();
      }
    } else if (request.action === "autoTranslateBecauseClickedALink") {
      if (twpConfig.get("autoTranslateWhenClickingALink") === "yes") {
        pageTranslator.onGetOriginalTabLanguage(function () {
          if (
            pageLanguageState === "original" &&
            originalTabLanguage !== currentTargetLanguage &&
            twpConfig
              .get("neverTranslateLangs")
              .indexOf(originalTabLanguage) === -1 &&
            twpConfig.get("neverTranslateSites").indexOf(tabHostName) === -1
          ) {
            pageTranslator.translatePage();
          }
        });
      }
    } else if (request.action === "restorePagesWithServiceNames") {
      if (request.serviceNames.includes(currentPageTranslatorService)) {
        pageTranslator.restorePage();
        currentPageTranslatorService = request.newServiceName;
      }
    } else if (request.action === "improveTranslation") {
      pageTranslator.improveTranslation(request);
    } else if (request.action === "getCurrentSourceLanguage") {
      sendResponse(currentSourceLanguage);
    } else if (request.action === "getDontSortResults") {
      sendResponse(dontSortResults);
    } else if (request.action === "cleanUp") {
      pageTranslator.restorePage();
    } else if (request.action === "currentTargetLanguage") {
      sendResponse(currentTargetLanguage);
    } else if (request.action === "detectLanguageUsingTextContent") {
      if (textContentLanguageDetectionPromise) {
        textContentLanguageDetectionPromise.then((result) =>
          sendResponse(result)
        );
      } else {
        textContentLanguageDetectionPromise = new Promise((resolve) => {
          chrome.i18n.detectLanguage(
            document.body.innerText.trim().slice(0, 1000),
            (result) => {
              // checkedLastError();
              if (
                result &&
                result.languages &&
                result.languages.length > 0
              ) {
                resolve(result.languages[0].language);
                sendResponse(result.languages[0].language);
              } else {
                sendResponse("und");
              }
            }
          );
        });
      }
      return true;
    }
  });

  // Requests the detection of the tab language in the background
  if (window.self === window.top) {
    // is main frame
    const onTabVisible = function () {
      chrome.runtime.sendMessage(
        {
          action: "detectTabLanguage",
        },
        (result) => {
          checkedLastError();

          result = result || "und";

          // TWP-FullPage patch: if the user explicitly opted into "Always
          // translate this site", OR has explicitly saved a source language
          // for this site (via Improve translation / the bubble's From
          // selector), honor it unconditionally — don't gate on platform
          // (was blocked on mobile), don't gate on language detection (was
          // missed when detection returned a wrong/target language, or
          // disagreed with what the user already told us), don't bury it
          // behind other branches. A saved language is just as explicit a
          // signal as "always translate" — the user told us what this site
          // is, so translate the whole page with that language, blanket,
          // regardless of what per-visit detection thinks. Only respect
          // neverTranslateSites (explicit opt-out) and the translation-
          // service hostnames (which would cause loops).
          const tabIsAlwaysTranslateSite =
            twpConfig.get("alwaysTranslateSites").indexOf(tabHostName) !== -1 &&
            twpConfig.get("neverTranslateSites").indexOf(tabHostName) === -1 &&
            !chrome.extension.inIncognitoContext;
          let tabHasSavedSourceLanguage = false;
          try {
            const savedMap = twpConfig.get("fpSourceLangByHost") || {};
            tabHasSavedSourceLanguage =
              !!savedMap[tabHostName] &&
              twpConfig.get("neverTranslateSites").indexOf(tabHostName) ===
                -1 &&
              !chrome.extension.inIncognitoContext;
          } catch (e) {
            console.debug(e);
          }
          const isTranslationServiceHost =
            location.hostname === "translate.googleusercontent.com" ||
            location.hostname === "translate.google.com" ||
            location.hostname === "translate.yandex.com" ||
            location.hostname === "www.deepl.com" ||
            location.hostname === "translated.turbopages.org" ||
            location.hostname.endsWith("translate.goog") ||
            location.hostname === "sberbank.com" ||
            location.hostname === "www.sberbank.com";

          if (
            (tabIsAlwaysTranslateSite || tabHasSavedSourceLanguage) &&
            !isTranslationServiceHost &&
            pageLanguageState === "original"
          ) {
            if (result !== "und") {
              const langCode = twpLang.fixTLanguageCode(result);
              if (langCode) originalTabLanguage = langCode;
            } else {
              originalTabLanguage = result;
            }
            pageTranslator.translatePage();
            observers.forEach((callback) => callback(originalTabLanguage));
            alreadyGotTheLanguage = true;
            return;
          }

          if (result === "und") {
            originalTabLanguage = result;
            if (
              (twpConfig.get("alwaysTranslateSites").indexOf(tabHostName) !==
                -1 ||
                (location.hostname === "pdf.translatewebpages.org" &&
                  twpConfig.get("neverTranslateSites").indexOf(tabHostName) ===
                    -1)) &&
              !platformInfo.isMobile.any
            ) {
              pageTranslator.translatePage();
            }
          } else {
            const langCode = twpLang.fixTLanguageCode(result);
            if (langCode) {
              originalTabLanguage = langCode;
            }
            if (
              (location.hostname === "pdftohtml.translatewebpages.org" &&
                location.href.indexOf("?autotranslate") !== -1 &&
                twpConfig.get("neverTranslateSites").indexOf(tabHostName) ===
                  -1) ||
              (location.hostname === "pdf.translatewebpages.org" &&
                twpConfig.get("neverTranslateSites").indexOf(tabHostName) ===
                  -1)
            ) {
              pageTranslator.translatePage();
            } else {
              if (
                location.hostname !== "translate.googleusercontent.com" &&
                location.hostname !== "translate.google.com" &&
                location.hostname !== "translate.yandex.com" &&
                location.hostname !== "www.deepl.com" &&
                location.hostname !== "translated.turbopages.org" &&
                !location.hostname.endsWith("translate.goog") &&
                location.hostname !== "sberbank.com" &&
                location.hostname !== "www.sberbank.com" // https://github.com/FilipePS/Traduzir-paginas-web/issues/619
              ) {
                if (
                  pageLanguageState === "original" &&
                  // !platformInfo.isMobile.any &&
                  !chrome.extension.inIncognitoContext
                ) {
                  if (
                    twpConfig
                      .get("neverTranslateSites")
                      .indexOf(tabHostName) === -1
                  ) {
                    if (
                      langCode &&
                      langCode !== currentTargetLanguage &&
                      twpConfig
                        .get("alwaysTranslateLangs")
                        .indexOf(langCode) !== -1
                    ) {
                      pageTranslator.translatePage();
                    } else if (
                      twpConfig
                        .get("alwaysTranslateSites")
                        .indexOf(tabHostName) !== -1 &&
                      !platformInfo.isMobile.any
                    ) {
                      pageTranslator.translatePage();
                    }
                  }
                }
              }
            }
          }

          observers.forEach((callback) => callback(originalTabLanguage));
          alreadyGotTheLanguage = true;
        }
      );
    };
    setTimeout(function () {
      if (document.visibilityState == "visible") {
        onTabVisible();
      } else {
        const handleVisibilityChange = function () {
          if (document.visibilityState == "visible") {
            document.removeEventListener(
              "visibilitychange",
              handleVisibilityChange
            );
            onTabVisible();
          }
        };
        document.addEventListener(
          "visibilitychange",
          handleVisibilityChange,
          false
        );
      }
    }, 150);
  } else {
    // is subframe (iframe)
    chrome.runtime.sendMessage(
      {
        action: "getMainFrameTabLanguage",
      },
      (result) => {
        checkedLastError();

        originalTabLanguage = result || "und";
        observers.forEach((callback) => callback(originalTabLanguage));
        alreadyGotTheLanguage = true;
      }
    );

    chrome.runtime.sendMessage(
      {
        action: "getMainFramePageLanguageState",
      },
      (result) => {
        checkedLastError();

        if (
          result === "translated" &&
          pageLanguageState === "original" &&
          twpConfig.get("enableIframePageTranslation") === "yes"
        ) {
          pageTranslator.translatePage();
        }
      }
    );
  }

  // ===================================================================
  // TWP-FullPage: floating translate bubble (Immersive-Translate style)
  // A draggable circular button fixed on screen. Click toggles translation;
  // hover reveals a small menu. Main frame only, Shadow-DOM isolated, themed.
  // ===================================================================
  // TWP-FullPage: effective bubble visibility for a host. A per-host entry in
  // fpBubbleByHost wins; otherwise fall back to the global fpShowFloatingBubble.
  function fpBubbleVisibleForHost(host) {
    const map = twpConfig.get("fpBubbleByHost") || {};
    if (host && Object.prototype.hasOwnProperty.call(map, host)) {
      return map[host] !== "no";
    }
    return twpConfig.get("fpShowFloatingBubble") !== "no";
  }

  function setupFloatingBubble() {
    if (window.self !== window.top) return; // main frame only
    if (!fpBubbleVisibleForHost(location.hostname)) return;
    if (
      location.protocol === "chrome-extension:" ||
      location.protocol === "moz-extension:" ||
      location.protocol === "about:"
    )
      return;
    if (document.getElementById("twp-fp-bubble-host")) return;
    if (!document.body) {
      // body not ready yet — retry shortly
      setTimeout(setupFloatingBubble, 300);
      return;
    }

    const host = document.createElement("div");
    host.id = "twp-fp-bubble-host";
    host.style.cssText =
      "all: initial !important; position: fixed !important; z-index: 2147483647 !important; top: 0 !important; left: 0 !important; width: 0 !important; height: 0 !important;";
    // closed mode: the host page cannot reach into the bubble via .shadowRoot
    const shadow = host.attachShadow({ mode: "closed" });

    shadow.innerHTML = `
      <style>
        * { box-sizing: border-box; margin: 0; padding: 0;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif; }
        .wrap { position: fixed; width: 40px; height: 40px;
                --accent: #2563eb; --accent2: #1d4ed8; }
        .wrap.translated { --accent: #16a34a; --accent2: #15803d; }

        /* the ball — fixed anchor, never moves when the panel opens */
        .ball {
          position: absolute; inset: 0;
          width: 40px; height: 40px; border-radius: 50%;
          display: flex; align-items: center; justify-content: center;
          cursor: grab; user-select: none;
          color: #fff; font-weight: 700; font-size: 14px; letter-spacing: -.5px;
          background: linear-gradient(140deg, var(--accent), var(--accent2));
          box-shadow: 0 4px 14px -3px rgba(0,0,0,.5), 0 0 0 1px rgba(255,255,255,.08) inset;
          opacity: .55; transition: opacity .2s ease, transform .15s ease, box-shadow .2s ease;
          touch-action: none;
        }
        .wrap:hover .ball, .ball.active { opacity: 1; }
        .ball:active { cursor: grabbing; transform: scale(.94); }
        .ball .ic { width: 21px; height: 21px; pointer-events: none; }
        .ball .ic-or { display: none; }
        .wrap.translated .ball .ic-tr { display: none; }
        .wrap.translated .ball .ic-or { display: block; }
        .ball .spinner {
          display: none; width: 18px; height: 18px; border-radius: 50%;
          border: 2px solid rgba(255,255,255,.35); border-top-color: #fff;
          animation: twpspin .7s linear infinite;
        }
        .ball.busy .ic { display: none !important; }
        .ball.busy .spinner { display: block; }
        @keyframes twpspin { to { transform: rotate(360deg); } }

        /* the panel — positioned by JS (positionPanel) and clamped on-screen */
        .panel {
          position: fixed; left: 0; top: 0;
          width: 296px; max-width: calc(100vw - 16px); max-height: calc(100vh - 16px);
          overflow: auto;
          border-radius: 16px;
          background: #ffffff; color: #0f172a;
          box-shadow: 0 12px 40px -10px rgba(15,23,42,.55), 0 0 0 1px rgba(15,23,42,.06);
          opacity: 0; visibility: hidden;
          transform: scale(.96);
          transform-origin: center center;
          transition: opacity .16s ease, transform .16s ease, visibility .16s;
        }
        .wrap:hover .panel, .panel.pinned {
          opacity: 1; visibility: visible; transform: scale(1);
        }

        .head {
          padding: 13px 14px 11px; display: flex; align-items: center; gap: 9px;
          background: linear-gradient(135deg, var(--accent), var(--accent2)); color: #fff;
        }
        .head .hicon { width: 22px; height: 22px; border-radius: 6px; background: rgba(255,255,255,.18);
          display: flex; align-items: center; justify-content: center; font-size: 12px; font-weight: 700; }
        .head .htitle { font-size: 13.5px; font-weight: 700; }
        .head .hsub { font-size: 11px; opacity: .85; font-weight: 500; }

        .body { padding: 12px; display: flex; flex-direction: column; gap: 11px; }
        .primary {
          width: 100%; border: none; cursor: pointer; border-radius: 11px;
          padding: 12px; font-size: 14px; font-weight: 700; color: #fff;
          background: linear-gradient(135deg, var(--accent), var(--accent2));
          box-shadow: 0 4px 12px -4px var(--accent);
          transition: transform .12s ease, filter .12s ease;
        }
        .primary:hover { transform: translateY(-1px); filter: brightness(1.06); }
        .primary:active { transform: translateY(0); }

        .divider { height: 1px; background: #e8edf3; margin: 1px 0; }

        .row { display: flex; gap: 8px; }
        .chip {
          flex: 1; border: 1px solid #e2e8f0; background: #f8fafc; color: #0f172a;
          border-radius: 10px; padding: 9px 6px; font-size: 11.5px; font-weight: 600;
          cursor: pointer; display: flex; flex-direction: column; align-items: center; gap: 5px;
          transition: background .12s ease, border-color .12s ease, color .12s ease;
        }
        .chip:hover { background: #eef2f7; }
        .chip svg { width: 17px; height: 17px; }
        .chip.on { border-color: var(--accent); color: var(--accent); background: rgba(37,99,235,.07); }

        .selrow { display: flex; gap: 8px; }
        .selcol { flex: 1; display: flex; flex-direction: column; gap: 4px; min-width: 0; }
        .sellbl { font-size: 9.5px; font-weight: 700; letter-spacing: .4px; text-transform: uppercase;
                  opacity: .55; padding-left: 2px; }
        .sel {
          width: 100%; padding: 8px 9px; border-radius: 10px; cursor: pointer;
          border: 1px solid #e2e8f0; background: #f8fafc; color: #0f172a;
          font-size: 12.5px; font-weight: 600; appearance: auto;
          text-overflow: ellipsis;
        }
        .sel:hover { border-color: var(--accent); }

        @media (prefers-color-scheme: dark) {
          .panel { background: #1e293b; color: #e2e8f0; box-shadow: 0 12px 40px -10px rgba(0,0,0,.7), 0 0 0 1px rgba(255,255,255,.06); }
          .divider { background: #334155; }
          .chip { background: #273345; border-color: #334155; color: #e2e8f0; }
          .chip:hover { background: #2f3d52; }
          .chip.on { background: rgba(96,165,250,.14); }
          .sel { background: #273345; border-color: #334155; color: #e2e8f0; }
          .sel option { background: #1e293b; color: #e2e8f0; }
        }

        @media (prefers-reduced-motion: reduce) {
          .ball, .panel { transition: opacity .12s linear !important; }
          .ball .spinner { animation-duration: 1.2s; }
        }

        @media print { :host, .wrap { display: none !important; } }

        .ball:focus-visible { outline: 3px solid #fff; outline-offset: 2px; }
        .primary:focus-visible, .chip:focus-visible, .sel:focus-visible {
          outline: 2px solid var(--accent); outline-offset: 2px;
        }
      </style>
      <div class="wrap" id="wrap">
        <div class="ball" id="ball" tabindex="0" role="button" aria-label="Translate this page" title="Click to translate · drag to move">
          <svg class="ic ic-tr" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12.87 15.07l-2.54-2.51.03-.03c1.74-1.94 2.98-4.17 3.71-6.53H17V4h-7V2H8v2H1v1.99h11.17C11.5 7.92 10.44 9.75 9 11.35c-.93-1.03-1.7-2.16-2.31-3.35h-2c.73 1.63 1.73 3.17 2.98 4.56l-5.09 5.02L4 19l5-5 3.11 3.11.76-2.04zM18.5 10h-2L12 22h2l1.12-3h4.75L21 22h2l-4.5-12zm-2.62 7l1.62-4.33L19.12 17h-3.24z"/></svg>
          <svg class="ic ic-or" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 4v4h4"/></svg>
          <span class="spinner"></span>
        </div>
        <div class="panel" id="panel">
          <div class="head">
            <div class="hicon">文</div>
            <div>
              <div class="htitle" id="pTitle">Translate this page</div>
              <div class="hsub" id="pSub">TWP · FullPage</div>
            </div>
          </div>
          <div class="body">
            <button class="primary" id="pPrimary">Translate page</button>
            <div class="selrow">
              <div class="selcol">
                <span class="sellbl">From</span>
                <select class="sel" id="pSrc"></select>
              </div>
              <div class="selcol">
                <span class="sellbl">To</span>
                <select class="sel" id="pLang"></select>
              </div>
              <div class="selcol">
                <span class="sellbl">Service</span>
                <select class="sel" id="pService"></select>
              </div>
            </div>
            <div class="row">
              <div class="chip" id="pAlways" tabindex="0" role="button">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 13l4 4L19 7"/></svg>
                <span>Always</span>
              </div>
              <div class="chip" id="pSettings" tabindex="0" role="button">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19 12a7 7 0 0 0-.1-1l2-1.6-2-3.4-2.3 1a7 7 0 0 0-1.7-1l-.4-2.5H9.5L9 4.4a7 7 0 0 0-1.7 1l-2.3-1-2 3.4L5 11a7 7 0 0 0 0 2l-2 1.6 2 3.4 2.3-1a7 7 0 0 0 1.7 1l.5 2.5h4l.4-2.5a7 7 0 0 0 1.7-1l2.3 1 2-3.4-2-1.6a7 7 0 0 0 .1-1z"/></svg>
                <span>Settings</span>
              </div>
              <div class="chip" id="pHide" tabindex="0" role="button">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6 6 18M6 6l12 12"/></svg>
                <span>Hide</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(host);

    const wrap = shadow.getElementById("wrap");
    const ball = shadow.getElementById("ball");
    const panel = shadow.getElementById("panel");
    const pPrimary = shadow.getElementById("pPrimary");
    const pTitle = shadow.getElementById("pTitle");
    const pAlways = shadow.getElementById("pAlways");
    const pSettings = shadow.getElementById("pSettings");
    const pHide = shadow.getElementById("pHide");
    const pLang = shadow.getElementById("pLang");
    const pSrc = shadow.getElementById("pSrc");
    const pService = shadow.getElementById("pService");

    const BALL = 40;

    function clamp(v, min, max) {
      return Math.max(min, Math.min(max, v));
    }

    function vw() {
      return (window.visualViewport && window.visualViewport.width) || window.innerWidth;
    }
    function vh() {
      return (window.visualViewport && window.visualViewport.height) || window.innerHeight;
    }

    // Position is stored as a dock side + vertical fraction, so the ball is
    // ALWAYS pinned to a screen edge regardless of viewport size, device, or
    // orientation. This fixes the bubble drifting off the edge on mobile and
    // after rotation.
    let state = { side: "right", yFrac: 0.55 };
    const savedState = twpConfig.get("fpBubblePos");
    if (savedState && (savedState.side === "left" || savedState.side === "right")) {
      state.side = savedState.side;
      if (typeof savedState.yFrac === "number")
        state.yFrac = clamp(savedState.yFrac, 0, 1);
    }

    function setClasses(x) {
      // kept only for the ball's hover-side cue; panel is positioned by JS
      wrap.classList.toggle("right", x + BALL / 2 > vw() / 2);
    }

    // Position the panel beside the ball, fully clamped into the viewport.
    // Robust across mobile sizes, rotation, and ball position (no overflow).
    function positionPanel() {
      const r = ball.getBoundingClientRect();
      const pw = panel.offsetWidth || 296;
      const ph = panel.offsetHeight || 200;
      const edge = 8;
      const gap = 10;
      const W = vw();
      const H = vh();
      const roomRight = W - r.right;
      const roomLeft = r.left;
      let left;
      if (roomRight >= pw + gap || roomRight >= roomLeft) {
        left = r.right + gap; // open to the right
      } else {
        left = r.left - gap - pw; // open to the left
      }
      left = Math.max(edge, Math.min(left, W - pw - edge));
      let top = r.top + r.height / 2 - ph / 2; // vertically centred on ball
      top = Math.max(edge, Math.min(top, H - ph - edge));
      panel.style.left = Math.round(left) + "px";
      panel.style.top = Math.round(top) + "px";
    }

    // Apply the docked state -> pixel position pinned to an edge.
    function applyState() {
      const maxY = vh() - BALL - 4;
      const x = state.side === "right" ? vw() - BALL - 6 : 6;
      const y = clamp(Math.round(state.yFrac * maxY), 4, maxY);
      wrap.style.left = x + "px";
      wrap.style.top = y + "px";
      setClasses(x);
      positionPanel();
      return { x, y };
    }

    // Free preview position during a drag (not snapped).
    function previewAt(x, y) {
      const maxX = vw() - BALL - 2;
      const maxY = vh() - BALL - 2;
      x = clamp(x, 2, maxX);
      y = clamp(y, 2, maxY);
      wrap.style.left = x + "px";
      wrap.style.top = y + "px";
      setClasses(x);
      positionPanel();
      return { x, y };
    }

    let pos = applyState();

    // Re-place the panel whenever it's about to be shown or the layout shifts.
    wrap.addEventListener("pointerenter", positionPanel);
    wrap.addEventListener("focusin", positionPanel);

    function reflow() {
      pos = applyState();
    }
    window.addEventListener("resize", reflow);
    if (window.visualViewport) {
      window.visualViewport.addEventListener("resize", reflow);
      window.visualViewport.addEventListener("scroll", reflow);
    }
    window.addEventListener("orientationchange", () =>
      setTimeout(reflow, 250)
    );

    // --- click vs drag, snapping back to an edge on release ---
    let dragging = false,
      moved = false,
      sx = 0,
      sy = 0,
      ox = 0,
      oy = 0,
      longPressTimer = null;

    ball.addEventListener("pointerdown", (e) => {
      dragging = true;
      moved = false;
      sx = e.clientX;
      sy = e.clientY;
      ox = pos.x;
      oy = pos.y;
      try {
        ball.setPointerCapture(e.pointerId);
      } catch (err) {}
      longPressTimer = setTimeout(() => {
        positionPanel();
        panel.classList.add("pinned");
      }, 450);
      e.preventDefault();
    });

    ball.addEventListener("pointermove", (e) => {
      if (!dragging) return;
      const dx = e.clientX - sx;
      const dy = e.clientY - sy;
      if (!moved && (Math.abs(dx) > 4 || Math.abs(dy) > 4)) {
        moved = true;
        clearTimeout(longPressTimer);
      }
      if (moved) pos = previewAt(ox + dx, oy + dy);
    });

    ball.addEventListener("pointerup", (e) => {
      dragging = false;
      clearTimeout(longPressTimer);
      try {
        ball.releasePointerCapture(e.pointerId);
      } catch (err) {}
      if (moved) {
        // snap to nearest edge + record vertical fraction
        state.side = pos.x + BALL / 2 < vw() / 2 ? "left" : "right";
        const maxY = vh() - BALL - 4;
        state.yFrac = clamp(pos.y / maxY, 0, 1);
        pos = applyState();
        twpConfig.set("fpBubblePos", {
          side: state.side,
          yFrac: state.yFrac,
        });
      } else {
        toggleTranslate();
      }
    });

    // dismiss pinned panel when clicking elsewhere
    document.addEventListener(
      "pointerdown",
      (e) => {
        if (panel.classList.contains("pinned") && e.target !== host) {
          panel.classList.remove("pinned");
        }
      },
      true
    );

    // --- actions ---
    let actionBusy = false;
    function toggleTranslate() {
      if (actionBusy) return; // ignore rapid double clicks/taps
      actionBusy = true;
      setTimeout(() => {
        actionBusy = false;
      }, 600);
      if (pageLanguageState === "translated") {
        pageTranslator.restorePage();
      } else {
        ball.classList.add("busy");
        pageTranslator.translatePage();
      }
    }
    pPrimary.addEventListener("click", (e) => {
      e.stopPropagation();
      toggleTranslate();
    });
    pAlways.addEventListener("click", (e) => {
      e.stopPropagation();
      const sites = twpConfig.get("alwaysTranslateSites") || [];
      if (sites.indexOf(tabHostName) === -1) {
        twpConfig.addSiteToAlwaysTranslate(tabHostName);
        if (pageLanguageState !== "translated") {
          ball.classList.add("busy");
          pageTranslator.translatePage();
        }
      } else {
        twpConfig.removeSiteFromAlwaysTranslate(tabHostName);
      }
      refresh();
    });
    pSettings.addEventListener("click", (e) => {
      e.stopPropagation();
      chrome.runtime.sendMessage({ action: "openOptionsPage" }, checkedLastError);
    });
    pHide.addEventListener("click", (e) => {
      e.stopPropagation();
      // hide for THIS site only (per-host), not everywhere
      try {
        const map = Object.assign({}, twpConfig.get("fpBubbleByHost") || {});
        map[location.hostname] = "no";
        twpConfig.set("fpBubbleByHost", map);
      } catch (err) {}
      host.remove();
    });

    // --- populate target-language + service selectors ---
    function buildLangOptions() {
      const common = [
        "en", "es", "fr", "de", "pt", "it", "ru", "ja", "ko",
        "zh-CN", "zh-TW", "vi", "ar", "hi", "id", "th",
      ];
      const preferred = twpConfig.get("targetLanguages") || [];
      const current = twpConfig.get("targetLanguage");
      const seen = {};
      const codes = [];
      [current, ...preferred, ...common].forEach((c) => {
        if (c && !seen[c]) {
          seen[c] = true;
          codes.push(c);
        }
      });
      pLang.innerHTML = "";
      codes.forEach((c) => {
        const o = document.createElement("option");
        o.value = c;
        let name = c;
        try {
          name = twpLang.codeToLanguage(c) || c;
        } catch (err) {}
        o.textContent = name;
        if (c === current) o.selected = true;
        pLang.appendChild(o);
      });
    }
    function buildServiceOptions() {
      // page-translation-capable services
      const labels = { google: "Google", bing: "Bing", yandex: "Yandex" };
      const enabled = twpConfig.get("enabledServices") || [
        "google",
        "bing",
        "yandex",
      ];
      const list = ["google", "bing", "yandex"].filter(
        (s) => enabled.indexOf(s) !== -1
      );
      pService.innerHTML = "";
      list.forEach((s) => {
        const o = document.createElement("option");
        o.value = s;
        o.textContent = labels[s];
        if (s === currentPageTranslatorService) o.selected = true;
        pService.appendChild(o);
      });
    }
    buildLangOptions();
    buildServiceOptions();

    // TWP-FullPage patch: source ("From") language selector. "auto" = detect.
    function buildSrcOptions() {
      const common = [
        "auto", "en", "zh-CN", "zh-TW", "ja", "ko", "vi", "es", "fr", "de",
        "pt", "it", "ru", "ar", "hi", "id", "th",
      ];
      const seen = {};
      const codes = [];
      [currentSourceLanguage, ...common].forEach((c) => {
        if (c && !seen[c]) {
          seen[c] = true;
          codes.push(c);
        }
      });
      pSrc.innerHTML = "";
      codes.forEach((c) => {
        const o = document.createElement("option");
        o.value = c;
        let name = c === "auto" ? "Detect" : c;
        if (c !== "auto") {
          try {
            name = twpLang.codeToLanguage(c) || c;
          } catch (err) {}
        }
        o.textContent = name;
        if (c === currentSourceLanguage) o.selected = true;
        pSrc.appendChild(o);
      });
    }
    buildSrcOptions();

    pSrc.addEventListener("click", (e) => e.stopPropagation());
    pSrc.addEventListener("change", (e) => {
      e.stopPropagation();
      const code = pSrc.value;
      // mirror Improve-translation: remember source language per hostname
      try {
        const host = location.hostname;
        if (host) {
          const map = Object.assign(
            {},
            twpConfig.get("fpSourceLangByHost") || {}
          );
          if (code && code !== "auto") map[host] = code;
          else delete map[host];
          twpConfig.set("fpSourceLangByHost", map);
        }
      } catch (err) {}
      currentSourceLanguage = code;
      ball.classList.add("busy");
      pageTranslator.translatePage(currentTargetLanguage);
    });

    pLang.addEventListener("click", (e) => e.stopPropagation());
    pLang.addEventListener("change", (e) => {
      e.stopPropagation();
      const code = pLang.value;
      twpConfig.set("targetLanguage", code);
      ball.classList.add("busy");
      pageTranslator.translatePage(code);
    });
    pService.addEventListener("click", (e) => e.stopPropagation());
    pService.addEventListener("change", (e) => {
      e.stopPropagation();
      const svc = pService.value;
      twpConfig.set("pageTranslatorService", svc);
      ball.classList.add("busy");
      pageTranslator.swapTranslationService(svc);
    });

    // --- keyboard accessibility ---
    ball.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        toggleTranslate();
      } else if (e.key === "Escape") {
        panel.classList.remove("pinned");
        ball.blur();
      }
    });
    [pAlways, pSettings, pHide].forEach((el) => {
      el.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          el.click();
        }
      });
    });

    // --- hide while a video/element is in fullscreen ---
    function onFsChange() {
      const fs =
        document.fullscreenElement || document.webkitFullscreenElement;
      host.style.display = fs ? "none" : "";
    }
    document.addEventListener("fullscreenchange", onFsChange, false);
    document.addEventListener("webkitfullscreenchange", onFsChange, false);

    // --- reflect state ---
    function refresh() {
      const translated = pageLanguageState === "translated";
      wrap.classList.toggle("translated", translated);
      ball.classList.remove("busy");
      pTitle.textContent = translated ? "Page translated" : "Translate this page";
      pPrimary.textContent = translated ? "Show original" : "Translate page";
      const sites = twpConfig.get("alwaysTranslateSites") || [];
      pAlways.classList.toggle("on", sites.indexOf(tabHostName) !== -1);
      // keep selectors reflecting current state
      if (pService.value !== currentPageTranslatorService) {
        pService.value = currentPageTranslatorService;
      }
      const tl = twpConfig.get("targetLanguage");
      if (pLang.value !== tl) pLang.value = tl;
      if (pSrc && pSrc.value !== currentSourceLanguage) {
        // option may not exist (uncommon language) — guard
        const has = Array.prototype.some.call(
          pSrc.options,
          (o) => o.value === currentSourceLanguage
        );
        if (has) pSrc.value = currentSourceLanguage;
      }
    }
    refresh();
    pageTranslator.onPageLanguageStateChange(() => refresh());
  }

  // Always-on listener so the show/hide toggles take effect live, even if the
  // bubble wasn't created at page load. Reacts to both the per-host map and the
  // global default, re-evaluating visibility for THIS host.
  if (window.self === window.top) {
    twpConfig.onChanged((name) => {
      if (name !== "fpShowFloatingBubble" && name !== "fpBubbleByHost") return;
      const visible = fpBubbleVisibleForHost(location.hostname);
      const h = document.getElementById("twp-fp-bubble-host");
      if (!visible) {
        if (h) h.remove();
      } else if (!h) {
        setupFloatingBubble();
      }
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", setupFloatingBubble, {
      once: true,
    });
  } else {
    setupFloatingBubble();
  }

  showOriginal.enabledObserverSubscribe(function () {
    if (pageLanguageState !== "original") {
      pageTranslator.translatePage();
    }
  });
});

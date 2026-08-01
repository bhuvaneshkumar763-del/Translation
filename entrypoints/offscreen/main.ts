import { onMessage } from '@/modules/messaging/protocol';

/**
 * TypeScript port of off_screen.js — the actual TTS audio playback, which
 * needs `Audio`/`AudioContext`/`DOMParser`/`XMLHttpRequest`, none of which a
 * service worker has. This is why it lives in an offscreen document instead
 * of the background script (see modules/tts/offscreenClient.ts for the
 * background-side half that creates this document and relays to it).
 */

interface LanguageData {
  language: string;
  locale: string;
  gender: string;
  voice: string;
}

class BingHelper {
  private static lastRequestTime: number | null = null;
  private static ig: string | null = null;
  private static iid: string | null = null;
  private static key: number | null = null;
  private static token: string | null = null;
  private static notFound = false;
  private static promise: Promise<void> | null = null;

  static get IG() {
    return BingHelper.ig;
  }
  static get IID() {
    return BingHelper.iid;
  }
  static get Key() {
    return BingHelper.key;
  }
  static get Token() {
    return BingHelper.token;
  }

  /** Find the SID (IID and IG) of Bing Translator, used in TTS requests. */
  static async findAuth(): Promise<void> {
    if (BingHelper.promise) return await BingHelper.promise;

    BingHelper.promise = new Promise<void>((resolve) => {
      let updateBingAuth = false;
      if (BingHelper.lastRequestTime) {
        const date = new Date();
        if (BingHelper.ig) {
          date.setMinutes(date.getMinutes() - 30);
        } else if (BingHelper.notFound) {
          date.setMinutes(date.getMinutes() - 5);
        } else {
          date.setMinutes(date.getMinutes() - 2);
        }
        if (date.getTime() > BingHelper.lastRequestTime) updateBingAuth = true;
      } else {
        updateBingAuth = true;
      }

      if (!updateBingAuth) {
        resolve();
        return;
      }

      BingHelper.lastRequestTime = Date.now();

      const http = new XMLHttpRequest();
      http.open('GET', 'https://www.bing.com/translator');
      http.send();
      http.onload = () => {
        try {
          if (!(http.responseText && http.responseText.length > 1)) {
            throw new Error('Not found');
          }

          const responseText = http.responseText;
          const igMatch = responseText.match(/IG:"([^"]+)"/);
          const iidMatch = responseText.match(/data-iid="([^"]+)"/);
          if (!igMatch || !iidMatch) throw new Error('Not found');

          const abhStartText = 'params_AbusePreventionHelper = [';
          const abhStartIndex = responseText.indexOf(abhStartText);
          if (abhStartIndex === -1) throw new Error('Not found 2');
          const abhEndIndex = responseText.indexOf(']', abhStartIndex);
          if (abhEndIndex === -1) throw new Error('Not found 3');
          const abhText = responseText.slice(abhStartIndex + abhStartText.length - 1, abhEndIndex + 1);
          const abh = JSON.parse(abhText);

          BingHelper.ig = igMatch[1] ?? null;
          BingHelper.iid = iidMatch[1] ?? null;
          BingHelper.key = abh[0];
          BingHelper.token = abh[1];
          BingHelper.notFound = false;
        } catch {
          BingHelper.notFound = true;
        } finally {
          resolve();
        }
      };
      http.onerror =
        http.onabort =
        http.ontimeout =
          (e) => {
            console.error(e);
            resolve();
          };
    });

    BingHelper.promise.finally(() => {
      BingHelper.promise = null;
    });

    return await BingHelper.promise;
  }

  static getLanguageData(language: string): LanguageData | undefined {
    // prettier-ignore
    const replacements: Array<{ search: string; replace: string }> = [
      { search: 'zh-CN', replace: 'zh-Hans' },
      { search: 'zh-TW', replace: 'zh-Hant' },
      { search: 'tl', replace: 'fil' },
      { search: 'hmn', replace: 'mww' },
      { search: 'ku', replace: 'kmr' },
      { search: 'ckb', replace: 'ku' },
      { search: 'mn', replace: 'mn-Cyrl' },
      { search: 'no', replace: 'nb' },
      { search: 'lg', replace: 'lug' },
      { search: 'sr', replace: 'sr-Cyrl' },
    ];
    replacements.forEach((r) => {
      if (language === r.search) language = r.replace;
    });

    // prettier-ignore
    const languageData: LanguageData[] = [
      { language: 'af', locale: 'af-ZA', gender: 'Female', voice: 'af-ZA-AdriNeural' },
      { language: 'am', locale: 'am-ET', gender: 'Female', voice: 'am-ET-MekdesNeural' },
      { language: 'ar', locale: 'ar-SA', gender: 'Male', voice: 'ar-SA-HamedNeural' },
      { language: 'bn', locale: 'bn-IN', gender: 'Female', voice: 'bn-IN-TanishaaNeural' },
      { language: 'bg', locale: 'bg-BG', gender: 'Male', voice: 'bg-BG-BorislavNeural' },
      { language: 'ca', locale: 'ca-ES', gender: 'Female', voice: 'ca-ES-JoanaNeural' },
      { language: 'cs', locale: 'cs-CZ', gender: 'Male', voice: 'cs-CZ-AntoninNeural' },
      { language: 'cy', locale: 'cy-GB', gender: 'Female', voice: 'cy-GB-NiaNeural' },
      { language: 'da', locale: 'da-DK', gender: 'Female', voice: 'da-DK-ChristelNeural' },
      { language: 'de', locale: 'de-DE', gender: 'Female', voice: 'de-DE-KatjaNeural' },
      { language: 'el', locale: 'el-GR', gender: 'Male', voice: 'el-GR-NestorasNeural' },
      { language: 'en', locale: 'en-US', gender: 'Female', voice: 'en-US-AriaNeural' },
      { language: 'es', locale: 'es-ES', gender: 'Female', voice: 'es-ES-ElviraNeural' },
      { language: 'et', locale: 'et-EE', gender: 'Female', voice: 'et-EE-AnuNeural' },
      { language: 'fa', locale: 'fa-IR', gender: 'Female', voice: 'fa-IR-DilaraNeural' },
      { language: 'fi', locale: 'fi-FI', gender: 'Female', voice: 'fi-FI-NooraNeural' },
      { language: 'fr', locale: 'fr-FR', gender: 'Female', voice: 'fr-FR-DeniseNeural' },
      { language: 'fr-CA', locale: 'fr-CA', gender: 'Female', voice: 'fr-CA-SylvieNeural' },
      { language: 'ga', locale: 'ga-IE', gender: 'Female', voice: 'ga-IE-OrlaNeural' },
      { language: 'gu', locale: 'gu-IN', gender: 'Female', voice: 'gu-IN-DhwaniNeural' },
      { language: 'he', locale: 'he-IL', gender: 'Male', voice: 'he-IL-AvriNeural' },
      { language: 'hi', locale: 'hi-IN', gender: 'Female', voice: 'hi-IN-SwaraNeural' },
      { language: 'hr', locale: 'hr-HR', gender: 'Male', voice: 'hr-HR-SreckoNeural' },
      { language: 'hu', locale: 'hu-HU', gender: 'Male', voice: 'hu-HU-TamasNeural' },
      { language: 'id', locale: 'id-ID', gender: 'Male', voice: 'id-ID-ArdiNeural' },
      { language: 'is', locale: 'is-IS', gender: 'Female', voice: 'is-IS-GudrunNeural' },
      { language: 'it', locale: 'it-IT', gender: 'Male', voice: 'it-IT-DiegoNeural' },
      { language: 'ja', locale: 'ja-JP', gender: 'Female', voice: 'ja-JP-NanamiNeural' },
      { language: 'kk', locale: 'kk-KZ', gender: 'Female', voice: 'kk-KZ-AigulNeural' },
      { language: 'km', locale: 'km-KH', gender: 'Female', voice: 'km-KH-SreymomNeural' },
      { language: 'kn', locale: 'kn-IN', gender: 'Female', voice: 'kn-IN-SapnaNeural' },
      { language: 'ko', locale: 'ko-KR', gender: 'Female', voice: 'ko-KR-SunHiNeural' },
      { language: 'lo', locale: 'lo-LA', gender: 'Female', voice: 'lo-LA-KeomanyNeural' },
      { language: 'lv', locale: 'lv-LV', gender: 'Female', voice: 'lv-LV-EveritaNeural' },
      { language: 'lt', locale: 'lt-LT', gender: 'Female', voice: 'lt-LT-OnaNeural' },
      { language: 'mk', locale: 'mk-MK', gender: 'Female', voice: 'mk-MK-MarijaNeural' },
      { language: 'ml', locale: 'ml-IN', gender: 'Female', voice: 'ml-IN-SobhanaNeural' },
      { language: 'mr', locale: 'mr-IN', gender: 'Female', voice: 'mr-IN-AarohiNeural' },
      { language: 'ms', locale: 'ms-MY', gender: 'Male', voice: 'ms-MY-OsmanNeural' },
      { language: 'mt', locale: 'mt-MT', gender: 'Female', voice: 'mt-MT-GraceNeural' },
      { language: 'my', locale: 'my-MM', gender: 'Female', voice: 'my-MM-NilarNeural' },
      { language: 'nl', locale: 'nl-NL', gender: 'Female', voice: 'nl-NL-ColetteNeural' },
      { language: 'nb', locale: 'nb-NO', gender: 'Female', voice: 'nb-NO-PernilleNeural' },
      { language: 'pl', locale: 'pl-PL', gender: 'Female', voice: 'pl-PL-ZofiaNeural' },
      { language: 'ps', locale: 'ps-AF', gender: 'Female', voice: 'ps-AF-LatifaNeural' },
      { language: 'pt', locale: 'pt-BR', gender: 'Female', voice: 'pt-BR-FranciscaNeural' },
      { language: 'pt-PT', locale: 'pt-PT', gender: 'Female', voice: 'pt-PT-FernandaNeural' },
      { language: 'ro', locale: 'ro-RO', gender: 'Male', voice: 'ro-RO-EmilNeural' },
      { language: 'ru', locale: 'ru-RU', gender: 'Female', voice: 'ru-RU-DariyaNeural' },
      { language: 'sk', locale: 'sk-SK', gender: 'Male', voice: 'sk-SK-LukasNeural' },
      { language: 'sl', locale: 'sl-SI', gender: 'Male', voice: 'sl-SI-RokNeural' },
      { language: 'sr-Cyrl', locale: 'sr-RS', gender: 'Female', voice: 'sr-RS-SophieNeural' },
      { language: 'sv', locale: 'sv-SE', gender: 'Female', voice: 'sv-SE-SofieNeural' },
      { language: 'ta', locale: 'ta-IN', gender: 'Female', voice: 'ta-IN-PallaviNeural' },
      { language: 'te', locale: 'te-IN', gender: 'Male', voice: 'te-IN-ShrutiNeural' },
      { language: 'th', locale: 'th-TH', gender: 'Male', voice: 'th-TH-NiwatNeural' },
      { language: 'tr', locale: 'tr-TR', gender: 'Female', voice: 'tr-TR-EmelNeural' },
      { language: 'uk', locale: 'uk-UA', gender: 'Female', voice: 'uk-UA-PolinaNeural' },
      { language: 'ur', locale: 'ur-IN', gender: 'Female', voice: 'ur-IN-GulNeural' },
      { language: 'uz', locale: 'uz-UZ', gender: 'Female', voice: 'uz-UZ-MadinaNeural' },
      { language: 'vi', locale: 'vi-VN', gender: 'Male', voice: 'vi-VN-NamMinhNeural' },
      { language: 'zh-Hans', locale: 'zh-CN', gender: 'Female', voice: 'zh-CN-XiaoxiaoNeural' },
      { language: 'zh-Hant', locale: 'zh-CN', gender: 'Female', voice: 'zh-CN-XiaoxiaoNeural' },
      { language: 'yue', locale: 'zh-HK', gender: 'Female', voice: 'zh-HK-HiuGaaiNeural' },
    ];

    return languageData.find((d) => d.language === language);
  }
}

class AudioAmplifier {
  private sources: MediaElementAudioSourceNode[] = [];
  private audioCtx: AudioContext | null = null;
  private gainNode: GainNode | null = null;

  constructor() {
    if ('AudioContext' in window) {
      this.audioCtx = new AudioContext();
      this.audioCtx.suspend();
      this.gainNode = this.audioCtx.createGain();
      this.gainNode.gain.value = 1;
      this.gainNode.connect(this.audioCtx.destination);
    }
  }

  async amplify(audio: HTMLAudioElement): Promise<void> {
    if (!this.audioCtx) return;
    if (this.sources.find((source) => source.mediaElement === audio)) {
      await this.audioCtx.resume();
      return;
    }

    const source = this.audioCtx.createMediaElementSource(audio);
    this.sources.push(source);
    source.connect(this.gainNode!);

    await this.audioCtx.resume();
  }

  setVolume(volume: number): void {
    if (!this.gainNode) return;
    this.gainNode.gain.value = volume > 1 ? volume : 1;
  }

  /** https://github.com/FilipePS/Traduzir-paginas-web/issues/802 */
  async suspend(): Promise<void> {
    if (this.audioCtx) await this.audioCtx.suspend();
  }
}

type GetExtraParameters = (text: string, targetLanguage: string) => string;
type GetRequestBody = (text: string, targetLanguage: string) => string;

class TtsService {
  private audios = new Map<string, HTMLAudioElement>();
  private audioSpeed = 1.0;
  private audioAmplifier = new AudioAmplifier();

  constructor(
    private serviceName: string,
    public baseURL: string,
    private xhrMethod: 'GET' | 'POST',
    private cbGetExtraParameters: GetExtraParameters,
    private cbGetRequestBody?: GetRequestBody,
  ) {}

  /** Splits long text into <170-char chunks, to stay under each service's quota. */
  private getRequests(fullText: string): string[] {
    const fullTextSplitted: string[] = [];
    fullText
      .trim()
      .split(' ')
      .forEach((word) => {
        if (word.length > 160) {
          while (word.length > 160) {
            fullTextSplitted.push(word.slice(0, 160));
            word = word.slice(160);
          }
          if (word.trim().length > 0) fullTextSplitted.push(word);
        } else if (word.trim().length > 0) {
          fullTextSplitted.push(word);
        }
      });

    const requests: string[] = [];
    let requestString = '';
    for (let text of fullTextSplitted) {
      text += ' ';
      if (requestString.length + text.length < 170) {
        requestString += text;
      } else {
        requests.push(requestString);
        requestString = text;
      }
    }
    if (requestString.trim().length > 0) requests.push(requestString);

    return requests;
  }

  private async makeRequest(text: string, targetLanguage: string): Promise<string> {
    return await new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.onload = () => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result as string);
        reader.onerror = () => reject();
        reader.readAsDataURL(xhr.response);
      };
      xhr.onerror = (e) => {
        console.error(e);
        reject();
      };
      xhr.open(this.xhrMethod, this.baseURL + this.cbGetExtraParameters(text, targetLanguage));
      xhr.responseType = 'blob';
      if (this.cbGetRequestBody) {
        xhr.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded');
        xhr.send(this.cbGetRequestBody(text, targetLanguage));
      } else {
        xhr.send();
      }
    });
  }

  async textToSpeech(fullText: string, targetLanguage: string): Promise<void> {
    if (this.serviceName === 'bing') await BingHelper.findAuth();

    const requests = this.getRequests(fullText);
    const promises: Promise<unknown>[] = [];

    for (const requestText of requests) {
      const audioKey = [targetLanguage, requestText].join(', ');
      if (!this.audios.get(audioKey)) {
        promises.push(
          this.makeRequest(requestText, targetLanguage)
            .then((response) => {
              const audio = new Audio(response);
              this.audios.set(audioKey, audio);
              return response;
            })
            .catch((e) => {
              console.error(e);
              return null;
            }),
        );
      }
    }

    await Promise.all(promises);
    await this.play(
      requests
        .map((text) => this.audios.get([targetLanguage, text].join(', ')))
        .filter((a): a is HTMLAudioElement => !!a),
    );
  }

  private async play(audios: HTMLAudioElement | HTMLAudioElement[]): Promise<void> {
    this.stopAll();
    await new Promise<void>((resolve) => {
      (async () => {
        try {
          if (Array.isArray(audios)) {
            const playAll = async (currentIndex: number) => {
              this.stopAll();
              const audio = audios[currentIndex];
              if (audio) {
                audio.playbackRate = this.audioSpeed;
                await this.audioAmplifier.amplify(audio);
                audio.play();
                audio.addEventListener('ended', () => playAll(currentIndex + 1), { once: true });
              } else {
                resolve();
              }
            };
            playAll(0);
          } else if (audios instanceof HTMLAudioElement) {
            audios.playbackRate = this.audioSpeed;
            await this.audioAmplifier.amplify(audios);
            audios.play();
            audios.addEventListener('ended', () => resolve(), { once: true });
          }
        } catch (e) {
          console.error(e);
          resolve();
        }
      })();
    });
    await this.audioAmplifier.suspend();
  }

  setAudioSpeed(speed: number): void {
    this.audioSpeed = speed;
    this.audios.forEach((audio) => {
      audio.playbackRate = this.audioSpeed;
    });
  }

  setAudioVolume(volume: number): void {
    this.audios.forEach((audio) => {
      audio.volume = volume > 1 ? 1 : volume;
    });
    this.audioAmplifier.setVolume(volume < 1 ? 1 : volume);
  }

  stopAll(): void {
    this.audios.forEach((audio) => {
      audio.pause();
      // If `currentTime` isn't `duration`, an audio stream stays active in Firefox.
      // https://github.com/FilipePS/Traduzir-paginas-web/issues/802
      if (!Number.isNaN(audio.duration) && Number.isFinite(audio.duration)) {
        audio.currentTime = audio.duration;
      }
    });
    this.audioAmplifier.suspend();
  }
}

const googleService = new TtsService(
  'google',
  'https://translate.google.com/translate_tts?ie=UTF-8',
  'GET',
  (text, targetLanguage) => `&tl=${targetLanguage}&client=dict-chrome-ex&ttsspeed=0.5&q=${encodeURIComponent(text)}`,
);

const bingService = new TtsService(
  'bing',
  'https://www.bing.com/tfettts?isVertical=1',
  'POST',
  () => `&&IG=${encodeURIComponent(BingHelper.IG ?? '')}&IID=${encodeURIComponent(BingHelper.IID ?? '')}.1`,
  (text, targetLanguage) => {
    const languageData = BingHelper.getLanguageData(targetLanguage);
    if (!languageData) throw new Error(`No Bing TTS language data for ${targetLanguage}`);

    const domParser = new DOMParser();
    const doc = domParser.parseFromString(
      `<speak version='1.0' xml:lang=''><voice xml:lang='' xml:gender='' name=''><prosody rate='-20.00%'></prosody></voice></speak>`,
      'text/xml',
    );
    doc.querySelector('speak')!.setAttribute('xml:lang', languageData.locale);
    doc.querySelector('voice')!.setAttribute('xml:lang', languageData.locale);
    doc.querySelector('voice')!.setAttribute('xml:gender', languageData.gender);
    doc.querySelector('voice')!.setAttribute('xml:name', languageData.voice);
    doc.querySelector('prosody')!.textContent = text;

    const params = new URLSearchParams();
    params.append('ssml', new XMLSerializer().serializeToString(doc));
    params.append('token', BingHelper.Token ?? '');
    params.append('key', String(BingHelper.Key ?? ''));
    return params.toString();
  },
);

onMessage('offscreen_google_textToSpeech', async (message) => {
  await googleService.textToSpeech(message.data.text, message.data.targetLanguage);
});
onMessage('offscreen_bing_textToSpeech', async (message) => {
  await bingService.textToSpeech(message.data.text, message.data.targetLanguage);
});
onMessage('offscreen_google_stopAll', () => googleService.stopAll());
onMessage('offscreen_bing_stopAll', () => bingService.stopAll());
onMessage('offscreen_google_ttsSpeed', (message) => googleService.setAudioSpeed(message.data.speed));
onMessage('offscreen_bing_ttsSpeed', (message) => bingService.setAudioSpeed(message.data.speed));
onMessage('offscreen_google_ttsVolume', (message) => googleService.setAudioVolume(message.data.volume));
onMessage('offscreen_bing_ttsVolume', (message) => bingService.setAudioVolume(message.data.volume));

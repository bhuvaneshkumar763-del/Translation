/**
 * TypeScript port of lib/XMLHttpRequestShim.js — a minimal XMLHttpRequest
 * implementation on top of fetch()/AbortController, both available in an MV3
 * service worker (unlike the real XMLHttpRequest, which isn't). Used by every
 * provider's auth-scraping and translation requests.
 *
 * Ported with the header-copy fix already applied from this repo's earlier
 * bug-fix pass: `resp.headers` is a Fetch API Headers object with no
 * enumerable own properties, so it must be copied via `.forEach()`, not
 * `Object.assign()` (which silently copies nothing) — that bug is what made
 * the Retry-After-honoring logic in the old translationService.js inert.
 */

type XHRMethod = string;
type XHRResponseType = '' | 'text' | 'json' | 'blob' | 'arraybuffer';
type XHREventName = 'loadstart' | 'load' | 'error' | 'abort' | 'timeout' | 'loadend';

export class XMLHttpRequestShim extends EventTarget {
  static readonly UNSENT = 0;
  static readonly OPENED = 1;
  static readonly HEADERS_RECEIVED = 2;
  static readonly LOADING = 3;
  static readonly DONE = 4;

  readyState: number = XMLHttpRequestShim.UNSENT;
  response: unknown = null;
  responseType: XHRResponseType = '';
  responseURL = '';
  status = 0;
  statusText = '';
  timeout = 0;
  withCredentials = false;

  onloadstart: ((event: Event) => void) | null = null;
  onload: ((event: Event) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onabort: ((event: Event) => void) | null = null;
  ontimeout: ((event: Event) => void) | null = null;
  onloadend: ((event: Event) => void) | null = null;

  #headers: Record<string, string> = { accept: '*/*' };
  #respHeaders: Record<string, string> = {};
  #abortController = new AbortController();
  #method: XHRMethod = '';
  #url = '';
  #mime = '';
  #errored = false;
  #timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  #timedOut = false;
  #isResponseText = true;

  get responseText(): string | null {
    if (this.#errored) return null;
    if (this.readyState < XMLHttpRequestShim.HEADERS_RECEIVED) return '';
    if (this.#isResponseText) return this.response as string;
    throw new DOMException('Response type not set to text', 'InvalidStateError');
  }

  get responseXML(): never {
    throw new Error('XML not supported');
  }

  #dispatch(eventName: XHREventName) {
    const handler = this[`on${eventName}` as const];
    const evt = new CustomEvent(eventName);
    if (typeof handler === 'function') {
      this.addEventListener(eventName, handler.bind(this) as EventListener, { once: true });
    }
    this.dispatchEvent(evt);
  }

  abort(): void {
    this.#abortController.abort();
    this.status = 0;
    this.readyState = XMLHttpRequestShim.UNSENT;
  }

  open(method: XHRMethod, url: string): void {
    this.status = 0;
    this.#method = method;
    this.#url = url;
    this.readyState = XMLHttpRequestShim.OPENED;
  }

  setRequestHeader(header: string, value: string): void {
    const key = String(header).toLowerCase();
    this.#headers[key] = typeof this.#headers[key] === 'undefined' ? String(value) : `${this.#headers[key]}, ${value}`;
  }

  overrideMimeType(mimeType: string): void {
    this.#mime = String(mimeType);
  }

  getAllResponseHeaders(): string {
    if (this.#errored || this.readyState < XMLHttpRequestShim.HEADERS_RECEIVED) return '';
    return Object.entries(this.#respHeaders)
      .map(([header, value]) => `${header}: ${value}`)
      .join('\r\n');
  }

  getResponseHeader(headerName: string): string | null {
    const value = this.#respHeaders[String(headerName).toLowerCase()];
    return typeof value === 'string' ? value : null;
  }

  send(body: BodyInit | null = null): void {
    if (this.timeout > 0) {
      this.#timeoutHandle = setTimeout(() => {
        this.#timedOut = true;
        this.#abortController.abort();
      }, this.timeout);
    }

    const responseType = this.responseType || 'text';
    this.#isResponseText = responseType === 'text';

    fetch(this.#url, {
      method: this.#method || 'GET',
      signal: this.#abortController.signal,
      headers: this.#headers,
      credentials: this.withCredentials ? 'include' : 'same-origin',
      body,
    })
      .finally(() => {
        this.readyState = XMLHttpRequestShim.DONE;
        clearTimeout(this.#timeoutHandle);
        this.#dispatch('loadstart');
      })
      .then(
        async (resp) => {
          this.responseURL = resp.url;
          this.status = resp.status;
          this.statusText = resp.statusText;
          resp.headers.forEach((value, key) => {
            this.#respHeaders[key] = value;
          });
          const finalMIME = this.#mime || this.#respHeaders['content-type'] || 'text/plain';
          switch (responseType) {
            case 'text':
              this.response = await resp.text();
              break;
            case 'blob':
              this.response = new Blob([await resp.arrayBuffer()], { type: finalMIME });
              break;
            case 'arraybuffer':
              this.response = await resp.arrayBuffer();
              break;
            case 'json':
              this.response = await resp.json();
              break;
          }
          this.#dispatch('load');
        },
        (err: unknown) => {
          let eventName: XHREventName = 'abort';
          if (!(err instanceof Error) || err.name !== 'AbortError') {
            this.#errored = true;
            eventName = 'error';
          } else if (this.#timedOut) {
            eventName = 'timeout';
          }
          this.#dispatch(eventName);
        },
      )
      .finally(() => this.#dispatch('loadend'));
  }
}

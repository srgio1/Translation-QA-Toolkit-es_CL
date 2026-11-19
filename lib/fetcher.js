// fetcher.js — port of fetcher.py: cached fetch with random delay and retries.
// Runs in an extension page, so host permission lets it read translate.wordpress.org
// with the cookies of your logged-in Firefox session.
import { BASE_URL } from "./config.js";
import { dbGet, dbPut } from "./db.js";

export class StopError extends Error { constructor() { super("Stopped"); this.name = "StopError"; } }

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new StopError());
    const t = setTimeout(() => { signal?.removeEventListener("abort", onAbort); resolve(); }, ms);
    const onAbort = () => { clearTimeout(t); reject(new StopError()); };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/** True when translate.wordpress.org renders pages for a logged-in user (body class "logged-in"). */
export async function detectSession(signal) {
  try {
    const res = await fetch(BASE_URL + "/", { credentials: "include", signal });
    const html = await res.text();
    return /<body[^>]*\bclass="[^"]*\blogged-in\b/i.test(html);
  } catch (e) {
    if (signal?.aborted) throw new StopError();
    return false;
  }
}

export class Fetcher {
  constructor({ delayMin = 1, delayMax = 10.5, maxRetries = 5, timeoutSec = 20,
                signal = null, log = () => {}, namespace = "anon", useCache = true } = {}) {
    Object.assign(this, { delayMin, delayMax, maxRetries, timeoutSec, signal, log, namespace, useCache });
  }

  async fetchUrl(url, { force = false } = {}) {
    const key = `${this.namespace}|${url}`;     // logged-in and public versions never mix
    if (this.useCache && !force) {
      const hit = await dbGet("pages", key);
      if (hit) { this.log("DEBUG", `Cache hit: ${url}`); return hit.html; }
    }
    const delay = this.delayMin + Math.random() * Math.max(0, this.delayMax - this.delayMin);
    this.log("DEBUG", `Waiting ${delay.toFixed(1)}s before next request`);
    await sleep(delay * 1000, this.signal);

    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      const ctl = new AbortController();
      const onStop = () => ctl.abort();
      this.signal?.addEventListener("abort", onStop, { once: true });
      let timedOut = false;
      const timer = setTimeout(() => { timedOut = true; ctl.abort(); }, this.timeoutSec * 1000);
      try {
        this.log("INFO", `Fetching (attempt ${attempt}/${this.maxRetries}): ${url}`);
        const res = await fetch(url, { credentials: "include", signal: ctl.signal,
                                       headers: { Accept: "text/html,application/xhtml+xml" } });
        if (!res.ok) {
          const err = new Error(`HTTP ${res.status}`);
          err.status = res.status;
          throw err;
        }
        const html = await res.text();
        if (this.useCache) await dbPut("pages", { key, url, html, fetchedAt: Date.now() });
        return html;
      } catch (e) {
        if (this.signal?.aborted) throw new StopError();
        const why = timedOut ? "timeout" : e.message;
        this.log("WARNING", `Fetch error (attempt ${attempt}/${this.maxRetries}) for ${url}: ${why}`);
        // permanent client errors: retrying cannot help
        if ([401, 403, 404, 410].includes(e.status)) return null;
        if (attempt < this.maxRetries) {
          const backoff = Math.min(2 ** attempt, 30);
          this.log("INFO", `Retrying in ${backoff}s...`);
          await sleep(backoff * 1000, this.signal);
        } else {
          this.log("ERROR", `All retries exhausted for ${url}`);
          return null;
        }
      } finally {
        clearTimeout(timer);
        this.signal?.removeEventListener("abort", onStop);
      }
    }
    return null;
  }
}

'use strict';
// Klien HTTP minimal untuk OpenRouter. Kunci hanya dikirim sebagai header dan TIDAK pernah ditulis ke berkas atau log.
const core = require('../../../core/src');
const sleep = ms => new Promise(r => setTimeout(r, ms));

class ApiError extends Error { constructor(status, body, msg) { super(msg); this.status = status; this.body = body; } }

class OpenRouter {
  constructor({ key, base = 'https://openrouter.ai/api/v1', timeoutMs = 300000, retryWaitMs = 4000 } = {}) {
    this.key = key; this.base = String(base).replace(/\/$/, ''); this.timeoutMs = timeoutMs; this.retryWaitMs = retryWaitMs;
  }
  async _once(method, path, body) {
    const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), this.timeoutMs); const t0 = Date.now();
    try {
      const res = await fetch(this.base + path, { method, signal: ctl.signal, headers: { Authorization: `Bearer ${this.key}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
      const text = await res.text(); let json = null; try { json = text ? JSON.parse(text) : null; } catch { json = { raw: text.slice(0, 300) }; }
      return { status: res.status, json, ms: Date.now() - t0 };
    } catch (e) {
      const why = e.name === 'AbortError' ? `waktu habis setelah ${Math.round(this.timeoutMs / 1000)} detik` : `koneksi gagal (${e.cause && e.cause.code || e.message})`;
      return { status: 0, json: null, ms: Date.now() - t0, netError: why };
    } finally { clearTimeout(timer); }
  }
  // Satu percobaan ulang untuk kegagalan sementara (jaringan, 5xx). Kegagalan 4xx tidak diulang. Gambar gagal tidak ditagih.
  async call(method, path, body) {
    let r = await this._once(method, path, body); let tries = 1;
    if (r.status === 0 || r.status >= 500) { await sleep(this.retryWaitMs); r = await this._once(method, path, body); tries = 2; }
    if (r.status === 0) throw new ApiError(0, null, `Tidak tersambung ke OpenRouter: ${r.netError}.`);
    if (r.status < 200 || r.status >= 300) throw new ApiError(r.status, r.json, core.describeError(r.status, r.json));
    return { ...r, tries };
  }
  get(path) { return this.call('GET', path); }
  post(path, body) { return this.call('POST', path, body); }
}
module.exports = { OpenRouter, ApiError };

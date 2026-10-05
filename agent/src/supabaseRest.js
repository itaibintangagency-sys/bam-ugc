'use strict';
// Klien REST Supabase minimal (tanpa pustaka tambahan): login, RPC, dan penyimpanan.
const fs = require('fs');
const path = require('path');
const sleep = ms => new Promise(r => setTimeout(r, ms));

class Supa {
  constructor({ url, anonKey, email, password }) {
    this.url = url.replace(/\/$/, ''); this.anonKey = anonKey; this.email = email; this.password = password;
    this.access = null; this.refresh = null; this.expiresAt = 0;
  }
  async _fetch(url, init, tries = 3) {
    let last;
    for (let i = 0; i < tries; i++) {
      try { return await fetch(url, init); }
      catch (e) { last = e; await sleep(800 * (i + 1)); }
    }
    throw new Error(`Koneksi ke Supabase gagal: ${last && last.message}`);
  }
  async _tokenCall(qs, body) {
    const res = await this._fetch(`${this.url}/auth/v1/token?${qs}`, {
      method: 'POST', headers: { apikey: this.anonKey, 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`Login Supabase gagal: ${j.error_description || j.msg || j.message || res.status}`);
    this.access = j.access_token; this.refresh = j.refresh_token; this.expiresAt = Date.now() + (j.expires_in || 3600) * 1000;
    if (j.user && j.user.id) this.userId = j.user.id;
  }
  async signIn() { await this._tokenCall('grant_type=password', { email: this.email, password: this.password }); }
  async token() {
    if (!this.access) await this.signIn();
    else if (Date.now() > this.expiresAt - 60000) {
      try { await this._tokenCall('grant_type=refresh_token', { refresh_token: this.refresh }); } catch { await this.signIn(); }
    }
    return this.access;
  }
  async _headers(extra = {}) { return { apikey: this.anonKey, Authorization: `Bearer ${await this.token()}`, ...extra }; }

  async rpc(fn, args = {}) {
    const res = await this._fetch(`${this.url}/rest/v1/rpc/${fn}`, {
      method: 'POST', headers: await this._headers({ 'Content-Type': 'application/json' }), body: JSON.stringify(args)
    });
    const text = await res.text();
    let j = null; try { j = text ? JSON.parse(text) : null; } catch { j = text; }
    if (!res.ok) throw new Error(`RPC ${fn} gagal (${res.status}): ${(j && (j.message || j.hint)) || text}`);
    return j;
  }
  // Operasi tabel (PostgREST). RLS di database tetap berlaku untuk pengguna yang login.
  async _table(method, table, { query = '', body, prefer } = {}) {
    const res = await this._fetch(`${this.url}/rest/v1/${table}${query ? '?' + query : ''}`, {
      method, headers: await this._headers({ 'Content-Type': 'application/json', ...(prefer ? { Prefer: prefer } : {}) }), body: body === undefined ? undefined : JSON.stringify(body)
    });
    const text = await res.text(); let j = null; try { j = text ? JSON.parse(text) : null; } catch { j = text; }
    if (!res.ok) { const e = new Error(`${method} ${table} gagal (${res.status}): ${(j && (j.message || j.hint)) || text}`); e.status = res.status; e.code = j && j.code; throw e; }
    return j;
  }
  select(table, query = 'select=*') { return this._table('GET', table, { query }); }
  async insert(table, row) { const r = await this._table('POST', table, { body: row, prefer: 'return=representation' }); return Array.isArray(r) ? r[0] : r; }
  async update(table, query, patch) { return this._table('PATCH', table, { query, body: patch, prefer: 'return=representation' }); }
  async download(bucket, objectPath, dest) {
    const res = await this._fetch(`${this.url}/storage/v1/object/authenticated/${bucket}/${objectPath.split('/').map(encodeURIComponent).join('/')}`, { headers: await this._headers() });
    if (!res.ok) throw new Error(`Unduh ${bucket}/${objectPath} gagal (${res.status})`);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
    return dest;
  }
  async upload(bucket, objectPath, file, contentType = 'application/octet-stream') {
    const body = fs.readFileSync(file);
    const res = await this._fetch(`${this.url}/storage/v1/object/${bucket}/${objectPath.split('/').map(encodeURIComponent).join('/')}`, {
      method: 'POST', headers: await this._headers({ 'Content-Type': contentType, 'x-upsert': 'true' }), body
    });
    if (!res.ok) throw new Error(`Unggah ${bucket}/${objectPath} gagal (${res.status}): ${await res.text().catch(() => '')}`);
    return objectPath;
  }
}
module.exports = { Supa };

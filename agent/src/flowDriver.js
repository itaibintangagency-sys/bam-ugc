'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const { chromium } = require('playwright-core');
const { NeedsHuman, FlowError } = require('./errors');
const inventory = require('./inventory');
const { Labels } = require('./labels');
const POPUP_ANY = /\b(Image|Gambar|Video|Frames?|Ingredients|Bahan)\b/i;

const sleep = ms => new Promise(r => setTimeout(r, ms));
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

async function connectFlow(cfg, log) {
  const url = process.env.CDP_URL || cfg.chrome.cdp_url;
  const match = process.env.PAGE_MATCH || cfg.chrome.page_match;
  let browser;
  try { browser = await chromium.connectOverCDP(url); }
  catch (e) { throw new NeedsHuman(`Tidak bisa terhubung ke Chrome (${url}). Buka Chrome lewat start-chrome.bat. Detail: ${e.message}`, 'no_chrome'); }
  const ctx = browser.contexts()[0];
  const cands = ctx.pages().filter(p => p.url().includes(match));
  let page = null;
  if (cands.length) {
    const info = [];
    for (const p of cands) info.push({ p, project: /\/project\//.test(p.url()), visible: await p.evaluate(() => document.visibilityState === 'visible').catch(() => false) });
    const rank = x => (x.project ? 2 : 0) + (x.visible ? 1 : 0);
    info.sort((a, b) => rank(b) - rank(a));
    page = info[0].p;
    if (cands.length > 1) log.warn(`Ada ${cands.length} tab Flow; memakai: ${page.url().replace(/\/project\/[0-9a-f-]+/i, '/project/<id>')}`);
  }
  if (!page) {
    log.info('Tab Flow belum ada, membuka halaman baru.');
    page = await ctx.newPage();
  }
  return { browser, ctx, page, match };
}

class FlowDriver {
  constructor({ page, ctx, cfg, log, downloadDir, debugDir }) {
    this.page = page; this.ctx = ctx; this.cfg = cfg; this.log = log;
    this.lg = new Labels(cfg);
    this.lang = null;
    this.downloadDir = downloadDir || path.join(os.homedir(), 'Downloads');
    this.debugDir = debugDir || path.join(process.cwd(), 'debug');
    this.minVideoBytes = Number(process.env.MIN_VIDEO_BYTES || 20000);
  }

  // ── pengaman ────────────────────────────────────────────────
  assertSafe(label) {
    for (const f of this.cfg.forbiddenClicks) {
      if (new RegExp(esc(f), 'i').test(label)) throw new FlowError(`Klik dilarang oleh pengaman: "${label}"`, 'fatal');
    }
  }
  async click(locator, label, opts = {}) {
    this.assertSafe(label);
    await locator.click({ timeout: opts.timeout || 10000 });
  }

  async captchaCheck() {
    const info = await this.page.evaluate(() => {
      const vis = el => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none'; };
      const frames = [...document.querySelectorAll('iframe')].filter(i => /recaptcha|hcaptcha|captcha/i.test(i.src || ''));
      const challenge = frames.filter(i => { const r = i.getBoundingClientRect(); return vis(i) && r.width >= 250 && r.height >= 250; });
      const body = document.body ? document.body.innerText : '';
      const text = /verify (that )?you('| a)re human|i'm not a robot|bukan robot|pilih semua gambar|select all images/i.test(body);
      return { challenge: challenge.length > 0, text };
    }).catch(() => ({ challenge: false, text: false }));
    if (info.challenge || info.text) throw new NeedsHuman('Terdeteksi captcha/verifikasi. Selesaikan manual di Chrome.', 'captcha');
    if (/accounts\.google\.com/.test(this.page.url())) throw new NeedsHuman('Sesi Google habis. Login manual di Chrome khusus.', 'login');
  }

  // ── elemen ─────────────────────────────────────────────────
  chip() { return this.page.locator(this.lg.aria('settingsChip')).first(); }
  editor() { return this.page.locator('[contenteditable]:not([contenteditable="false"]):visible').last(); }
  radio(re) { return this.page.getByRole('radio', { name: re }).first(); }
  uploadBtn() { return this.page.getByRole('button', { name: this.lg.nameRe('uploadMedia') }); }
  assetItem(name) { return this.page.locator('[role="option"].asset-item, button.asset-item').filter({ hasText: name }).first(); }
  // Jumlah bahan yang terlampir di kotak prompt. Dua jalur: tombol bahan lama (button.chip-container)
  // atau gambar kecil di dalam wadah komposer (tampilan Flow sejak Oktober). Salah satu cukup.
  async composerAttachments() {
    return this.page.evaluate(() => {
      const vis = el => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none'; };
      const chips = [...document.querySelectorAll('button.chip-container')].filter(vis).length;
      const ed = [...document.querySelectorAll('[contenteditable]:not([contenteditable="false"])')].filter(vis).pop();
      let thumbs = 0;
      if (ed) {
        let root = ed;
        for (let i = 0; i < 6 && root.parentElement; i++) {
          root = root.parentElement;
          if ([...root.querySelectorAll('button')].some(b => (b.innerText || '').trim() === 'arrow_forward')) break;
        }
        thumbs = [...root.querySelectorAll('img')].filter(i => { const r = i.getBoundingClientRect(); return vis(i) && r.width >= 20 && r.width <= 220 && !i.closest('.mention'); }).length;
      }
      return { chips, thumbs, total: chips || thumbs };
    });
  }
  async chipCount() { return (await this.composerAttachments()).total; }

  async visibleButtonNames(max = 30) {
    return this.page.evaluate(max => {
      const seen = new Set(); const out = [];
      for (const el of document.querySelectorAll('button, [role="button"]')) {
        const r = el.getBoundingClientRect(); if (r.width <= 0 || r.height <= 0) continue;
        const n = (el.getAttribute('aria-label') || (el.innerText || '').trim().replace(/\s+/g, ' ')).slice(0, 50);
        if (n && !seen.has(n) && !/^Google Account/i.test(n)) { seen.add(n); out.push(n); }
        if (out.length >= max) break;
      }
      return out;
    }, max).catch(() => []);
  }

  // Nama akun Google yang sedang dipakai Flow (tanpa email), untuk memastikan akun yang benar saat berganti akun.
  async accountName() {
    const label = await this.page.evaluate(() => { const a = document.querySelector('[aria-label^="Google Account"], [aria-label^="Akun Google"]'); return a ? a.getAttribute('aria-label') : ''; }).catch(() => '');
    const m = /^(?:Google Account|Akun Google):\s*([^\n(]+)/i.exec(label || '');
    return m ? m[1].trim() : '';
  }

  async detectLanguage() {
    this.lang = await this.lg.detect(this.page);
    return this.lang;
  }

  async assertLayout() {
    await this.captchaCheck();
    if (!(await this.chip().count())) {
      const names = await this.visibleButtonNames();
      const url = this.page.url().replace(/\/project\/[0-9a-f-]+/i, '/project/<id>');
      throw new NeedsHuman(`Tombol pengaturan ("${this.lg.show('settingsChip')}") tidak terlihat. Tab: ${url}. Tombol yang terlihat: ${names.join(' | ') || '(tidak ada)'}. Ukuran jendela Chrome mungkin berbeda, halaman bukan project, atau nama tombol Flow berubah.`, 'layout');
    }
    await this.detectLanguage();
  }

  // Pop-up pengaturan dianggap terbuka bila ada pilihan mode apa pun yang terlihat (Image, Video, Frames, Ingredients)
  // atau tombol pemilih model. Tidak hanya bergantung pada pilihan bernama "Video".
  async popupOpen() {
    const r = this.page.getByRole('radio', { name: POPUP_ANY }).first();
    if ((await r.count()) > 0 && await r.isVisible().catch(() => false)) return true;
    const m = this.page.getByRole('button', { name: this.lg.nameRe('modelPicker') }).first();
    return (await m.count()) > 0 && await m.isVisible().catch(() => false);
  }

  async visibleRadioNames(max = 20) {
    return this.page.evaluate(max => [...document.querySelectorAll('[role="radio"]')]
      .filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; })
      .map(e => (e.getAttribute('aria-label') || (e.innerText || '').trim()).replace(/\s+/g, ' ').slice(0, 30)).filter(Boolean).slice(0, max), max).catch(() => []);
  }

  // Membuka pop-up pengaturan dengan sabar: memeriksa berulang sampai ~8 detik (POPUP_WAIT_MS), berlanjut begitu
  // pop-up muncul, dan mengulang klik kapsul sampai 3 kali. Mengembalikan lama menunggu (ms).
  async openSettingsPopup() {
    const total = Number(process.env.POPUP_WAIT_MS || 8000), attempts = 3;
    const slice = Math.max(500, Math.floor(total / attempts));
    const t0 = Date.now();
    for (let a = 1; a <= attempts; a++) {
      if (await this.popupOpen()) return Date.now() - t0;
      await this.chip().click({ timeout: 8000 });
      const end = Date.now() + slice;
      while (Date.now() < end) { if (await this.popupOpen()) return Date.now() - t0; await sleep(100); }
    }
    if (await this.popupOpen()) return Date.now() - t0;
    const radios = await this.visibleRadioNames(), names = await this.visibleButtonNames();
    const chip = (await this.readChip()).text;
    throw new NeedsHuman(`Pop-up pengaturan tidak terbuka setelah ${attempts} klik dalam ${Math.round((Date.now() - t0) / 1000)} detik. Kapsul: "${chip}". Pilihan yang terlihat: ${radios.join(' | ') || '(tidak ada)'}. Tombol yang terlihat: ${names.join(' | ') || '(tidak ada)'}.`, 'layout');
  }
  async panelOpen() { const b = this.uploadBtn(); return (await b.count()) > 0 && await b.first().isVisible().catch(() => false); }

  async closePopup() {
    if (!(await this.popupOpen())) return;
    await this.page.keyboard.press('Escape'); await sleep(500);
    if (await this.popupOpen()) { await this.chip().click({ timeout: 5000 }).catch(() => {}); await sleep(500); }
  }
  async closePanel() {
    if (!(await this.panelOpen())) return;
    const b = this.page.locator(this.lg.aria('closePanel')).last();
    if (await b.count()) await b.click({ timeout: 5000 }).catch(() => {}); else await this.page.keyboard.press('Escape');
    await sleep(700);
  }
  async closeOverlays() { await this.closePanel(); await this.closePopup(); }

  // ── project ────────────────────────────────────────────────
  assertProjectUrl(u) {
    if (process.env.ALLOW_ANY_PROJECT_URL === '1') return;
    if (!/^https:\/\/flow\.google\.com\/(?:u\/\d+\/)?project\/[^/\s?#]+/.test(String(u || ''))) {
      throw new FlowError(`Alamat project bukan alamat Flow: "${String(u).slice(0, 80)}". Harus berawalan https://flow.google.com/project/ (buka project di Chrome, lalu salin alamat dari tab itu).`, 'fatal');
    }
  }

  async openProject(projectUrl) {
    this.assertProjectUrl(projectUrl);
    const norm = u => { try { const x = new URL(u); return x.origin + x.pathname + x.search; } catch { return u; } };
    const here = this.page.url();
    const inDetail = /\/edit\//.test(here);
    if (norm(here).startsWith(norm(projectUrl).replace(/#.*$/, '')) && !inDetail) {
      /* sudah di project */
    } else if (inDetail && norm(here).startsWith(norm(projectUrl))) {
      await this.backToProject(projectUrl);
    } else {
      this.log.info(`Membuka project: ${projectUrl}`);
      await this.page.goto(projectUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
    }
    await this.page.bringToFront();
    for (let i = 0; i < 30; i++) {
      await this.captchaCheck();
      if (await this.chip().count()) break;
      await sleep(1000);
    }
    await this.assertLayout();
    await this.closeOverlays();
  }

  async backToProject(projectUrl) {
    const back = this.page.getByRole('button', { name: this.lg.nameRe('back') });
    if (await back.count()) await back.first().click({ timeout: 8000 }).catch(() => {});
    for (let i = 0; i < 15; i++) { if (await this.chip().count()) return; await sleep(800); }
    await this.page.goto(projectUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await this.assertLayout();
  }

  // ── project baru dan mode Agen ──────────────────────────────
  homeUrl() {
    if (process.env.FLOW_HOME_URL) return process.env.FLOW_HOME_URL;
    const m = this.page.url().match(/^(https:\/\/[^/]+\/(?:u\/\d+\/)?)/);
    return m ? m[1] : 'https://flow.google.com/';
  }

  async createProject(name) {
    await this.captchaCheck();
    await this.page.goto(this.homeUrl(), { waitUntil: 'domcontentloaded', timeout: 60000 });
    await sleep(1500);
    const re = this.lg.partialRe('labels', 'newProject');
    const btn = this.page.getByRole('button', { name: re }).or(this.page.getByText(re)).first();
    await this.click(btn, this.lg.show('newProject'), { timeout: 20000 });
    let ok = false;
    for (let i = 0; i < 40; i++) {
      await this.captchaCheck();
      if (/\/project\//.test(this.page.url()) && (await this.chip().count())) { ok = true; break; }
      await sleep(1000);
    }
    if (!ok) throw new NeedsHuman('Project baru tidak terbuka setelah mengklik "' + this.lg.show('newProject') + '".', 'layout');
    if (name) await this.renameProject(name);
    return this.page.url();
  }

  async renameProject(name) {
    const inp = this.page.locator(this.lg.aria('projectTitleInput', 'input')).first();
    if (!(await inp.count())) throw new FlowError('Kolom nama project tidak ditemukan', 'fatal');
    await inp.click({ timeout: 5000 });
    await this.page.keyboard.press('Control+A');
    await this.page.keyboard.insertText(name);
    await this.page.keyboard.press('Enter');
    await sleep(800);
    const v = await inp.inputValue().catch(() => '');
    if (v !== name) throw new FlowError(`Nama project tidak berubah (terbaca "${v}")`, 'unknown');
    return v;
  }

  // Mode Agen harus mati supaya kotak prompt berperilaku seperti biasa.
  async ensureAgentOff() {
    const b = this.page.getByRole('button', { name: this.lg.nameRe('agentToggle') }).first();
    if (!(await b.count())) return 'tidak_ada';
    const st = (await b.getAttribute('aria-pressed')) ?? (await b.getAttribute('aria-checked'));
    if (st === 'true') { await b.click({ timeout: 5000 }); await sleep(500); return 'dimatikan'; }
    return st === null ? 'tidak_diketahui' : 'mati';
  }

  // ── pengaturan ─────────────────────────────────────────────
  async clickRadio(re, label) {
    const r = this.radio(re);
    if (!(await r.count())) throw new FlowError(`Pilihan "${label}" tidak ditemukan di pop-up pengaturan`, 'fatal');
    await r.click({ timeout: 5000 }); await sleep(300);
    const checked = await r.getAttribute('aria-checked');
    if (checked !== null && checked !== 'true') throw new FlowError(`Pilihan "${label}" tidak terpilih setelah diklik`, 'fatal');
  }

  async readCredits() {
    const re = this.lg.creditsRe(), sentence = this.lg.creditsSentenceRe();
    return this.page.evaluate(({ re, sentence }) => {
      const r1 = new RegExp(re.source, re.flags), r2 = new RegExp(sentence.source, sentence.flags);
      for (const el of document.querySelectorAll('a, span, div, p, button')) {
        const m = (el.innerText || '').trim().match(r1);
        if (m && el.getBoundingClientRect().width > 0) return Number(m[1]);
      }
      const m2 = (document.body.innerText || '').match(r2);
      return m2 ? Number(m2[1]) : null;
    }, { re: { source: re.source, flags: re.flags }, sentence: { source: sentence.source, flags: sentence.flags } });
  }

  async applySettings({ res, dur, n = 1, ratio = '9:16' }) {
    await this.closePanel();
    await this.openSettingsPopup();
    const lg = this.lg;
    await this.clickRadio(lg.partialRe('radios', 'mode'), lg.show('mode', 'radios'));
    await this.clickRadio(lg.partialRe('radios', 'submode'), lg.show('submode', 'radios'));
    await this.clickRadio(new RegExp(esc(ratio === '16:9' ? '16:9' : '9:16')), ratio);
    await this.clickRadio(new RegExp(esc(res), 'i'), res);
    await this.clickRadio(lg.durRe(dur), `${dur} detik`);
    await this.clickRadio(new RegExp(`^\\s*x${n}\\s*$`, 'i'), `x${n}`);
    const model = (await this.page.getByRole('button', { name: lg.nameRe('modelPicker') }).first().innerText().catch(() => '')).replace(/\s+/g, ' ').trim();
    await sleep(700);
    const credits = await this.readCredits();
    await this.closePopup();
    if (model && !new RegExp(esc(this.cfg.expectModel), 'i').test(model)) {
      throw new NeedsHuman(`Model bukan ${this.cfg.expectModel} (terbaca: "${model}"). Ganti manual di pop-up pengaturan.`, 'model');
    }
    return { credits, model };
  }

  // ── komposer ───────────────────────────────────────────────
  async clearComposer() {
    await this.closeOverlays();
    const clear = this.page.locator(this.lg.aria('clearPrompt')).first();
    if (await clear.count()) { await clear.click({ timeout: 5000 }).catch(() => {}); await sleep(600); }
    const ed = this.editor();
    if (await ed.count()) {
      const len = ((await ed.innerText().catch(() => '')) || '').trim().length;
      if (len > 0) { await ed.click(); await this.page.keyboard.press('Control+A'); await this.page.keyboard.press('Delete'); await sleep(300); }
    }
    if ((await this.chipCount()) > 0) {
      const root = this.editor().locator('xpath=ancestor::*[.//button[normalize-space(.)="arrow_forward"]][1]');
      const xs = root.locator('button:visible').filter({ hasText: /^\s*(close|cancel)\s*$/ });
      for (let i = 0, n = Math.min(await xs.count(), 3); i < n && (await this.chipCount()) > 0; i++) { await xs.nth(0).click({ timeout: 3000 }).catch(() => {}); await sleep(500); }
    }
    if ((await this.chipCount()) > 0) throw new NeedsHuman('Masih ada bahan terlampir di kotak prompt. Hapus manual lalu lanjutkan.', 'leftover');
  }

  // Mengunggah satu berkas ke aset project (tanpa melampirkannya ke kotak prompt).
  async uploadAsset(file, uniqueName, { keepPanelOpen = false } = {}) {
    await this.closePopup();
    const tmp = path.join(os.tmpdir(), uniqueName);
    fs.copyFileSync(file, tmp);
    try {
      if (!(await this.panelOpen())) {
        await this.click(this.page.getByRole('button', { name: this.lg.nameRe('addIngredient') }).first(), this.lg.show('addIngredient'));
        await sleep(1500);
      }
      if (!(await this.panelOpen())) throw new FlowError('Panel aset tidak terbuka', 'fatal');
      const [chooser] = await Promise.all([
        this.page.waitForEvent('filechooser', { timeout: 15000 }),
        this.click(this.uploadBtn().first(), this.lg.show('uploadMedia'))
      ]);
      await chooser.setFiles(tmp);
      const limit = this.cfg.timeouts.upload_sec * 1000, t0 = Date.now();
      let done = false;
      while (Date.now() - t0 < limit) {
        const it = this.assetItem(uniqueName);
        if (await it.count()) { const t = await it.innerText().catch(() => ''); if (!/Mengupload|Uploading/i.test(t)) { done = true; break; } }
        await sleep(1200);
      }
      if (!done) throw new FlowError('Upload tidak selesai tepat waktu', 'timeout');
      if (!keepPanelOpen) await this.closePanel();
    } finally { try { fs.unlinkSync(tmp); } catch { /* abaikan */ } }
  }

  async uploadAndAttach(file, uniqueName, { expect = 1 } = {}) {
    await this.uploadAsset(file, uniqueName, { keepPanelOpen: true });
    await this.click(this.assetItem(uniqueName), `aset ${uniqueName}`);
    await sleep(1500);
    // Tampilan baru: mengklik item hanya memilih dan membuka pratinjau. Bahan baru terlampir
    // setelah tombol "Add to prompt". Pada tampilan lama tombol ini tidak ada dan klik langsung melampirkan.
    const add = this.page.getByRole('button', { name: this.lg.nameRe('addToPrompt') }).first();
    if ((await add.count()) && (await add.isVisible().catch(() => false))) {
      await this.click(add, this.lg.show('addToPrompt'));
      await sleep(1500);
    }
    if (await this.panelOpen()) await this.closePanel();
    let n = 0;
    for (let i = 0; i < 10; i++) { n = await this.chipCount(); if (n === expect) break; await sleep(800); }
    if (n !== expect) {
      const names = await this.visibleButtonNames();
      throw new FlowError(`Bahan tidak terlampir (diharapkan ${expect}, terlihat: ${n}). Tombol yang terlihat: ${names.join(' | ') || '(tidak ada)'}`, 'unknown');
    }
  }

  // Membaca kapsul pengaturan: resolusi, durasi, jumlah, dan rasio.
  async readChip() {
    const t = ((await this.chip().innerText().catch(() => '')) || '').replace(/\s+/g, ' ').trim();
    // Contoh teks asli: "Video · 360p · 10s crop_9_16 x1". Dipotong sebelum ikon rasio supaya tidak bergantung pada spasi.
    const head = t.replace(/\s*x\d\s*$/, '').split(/crop_/)[0].trim();
    return {
      text: t,
      res: (head.match(/(360p|720p)/) || [])[1] || null,
      dur: Number((head.match(/(\d+)\s*(?:dtk|s)\s*$/i) || [])[1]) || null,
      n: Number((t.match(/x(\d)\s*$/) || [])[1]) || null,
      ratio: /crop_9_16/.test(t) ? '9:16' : /crop_16_9/.test(t) ? '16:9' : null
    };
  }

  // Pengaturan bisa berubah setelah bahan dilampirkan. Periksa ulang sebelum generate dan perbaiki bila perlu.
  async ensureSettings(want) {
    const ok = c => c.res === want.res && c.dur === want.dur && c.n === (want.n || 1) && (!c.ratio || c.ratio === (want.ratio || '9:16'));
    let cur = await this.readChip();
    if (ok(cur)) return cur;
    this.log.warn(`Setelan berubah menjadi "${cur.text}"; mengatur ulang.`);
    await this.applySettings(want);
    cur = await this.readChip();
    if (!ok(cur)) throw new FlowError(`Setelan tidak sesuai setelah diatur ulang (terbaca: "${cur.text}")`, 'fatal');
    return cur;
  }

  // Penanda @[Nama] pada teks prompt diganti dengan pemilihan lewat daftar "@" di Flow.
  static splitMentions(text) {
    return String(text).split(/(@\[[^\]]+\])/).map(p => {
      const m = p.match(/^@\[([^\]]+)\]$/);
      return m ? { mention: m[1] } : { text: p };
    }).filter(x => x.mention || x.text);
  }

  async insertMention(name) {
    await this.page.keyboard.type('@');
    const search = this.page.locator(this.lg.aria('mentionSearch', 'input')).first();
    try { await search.waitFor({ state: 'visible', timeout: 6000 }); }
    catch { throw new FlowError('Daftar "@" tidak muncul setelah mengetik "@"', 'fatal'); }
    await this.page.keyboard.type(name, { delay: 30 });
    await sleep(900);
    const item = this.assetItem(name);
    if (!(await item.count())) throw new FlowError(`Karakter/aset "${name}" tidak ditemukan di daftar "@"`, 'fatal');
    await this.click(item, `penanda ${name}`);
    await sleep(800);
    if (await this.panelOpen()) await this.closePanel();
  }

  async fillPromptWithMentions(text) {
    const parts = FlowDriver.splitMentions(text);
    if (!parts.some(p => p.mention)) return this.fillPrompt(text);
    const ed = this.editor();
    if (!(await ed.count())) throw new FlowError('Kotak prompt tidak ditemukan', 'fatal');
    await ed.click({ timeout: 5000 });
    await this.page.keyboard.press('Control+A');
    await this.page.keyboard.press('Delete');
    for (const p of parts) {
      if (p.mention) await this.insertMention(p.mention);
      else await this.page.keyboard.insertText(p.text);
    }
    await sleep(800);
    const back = ((await ed.innerText().catch(() => '')) || '');
    const norm = s => s.replace(/\s+/g, '');
    const texts = parts.filter(p => p.text).map(p => p.text);
    const first = norm(texts[0] || ''), last = norm(texts[texts.length - 1] || ''), b = norm(back);
    const plain = norm(texts.join(''));
    const names = parts.filter(p => p.mention).map(p => norm('@' + p.mention));
    const ok = b.includes(first.slice(0, 25)) && b.includes(last.slice(-25)) && b.length >= plain.length * 0.97
      && names.every(n => b.includes(n));
    if (!ok) throw new FlowError(`Isi prompt dengan penanda tidak cocok (terbaca ${b.length}, diharapkan sekitar ${plain.length})`, 'unknown');
    return back.length;
  }

  async fillPrompt(text) {
    const ed = this.editor();
    if (!(await ed.count())) throw new FlowError('Kotak prompt tidak ditemukan', 'fatal');
    await ed.click({ timeout: 5000 });
    await this.page.keyboard.press('Control+A');
    await this.page.keyboard.insertText(text);
    await sleep(800);
    const back = ((await ed.innerText().catch(() => '')) || '');
    const norm = s => s.replace(/\s+/g, '');
    const a = norm(text), b = norm(back);
    if (!(b.length >= a.length * 0.97 && b.length <= a.length * 1.03 && b.startsWith(a.slice(0, 20)))) {
      throw new FlowError(`Isi prompt tidak cocok (dikirim ${a.length}, terbaca ${b.length})`, 'unknown');
    }
    return back.length;
  }

  // ── sinyal halaman ─────────────────────────────────────────
  async signals() {
    return this.page.evaluate(({ alts, reuse, failWords }) => {
      const vis = el => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none'; };
      const thumbs = [...document.querySelectorAll('img')].filter(vis).filter(i => alts.includes(i.alt))
        .map(i => { const r = i.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), src: i.currentSrc || i.src }; })
        .sort((a, b) => a.y - b.y || a.x - b.x);
      const reuseN = [...document.querySelectorAll('button')].filter(b => vis(b) && reuse.includes(b.getAttribute('aria-label'))).length;
      const words = failWords.map(w => w.toLowerCase());
      const fails = [...document.querySelectorAll('*')].filter(el => el.children.length === 0 && vis(el) && words.includes((el.textContent || '').trim().toLowerCase()))
        .map(el => { let c = el; for (let i = 0; i < 4 && c.parentElement && (c.innerText || '').length < 60; i++) c = c.parentElement; return (c.innerText || '').replace(/\s+/g, ' ').slice(0, 400); });
      const refresh = [...document.querySelectorAll('button')].filter(b => vis(b) && (b.innerText || '').trim() === 'refresh')
        .map(b => { const r = b.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y) }; }).sort((a, b) => a.y - b.y || a.x - b.x);
      const ed = [...document.querySelectorAll('[contenteditable]:not([contenteditable="false"])')].filter(vis).pop();
      return { url: location.href, thumbs, reuse: reuseN, fails, refresh, chips: 0, promptLen: ed ? (ed.innerText || '').trim().length : 0 };
    }, { alts: this.lg.all('alts', 'videoThumb'), reuse: this.lg.label('reusePrompt'), failWords: this.lg.failureWords() })
      .then(async s => { s.chips = (await this.composerAttachments()).total; return s; });
  }

  classify(message) { return this.lg.classify(message); }

  // ── generate ───────────────────────────────────────────────
  async generate({ minPromptChars = 200, expectedChips = 1, beforeClick = null } = {}) {
    await this.assertLayout();
    const s = await this.signals();
    if (expectedChips !== null && s.chips !== expectedChips) throw new FlowError(`Pengaman: bahan terlampir harus ${expectedChips}, terbaca ${s.chips}`, 'fatal');
    if (s.promptLen < minPromptChars) throw new FlowError(`Pengaman: prompt terlalu pendek (${s.promptLen})`, 'fatal');
    const before = { ...s, topSrc: s.thumbs[0] ? s.thumbs[0].src : null };
    if (beforeClick) await beforeClick();
    await this.click(this.page.getByRole('button', { name: this.lg.nameRe('generate') }).first(), this.lg.show('generate'));
    return before;
  }

  async waitResult(before, { onPoll, assumeStarted = false } = {}) {
    const T = this.cfg.timeouts;
    const settleMs = (T.settle_sec ?? 8) * 1000;
    const t0 = Date.now(); let started = assumeStarted, peak = before.reuse, calmSince = null, snapped = false;
    while (Date.now() - t0 < T.generate_sec * 1000) {
      await sleep(T.poll_ms);
      await this.captchaCheck();
      const s = await this.signals();
      if (onPoll) onPoll(s);
      const topNow = s.thumbs[0] ? s.thumbs[0].src : null;
      if (s.fails.length > before.fails.length) return { status: 'failed', message: s.fails[0] };
      if (s.reuse > peak) peak = s.reuse;   // jumlah penanda "sedang memproses" tertinggi yang pernah terlihat
      if (s.reuse > before.reuse || topNow !== before.topSrc) started = true;
      if (topNow && topNow !== before.topSrc && s.reuse <= before.reuse) return { status: 'ok', signals: s, via: 'thumbnail' };
      // Cadangan: penanda "sedang memproses" sudah hilang cukup lama walau gambar mini baru belum terbaca
      // (mis. Chrome tertutup jendela lain, atau tile baru memakai elemen berbeda). Video dicari lewat kode job.
      // Syaratnya penanda sempat naik lalu TURUN dari puncaknya (bukan sekadar tidak lebih banyak dari awal), supaya
      // proses yang masih berjalan (mis. setelah klik ulang kartu gagal) tidak dianggap selesai.
      if (s.reuse < peak && s.reuse <= before.reuse) {
        if (calmSince === null) calmSince = Date.now();
        if (Date.now() - calmSince >= settleMs) {
          if (!snapped) { snapped = true; await this.debugSnap('wait-fallback').catch(() => {}); }
          return { status: 'ok', signals: s, via: 'fallback' };
        }
      } else calmSince = null;
      if (!started && Date.now() - t0 > T.start_sec * 1000) return { status: 'failed', message: 'Generate tidak tampak dimulai', kind: 'unknown' };
    }
    return { status: 'failed', message: 'Waktu tunggu generate habis', kind: 'timeout' };
  }

  // Koordinat tile video pada grid project, terurut dari kiri atas. Dua sumber: gambar mini video, dan label resolusi
  // (360p/720p) pada tile. Label resolusi tidak bergantung pada bahasa dan tidak bergantung pada elemen gambar mini.
  async videoTiles() {
    return this.page.evaluate(({ alts }) => {
      const vis = el => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none'; };
      const out = [];
      const push = el => { const r = el.getBoundingClientRect(); out.push({ x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), w: Math.round(r.width), h: Math.round(r.height) }); };
      for (const i of document.querySelectorAll('img')) if (vis(i) && alts.includes(i.alt)) push(i);
      for (const el of document.querySelectorAll('*')) {
        if (el.children.length || !vis(el) || !/^(360p|720p|1080p)$/i.test((el.textContent || '').trim())) continue;
        let c = el;
        for (let k = 0; k < 6 && c.parentElement; k++) { c = c.parentElement; const r = c.getBoundingClientRect(); if (r.width >= 100 && r.height >= 140) break; }
        push(c);
      }
      const uniq = [];
      for (const t of out) if (!uniq.some(u => Math.abs(u.x - t.x) < 40 && Math.abs(u.y - t.y) < 40)) uniq.push(t);
      return uniq.sort((a, b) => a.y - b.y || a.x - b.x);
    }, { alts: this.lg.all('alts', 'videoThumb') });
  }

  // Menunggu penanda "sedang memproses" hilang dan tetap hilang selama masa tenang.
  async waitProcessingEnd({ maxMs } = {}) {
    const limit = maxMs ?? Number(process.env.PROCESS_END_MS || 180000);
    const settle = (this.cfg.timeouts.settle_sec ?? 8) * 1000;
    const t0 = Date.now(); let calm = null;
    while (Date.now() - t0 < limit) {
      await this.captchaCheck();
      const s = await this.signals();
      if (s.reuse === 0) { calm = calm ?? Date.now(); if (Date.now() - calm >= settle) return true; } else calm = null;
      await sleep(1000);
    }
    return false;
  }

  // Mencari video milik job ini: membuka tile satu per satu dan mencocokkan kode job pada prompt yang tampil di
  // halaman detail. Tidak mengandalkan "tile pertama", jadi tidak bisa mengunduh video milik job lain.
  async findJobVideo(token, { projectUrl, timeoutMs, kind = 'unknown' } = {}) {
    const limit = timeoutMs ?? Number(process.env.FIND_VIDEO_MS || (this.cfg.timeouts.find_video_sec ?? 120) * 1000);
    const checkMs = Number(process.env.TOKEN_CHECK_MS || 6000);
    const t0 = Date.now(); let tried = 0, lastReload = Date.now();
    while (Date.now() - t0 < limit) {
      if (/\/edit\//.test(this.page.url())) await this.backToProject(projectUrl);
      const count = Math.min((await this.videoTiles()).length, 8);
      for (let i = 0; i < count; i++) {
        if (/\/edit\//.test(this.page.url())) await this.backToProject(projectUrl);
        const tile = (await this.videoTiles())[i]; if (!tile) break;
        await this.page.mouse.click(tile.x, tile.y); tried++;
        let opened = false;
        for (let k = 0; k < 12; k++) { if (/\/edit\//.test(this.page.url())) { opened = true; break; } await sleep(500); }
        if (!opened) continue;
        const end = Date.now() + checkMs;
        while (Date.now() < end) {
          const txt = await this.page.locator('body').innerText().catch(() => '');
          if (txt.includes(token)) return { url: this.page.url(), tried };
          await sleep(400);
        }
        await this.backToProject(projectUrl);
      }
      if (Date.now() - lastReload > 30000) { await this.page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {}); await this.assertLayout().catch(() => {}); lastReload = Date.now(); }
      await sleep(Number(process.env.FIND_RETRY_MS || 3000));
    }
    throw new FlowError(`Video dengan kode job ${token} tidak ditemukan di project setelah ${Math.round((Date.now() - t0) / 1000)} detik (${tried} tile diperiksa).`
      + (kind === 'fatal' ? ' Generate pernah ditekan pada percobaan sebelumnya, jadi agent TIDAK generate ulang. Periksa project Flow secara manual; bila videonya memang tidak ada, hapus job ini lalu buat job baru.' : ''), kind);
  }


  // Klik tombol ulang pada kartu gagal terbaru. Baseline diambil SEBELUM klik:
  // kartu itu akan berubah menjadi "diproses", jadi jumlah kartu gagal turun satu.
  // Jika gagal lagi, jumlahnya kembali naik dan terdeteksi.
  async retryFailed(prevBefore) {
    const s = await this.signals();
    if (!s.refresh.length) return null;
    const r = s.refresh[0];
    const baseline = { ...s, fails: s.fails.slice(1), topSrc: prevBefore.topSrc };
    await this.page.mouse.click(r.x + 12, r.y + 12);
    await sleep(400);
    return baseline;
  }

  // ── video jadi ─────────────────────────────────────────────
  async openTopVideo() {
    const s = await this.signals();
    if (!s.thumbs.length) throw new FlowError('Tidak ada thumbnail video untuk dibuka', 'unknown');
    const t = s.thumbs[0];
    await this.page.mouse.click(t.x + t.w / 2, t.y + t.h / 2);
    for (let i = 0; i < 25; i++) { if (/\/edit\//.test(this.page.url())) return this.page.url(); await sleep(800); }
    throw new FlowError('Layar detail video tidak terbuka', 'unknown');
  }

  // Daftar nama tombol di bilah atas (toolbar) halaman detail, untuk pesan galat.
  async toolbarButtonNames(max = 20) {
    return this.page.evaluate(max => {
      const seen = new Set(), out = [];
      for (const el of document.querySelectorAll('button, [role="button"]')) {
        const r = el.getBoundingClientRect(); if (r.width <= 0 || r.height <= 0 || r.top > 150) continue;
        const n = (el.getAttribute('aria-label') || (el.innerText || '').trim().replace(/\s+/g, ' ')).slice(0, 40);
        if (n && !seen.has(n) && !/^Google Account/i.test(n)) { seen.add(n); out.push(n); }
        if (out.length >= max) break;
      }
      return out;
    }, max).catch(() => []);
  }

  async visibleMenuItemNames(max = 20) {
    return this.page.evaluate(max => [...document.querySelectorAll('[role="menuitem"]')]
      .filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; })
      .map(e => (e.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 40)).filter(Boolean).slice(0, max), max).catch(() => []);
  }

  // Menutup menu yang terbuka dengan Escape, hanya bila memang ada menu terlihat (Escape tanpa menu bisa keluar dari penyunting).
  async dismissMenus() {
    for (let i = 0; i < 2; i++) {
      if (!(await this.visibleMenuItemNames(1)).length) return;
      await this.page.keyboard.press('Escape').catch(() => {}); await sleep(500);
    }
  }

  // Ikon unduh di toolbar penyunting video. Dipilih dari teks ikon Material "download" (bukan dari posisi), sehingga
  // tidak tertukar dengan ikon sampah di sebelahnya. Item menu (mis. "Download project") dikecualikan.
  async findToolbarDownload() {
    const byIcon = this.page.locator('button:visible').filter({ hasText: /^\s*download\s*$/ });
    for (let i = 0, n = await byIcon.count(); i < n; i++) {
      const b = byIcon.nth(i);
      const inMenu = await b.evaluate(el => !!el.closest('[role="menu"], [role="menuitem"], .mat-mdc-menu-panel')).catch(() => true);
      if (!inMenu) return b;
    }
    const byName = this.page.getByRole('button', { name: /^(Download|Unduh)(?: media)?$/i }).first();
    return (await byName.count()) ? byName : null;
  }

  async waitMenuItem(re, ms = 5000) {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      const it = this.page.getByRole('menuitem', { name: re }).first();
      if ((await it.count()) && (await it.isVisible().catch(() => false))) return true;
      await sleep(200);
    }
    return false;
  }

  // Membuka menu ukuran unduhan. Tampilan penyunting (sejak Oktober): ikon unduh di toolbar.
  // Tampilan lama: titik tiga lalu "Download media". Urutan: toolbar dulu, lalu cadangan lama.
  async openDownloadMenu() {
    const orig = this.lg.partialRe('menus', 'downloadOriginal');
    await this.dismissMenus();
    const icon = await this.findToolbarDownload();
    if (icon) {
      await this.click(icon, 'Unduh (ikon toolbar)');
      if (await this.waitMenuItem(orig, 5000)) return 'toolbar';
      await this.dismissMenus();
    }
    const more = this.page.getByRole('button', { name: this.lg.nameRe('moreOptions') }).first();
    if (await more.count()) {
      await this.click(more, this.lg.show('moreOptions')); await sleep(700);
      const dl = this.page.getByRole('menuitem', { name: this.lg.partialRe('menus', 'downloadMenu') }).first();
      if (await dl.count()) {
        await this.click(dl, this.lg.show('downloadMenu', 'menus'));
        if (await this.waitMenuItem(orig, 5000)) return 'menu';
      }
      await this.dismissMenus();
    }
    const bar = await this.toolbarButtonNames(), items = await this.visibleMenuItemNames();
    throw new FlowError(`Menu unduh tidak ditemukan. Tombol di toolbar: ${bar.join(' | ') || '(tidak ada)'}. Menu yang terlihat: ${items.join(' | ') || '(tidak ada)'}.`, 'unknown');
  }

  // Membuka halaman detail video dari alamat yang tercatat (untuk mengulang unduhan tanpa generate ulang).
  async openAsset(assetUrl) {
    this.assertProjectUrl(assetUrl);
    await this.page.goto(assetUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await this.page.bringToFront();
    for (let i = 0; i < 40; i++) {
      await this.captchaCheck();
      if (await this.page.locator('video:visible').count()) return this.page.url();
      await sleep(1000);
    }
    throw new FlowError('Video yang dibuat sebelumnya tidak ditemukan di alamat yang tercatat (mungkin sudah dihapus di Flow). Periksa project Flow, lalu buat job baru bila perlu. Agent tidak generate ulang otomatis.', 'fatal');
  }

  async downloadOriginal(destPath) {
    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    await this.openDownloadMenu();
    const startedAt = Date.now();
    const dlWait = this.page.waitForEvent('download', { timeout: Number(process.env.DOWNLOAD_WAIT_MS || 45000) }).catch(() => null);
    await this.click(this.page.getByRole('menuitem', { name: this.lg.partialRe('menus', 'downloadOriginal') }).first(), this.lg.show('downloadOriginal', 'menus'));
    const dl = await dlWait;
    if (dl) {
      await dl.saveAs(destPath);
    } else {
      // Cadangan: pantau folder unduhan Chrome.
      const found = await this.waitDownloadedFile(startedAt);
      fs.copyFileSync(found, destPath);
    }
    await this.page.keyboard.press('Escape').catch(() => {});
    const st = fs.statSync(destPath);
    if (st.size < this.minVideoBytes) throw new FlowError(`Berkas unduhan terlalu kecil (${st.size} byte)`, 'unknown');
    const head = Buffer.alloc(12); const fd = fs.openSync(destPath, 'r'); fs.readSync(fd, head, 0, 12, 0); fs.closeSync(fd);
    const looksMp4 = head.slice(4, 8).toString('latin1') === 'ftyp';
    if (!looksMp4) this.log.warn('Berkas unduhan tidak tampak seperti MP4 (tanpa tanda ftyp). Periksa manual.');
    return { size: st.size, looksMp4 };
  }

  async waitDownloadedFile(sinceMs) {
    const t0 = Date.now();
    while (Date.now() - t0 < Number(process.env.DOWNLOAD_WAIT_MS || 60000)) {
      const files = fs.existsSync(this.downloadDir) ? fs.readdirSync(this.downloadDir) : [];
      const cand = files.filter(f => /\.(mp4|mov|webm)$/i.test(f) && !/\.crdownload$/i.test(f))
        .map(f => ({ f, p: path.join(this.downloadDir, f), t: fs.statSync(path.join(this.downloadDir, f)).mtimeMs }))
        .filter(x => x.t >= sinceMs - 2000).sort((a, b) => b.t - a.t);
      if (cand.length) {
        const s1 = fs.statSync(cand[0].p).size; await sleep(1200);
        if (fs.statSync(cand[0].p).size === s1) return cand[0].p;
      }
      await sleep(1000);
    }
    throw new FlowError('Berkas unduhan tidak ditemukan di folder unduhan', 'unknown');
  }

  // ── diagnosa ───────────────────────────────────────────────
  async debugSnap(name) {
    try {
      fs.mkdirSync(this.debugDir, { recursive: true });
      const base = path.join(this.debugDir, `${name}-${Date.now()}`);
      await this.page.screenshot({ path: base + '.png' });
      fs.writeFileSync(base + '.json', JSON.stringify({ url: this.page.url(), items: await inventory.collect(this.page) }, null, 1));
      return base;
    } catch (e) { this.log.warn('debugSnap gagal: ' + e.message); return null; }
  }
}

module.exports = { FlowDriver, connectFlow };

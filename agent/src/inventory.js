'use strict';
// Inventaris elemen halaman. Dipakai perintah doctor dan Analisa Flow.
async function collect(page) {
  const items = await page.evaluate(() => {
    const sel = 'button, a[href], input, textarea, select, img, video, [role="button"], [role="textbox"], [role="tab"], [role="menuitem"], [role="option"], [role="combobox"], [role="radio"], [contenteditable]:not([contenteditable="false"])';
    return [...document.querySelectorAll(sel)].map(el => {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return {
        tag: el.tagName.toLowerCase(), role: el.getAttribute('role'),
        text: (el.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 60),
        aria: el.getAttribute('aria-label'), alt: el.getAttribute('alt'),
        checked: el.getAttribute('aria-checked'),
        visible: r.width > 0 && r.height > 0 && cs.visibility !== 'hidden'
      };
    }).filter(i => i.visible);
  });
  const redact = v => (typeof v === 'string' ? (/^Akun Google/i.test(v) ? 'Akun Google' : v.replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, '[email]')) : v);
  return items.map(i => ({ ...i, text: redact(i.text), aria: redact(i.aria) }));
}
// Kunci stabil: mengabaikan teks yang berubah-ubah (judul video, judul project).
const keyOf = i => [i.tag, i.role || '', i.aria || '', i.alt || '', (i.aria || i.alt) ? '' : i.text.replace(/\d+/g, '#')].join('|');
function diff(baseline, current) {
  const b = new Set(baseline.map(keyOf)), c = new Set(current.map(keyOf));
  return { hilang: [...b].filter(k => !c.has(k)), baru: [...c].filter(k => !b.has(k)) };
}

// Inventaris yang lebih dalam untuk perekam layar: ikut menangkap gambar dan kotak yang bisa diklik.
async function collectDeep(page) {
  const items = await page.evaluate(() => {
    const sel = 'button, a[href], input, textarea, select, img, video, [role="button"], [role="textbox"], [role="tab"], [role="menuitem"], [role="option"], [role="combobox"], [role="radio"], [role="listbox"], [role="listitem"], [contenteditable]:not([contenteditable="false"])';
    const base = [...document.querySelectorAll(sel)];
    const seen = new Set(base);
    const extra = [];
    for (const el of document.querySelectorAll('div, span, li, figure')) {
      if (seen.has(el) || extra.length >= 200) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 20 || r.height < 20) continue;
      if (getComputedStyle(el).cursor !== 'pointer') continue;
      const p = el.parentElement;
      if (p && getComputedStyle(p).cursor === 'pointer') continue;
      extra.push(el);
    }
    return base.concat(extra).map(el => {
      const r = el.getBoundingClientRect(); const cs = getComputedStyle(el);
      return {
        tag: el.tagName.toLowerCase(), role: el.getAttribute('role'), type: el.getAttribute('type'),
        text: (el.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 80),
        aria: el.getAttribute('aria-label'), alt: el.getAttribute('alt'), placeholder: el.getAttribute('placeholder'),
        checked: el.getAttribute('aria-checked'), pressed: el.getAttribute('aria-pressed'), cursor: cs.cursor,
        cls: typeof el.className === 'string' ? el.className.slice(0, 60) : null,
        visible: r.width > 0 && r.height > 0 && cs.visibility !== 'hidden',
        x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height)
      };
    });
  });
  const redact = v => (typeof v === 'string' ? (/^Akun Google/i.test(v) ? 'Akun Google' : v.replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, '[email]')) : v);
  return items.map(i => ({ ...i, text: redact(i.text), aria: redact(i.aria) }));
}
module.exports = { collect, collectDeep, diff, keyOf };

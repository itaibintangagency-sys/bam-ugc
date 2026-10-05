'use strict';
// Kunci agent tunggal: satu Chrome khusus (satu port kontrol) hanya boleh dikendalikan satu agent.
// Dua agent pada Chrome yang sama saling menimpa kotak prompt, dan agent kedua akan merebut job yang sedang berjalan
// (lalu generate ulang: video ganda dan kredit terbuang).
const fs = require('fs');
const os = require('os');
const path = require('path');

function alive(pid) {
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}

function lockFile(root, cdpUrl) {
  const m = /:(\d+)\/?$/.exec(String(cdpUrl || '')); const port = m ? m[1] : 'x';
  return path.join(process.env.AGENT_LOCK_DIR || root, `.agent-${port}.lock`);
}

// Mengembalikan { ok:true, release } atau { ok:false, owner }
function acquireAgentLock(file) {
  const me = JSON.stringify({ pid: process.pid, started: new Date().toISOString(), host: os.hostname() });
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      fs.writeFileSync(file, me, { flag: 'wx' });
      break;
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      let owner = null; try { owner = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* rusak: dianggap basi */ }
      if (owner && owner.pid && owner.pid !== process.pid && alive(owner.pid)) return { ok: false, owner };
      try { fs.unlinkSync(file); } catch { /* sudah hilang */ }   // basi (proses sudah mati) atau milik proses ini
      if (attempt === 1) return { ok: false, owner };
    }
  }
  let released = false;
  const release = () => {
    if (released) return; released = true;
    try { const cur = JSON.parse(fs.readFileSync(file, 'utf8')); if (cur.pid === process.pid) fs.unlinkSync(file); } catch { /* abaikan */ }
  };
  process.once('exit', release);
  return { ok: true, release };
}
module.exports = { acquireAgentLock, lockFile, alive };

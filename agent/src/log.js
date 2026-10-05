'use strict';
const fs = require('fs');
const path = require('path');
function makeLogger(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `agent-${new Date().toISOString().slice(0, 10)}.log`);
  const write = (level, msg) => {
    const line = `${new Date().toISOString()} [${level}] ${msg}`;
    console.log(line);
    try { fs.appendFileSync(file, line + '\n'); } catch { /* abaikan */ }
  };
  return { info: m => write('INFO', m), warn: m => write('WARN', m), error: m => write('ERROR', m), file };
}
module.exports = { makeLogger };
